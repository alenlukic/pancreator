import { mkdirSync } from "node:fs";
import path from "node:path";

import type { TaskId } from "@pancreator/core";

import {
  WorktreePoolLeaseConflictError,
  WorktreeSlotNotFoundError,
} from "./errors.js";
import type { GitOps } from "./git-ops.js";
import { createNodeGitOps } from "./git-ops.js";
import {
  assertCanonicalWorktreesRoot,
  assertPathInsideWorktreesRoot,
  assertPathUnderWorktreesRoot,
  defaultWorktreesRoot,
} from "./paths.js";
import {
  readPoolState,
  writePoolStateAtomic,
  type WorktreePoolStateV2,
} from "./pool-state.js";
import { assertSafeTaskId } from "./task-id.js";
import type { WorktreeLease, WorktreePool } from "./types.js";

export interface GitWorktreePoolOptions {
  /** Absolute path to the main repository checkout. */
  repoRoot: string;
  /** Defaults to `git` subprocess via `createNodeGitOps()`. */
  gitOps?: GitOps;
  /** Defaults to `repoRoot/.pan/worktrees/pool-state.json`. */
  stateFilePath?: string;
  /** Defaults to `repoRoot/.pan/worktrees`. */
  worktreesRoot?: string;
  /** Maximum concurrent active leases; defaults to 1 (Q7 single-pipeline guard). */
  maxConcurrent?: number;
}

export interface WorktreeAcquireOptions {
  ref?: string;
  branch?: string;
}

/** Serializes pool-state read/write when multiple acquire/release calls overlap. */
class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Git-backed pool with persisted lease state and configurable concurrent lease cap. */
export class GitWorktreePool implements WorktreePool {
  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly stateFilePath: string;
  private readonly gitOps: GitOps;
  private readonly maxConcurrent: number;
  private readonly stateMutex = new AsyncMutex();

  constructor(options: GitWorktreePoolOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.worktreesRoot = path.resolve(options.worktreesRoot ?? defaultWorktreesRoot(this.repoRoot));
    assertCanonicalWorktreesRoot(this.repoRoot, this.worktreesRoot);
    mkdirSync(this.worktreesRoot, { recursive: true });
    this.stateFilePath = path.resolve(
      options.stateFilePath ?? path.join(this.worktreesRoot, "pool-state.json"),
    );
    assertPathUnderWorktreesRoot(this.worktreesRoot, this.stateFilePath);
    this.gitOps = options.gitOps ?? createNodeGitOps();
    this.maxConcurrent = options.maxConcurrent ?? 1;
    if (this.maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1.");
    }
  }

  async acquire(taskId: TaskId, refOrOptions?: string | WorktreeAcquireOptions): Promise<WorktreeLease> {
    const options: WorktreeAcquireOptions =
      typeof refOrOptions === "string" ? { ref: refOrOptions } : (refOrOptions ?? {});
    const id = String(taskId);
    assertSafeTaskId(id);
    const slotPath = path.join(this.worktreesRoot, id);
    assertPathInsideWorktreesRoot(this.worktreesRoot, slotPath);

    const reserved = await this.stateMutex.run(async () => {
      let state = await readPoolState(this.stateFilePath);
      if (state.maxConcurrent !== this.maxConcurrent) {
        state = { ...state, maxConcurrent: this.maxConcurrent };
      }

      const existing = state.slots[id];
      if (existing) {
        assertPathInsideWorktreesRoot(this.worktreesRoot, existing.path);
        if (!state.activeTaskIds.includes(id)) {
          state.activeTaskIds = [...state.activeTaskIds, id];
          await writePoolStateAtomic(this.stateFilePath, state);
        }
        return {
          kind: "existing" as const,
          lease: { taskId, path: existing.path, createdAtIso: existing.createdAtIso },
        };
      }

      const activeOthers = state.activeTaskIds.filter((activeId) => activeId !== id);
      if (activeOthers.length >= state.maxConcurrent) {
        throw new WorktreePoolLeaseConflictError(
          `Worktree pool holds ${activeOthers.length} active lease(s) (max ${state.maxConcurrent}).`,
          activeOthers[0] ?? id,
        );
      }

      const createdAtIso = new Date().toISOString();
      state.slots[id] = {
        path: slotPath,
        createdAtIso,
        ...(options.branch !== undefined ? { branch: options.branch } : {}),
      };
      if (!state.activeTaskIds.includes(id)) {
        state.activeTaskIds = [...state.activeTaskIds, id];
      }
      await writePoolStateAtomic(this.stateFilePath, state);
      return { kind: "new" as const, createdAtIso };
    });

    if (reserved.kind === "existing") {
      return reserved.lease;
    }

    await this.gitOps.worktreeAdd(this.repoRoot, slotPath, options.ref, options.branch);
    return { taskId, path: slotPath, createdAtIso: reserved.createdAtIso };
  }

  async suspendLease(taskId: TaskId): Promise<void> {
    const id = String(taskId);
    assertSafeTaskId(id);
    await this.stateMutex.run(async () => {
      const state = await readPoolState(this.stateFilePath);
      if (!state.slots[id]) {
        throw new WorktreeSlotNotFoundError(`No worktree slot for task ${id}.`);
      }
      const nextActive = state.activeTaskIds.filter((activeId) => activeId !== id);
      if (nextActive.length === state.activeTaskIds.length) {
        return;
      }
      await writePoolStateAtomic(this.stateFilePath, {
        ...state,
        activeTaskIds: nextActive,
      });
    });
  }

  async release(taskId: TaskId): Promise<void> {
    const id = String(taskId);
    assertSafeTaskId(id);
    const slot = await this.stateMutex.run(async () => {
      const state = await readPoolState(this.stateFilePath);
      const existing = state.slots[id];
      if (!existing) {
        throw new WorktreeSlotNotFoundError(`No worktree slot for task ${id}.`);
      }
      assertPathInsideWorktreesRoot(this.worktreesRoot, existing.path);
      return existing;
    });

    await this.gitOps.worktreeRemove(this.repoRoot, slot.path);

    await this.stateMutex.run(async () => {
      const state = await readPoolState(this.stateFilePath);
      const next: WorktreePoolStateV2 = {
        version: state.version,
        maxConcurrent: state.maxConcurrent,
        activeTaskIds: state.activeTaskIds.filter((activeId) => activeId !== id),
        slots: { ...state.slots },
      };
      delete next.slots[id];
      await writePoolStateAtomic(this.stateFilePath, next);
    });
  }

  async list(): Promise<WorktreeLease[]> {
    const state = await readPoolState(this.stateFilePath);
    return Object.entries(state.slots).map(([key, rec]) => ({
      taskId: key as TaskId,
      path: rec.path,
      createdAtIso: rec.createdAtIso,
    }));
  }
}
