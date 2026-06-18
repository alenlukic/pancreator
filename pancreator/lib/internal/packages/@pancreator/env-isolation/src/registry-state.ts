import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyRepoJson } from "@pancreator/core";

import {
  InvalidPortRangeError,
  PortRegistryCollisionError,
  PortRegistryError,
} from "./errors.js";

export const PORT_REGISTRY_STATE_VERSION = 1 as const;

export interface PortRegistryStateV1 {
  version: typeof PORT_REGISTRY_STATE_VERSION;
  minPort: number;
  maxPort: number;
  allocations: Record<string, number[]>;
}

export function emptyRegistryState(minPort: number, maxPort: number): PortRegistryStateV1 {
  if (!Number.isInteger(minPort) || !Number.isInteger(maxPort) || minPort > maxPort) {
    throw new InvalidPortRangeError("minPort and maxPort form an invalid inclusive integer range.");
  }
  return {
    version: PORT_REGISTRY_STATE_VERSION,
    minPort,
    maxPort,
    allocations: {},
  };
}

function validateNoCollisions(state: PortRegistryStateV1): void {
  const seen = new Map<number, string>();
  for (const [taskId, ports] of Object.entries(state.allocations)) {
    for (const p of ports) {
      const owner = seen.get(p);
      if (owner !== undefined) {
        throw new PortRegistryCollisionError(
          `Port ${p} is assigned to both ${owner} and ${taskId}.`,
        );
      }
      seen.set(p, taskId);
    }
  }
}

function validatePortsInRange(state: PortRegistryStateV1): void {
  for (const ports of Object.values(state.allocations)) {
    for (const p of ports) {
      if (p < state.minPort || p > state.maxPort) {
        throw new InvalidPortRangeError(`Port ${p} is outside the declared range.`);
      }
    }
  }
}

function assertLoadedShape(
  parsed: unknown,
  minPort: number,
  maxPort: number,
): PortRegistryStateV1 {
  if (typeof parsed !== "object" || parsed === null) {
    throw new PortRegistryError("Registry file does not contain a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  if (o.version !== PORT_REGISTRY_STATE_VERSION) {
    throw new PortRegistryError("Registry file version is not supported.");
  }
  if (typeof o.minPort !== "number" || typeof o.maxPort !== "number") {
    throw new PortRegistryError("Registry file is missing minPort or maxPort.");
  }
  if (o.minPort !== minPort || o.maxPort !== maxPort) {
    throw new InvalidPortRangeError(
      "Registry on disk uses a different inclusive port range than this instance.",
    );
  }
  if (typeof o.allocations !== "object" || o.allocations === null || Array.isArray(o.allocations)) {
    throw new PortRegistryError("Registry file allocations must be an object.");
  }
  const allocations: Record<string, number[]> = {};
  for (const [taskId, value] of Object.entries(o.allocations)) {
    if (!Array.isArray(value) || !value.every((n) => typeof n === "number" && Number.isInteger(n))) {
      throw new PortRegistryError(`Registry allocation for ${taskId} is not an integer port array.`);
    }
    allocations[taskId] = value as number[];
  }
  const state: PortRegistryStateV1 = {
    version: PORT_REGISTRY_STATE_VERSION,
    minPort,
    maxPort,
    allocations,
  };
  validateNoCollisions(state);
  validatePortsInRange(state);
  return state;
}

export async function readRegistryState(
  filePath: string,
  minPort: number,
  maxPort: number,
): Promise<PortRegistryStateV1> {
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new PortRegistryError("Registry file is not valid JSON.");
    }
    return assertLoadedShape(parsed, minPort, maxPort);
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      return emptyRegistryState(minPort, maxPort);
    }
    throw e;
  }
}

export async function writeRegistryStateAtomic(
  filePath: string,
  state: PortRegistryStateV1,
): Promise<void> {
  validateNoCollisions(state);
  validatePortsInRange(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${stringifyRepoJson(state, process.cwd())}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}
