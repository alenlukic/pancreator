import path from "node:path";

import type { TaskId } from "@pancreator/core";

import { PortRangeExhaustedError, PortRegistryError } from "./errors.js";
import { assertRegistryPathInSandboxes, defaultRegistryFilePath } from "./paths.js";
import {
  emptyRegistryState,
  readRegistryState,
  writeRegistryStateAtomic,
  type PortRegistryStateV1,
} from "./registry-state.js";
import { assertSafeTaskId } from "./task-id.js";
import type { PortAllocation, PortRegistry } from "./types.js";

export interface PortRegistryEnvIsolationOptions {
  repoRoot: string;
  /** Defaults to `repoRoot/.pan/sandboxes/port-registry.json`. */
  registryFilePath?: string;
  /** Defaults to `3000`. */
  minPort?: number;
  /** Defaults to `3100`. */
  maxPort?: number;
}

/** File-backed `PortRegistry` with atomic writes and collision detection on load. */
export class PortRegistryEnvIsolation implements PortRegistry {
  private readonly registryFilePath: string;
  private readonly minPort: number;
  private readonly maxPort: number;

  constructor(options: PortRegistryEnvIsolationOptions) {
    const repoRoot = path.resolve(options.repoRoot);
    this.minPort = options.minPort ?? 3000;
    this.maxPort = options.maxPort ?? 3100;
    emptyRegistryState(this.minPort, this.maxPort);
    this.registryFilePath = path.resolve(
      options.registryFilePath ?? defaultRegistryFilePath(repoRoot),
    );
    assertRegistryPathInSandboxes(repoRoot, this.registryFilePath);
  }

  private findContiguousBlock(state: PortRegistryStateV1, count: number): number[] | null {
    const used = new Set<number>();
    for (const ports of Object.values(state.allocations)) {
      for (const p of ports) {
        used.add(p);
      }
    }
    const upper = state.maxPort - count + 1;
    for (let start = state.minPort; start <= upper; start++) {
      let blocked = false;
      for (let i = 0; i < count; i++) {
        if (used.has(start + i)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        return Array.from({ length: count }, (_, i) => start + i);
      }
    }
    return null;
  }

  async reserve(taskId: TaskId, count: number): Promise<number[]> {
    if (!Number.isInteger(count) || count < 1) {
      throw new PortRegistryError("count must be a positive integer.");
    }
    const id = String(taskId);
    assertSafeTaskId(id);
    const state = await readRegistryState(this.registryFilePath, this.minPort, this.maxPort);
    const existing = state.allocations[id];
    if (existing) {
      if (existing.length === count) {
        return [...existing];
      }
      throw new PortRegistryError(
        `Task ${id} already holds ${existing.length} ports; release before reserving a different block size.`,
      );
    }
    const block = this.findContiguousBlock(state, count);
    if (!block) {
      throw new PortRangeExhaustedError(
        `No contiguous block of ${count} free ports in ${state.minPort}-${state.maxPort}.`,
      );
    }
    const next: PortRegistryStateV1 = {
      ...state,
      allocations: { ...state.allocations, [id]: block },
    };
    await writeRegistryStateAtomic(this.registryFilePath, next);
    return block;
  }

  async release(taskId: TaskId): Promise<void> {
    const id = String(taskId);
    assertSafeTaskId(id);
    const state = await readRegistryState(this.registryFilePath, this.minPort, this.maxPort);
    if (!state.allocations[id]) {
      return;
    }
    const allocations = { ...state.allocations };
    delete allocations[id];
    await writeRegistryStateAtomic(this.registryFilePath, { ...state, allocations });
  }

  async list(): Promise<PortAllocation[]> {
    const state = await readRegistryState(this.registryFilePath, this.minPort, this.maxPort);
    return Object.entries(state.allocations).map(([key, ports]) => ({
      taskId: key as TaskId,
      ports: [...ports],
    }));
  }
}
