import path from "node:path";

import type { TaskId } from "@daedaline/core";

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
import { readPoolState, writePoolStateAtomic, type WorktreePoolStateV1 } from "./pool-state.js";
import { assertSafeTaskId } from "./task-id.js";
import type { WorktreeLease, WorktreePool } from "./types.js";

export interface GitWorktreePoolOptions {
  /** Absolute path to the main repository checkout. */
  repoRoot: string;
  /** Defaults to `git` subprocess via `createNodeGitOps()`. */
  gitOps?: GitOps;
  /** Defaults to `repoRoot/.ddl/worktrees/pool-state.json`. */
  stateFilePath?: string;
  /** Defaults to `repoRoot/.ddl/worktrees`. */
  worktreesRoot?: string;
}

/** Git-backed pool with persisted lease state and Q7 single-pipeline guard. */
export class GitWorktreePool implements WorktreePool {
  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly stateFilePath: string;
  private readonly gitOps: GitOps;

  constructor(options: GitWorktreePoolOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.worktreesRoot = path.resolve(options.worktreesRoot ?? defaultWorktreesRoot(this.repoRoot));
    assertCanonicalWorktreesRoot(this.repoRoot, this.worktreesRoot);
    this.stateFilePath = path.resolve(
      options.stateFilePath ?? path.join(this.worktreesRoot, "pool-state.json"),
    );
    assertPathUnderWorktreesRoot(this.worktreesRoot, this.stateFilePath);
    this.gitOps = options.gitOps ?? createNodeGitOps();
  }

  async acquire(taskId: TaskId, ref?: string): Promise<WorktreeLease> {
    const id = String(taskId);
    assertSafeTaskId(id);
    const slotPath = path.join(this.worktreesRoot, id);
    assertPathInsideWorktreesRoot(this.worktreesRoot, slotPath);

    let state = await readPoolState(this.stateFilePath);
    const existing = state.slots[id];
    if (existing) {
      assertPathInsideWorktreesRoot(this.worktreesRoot, existing.path);
      return { taskId, path: existing.path, createdAtIso: existing.createdAtIso };
    }

    if (state.activeTaskId !== null && state.activeTaskId !== id) {
      throw new WorktreePoolLeaseConflictError(
        `Another pipeline holds the worktree lease (${state.activeTaskId}).`,
        state.activeTaskId,
      );
    }

    const createdAtIso = new Date().toISOString();
    await this.gitOps.worktreeAdd(this.repoRoot, slotPath, ref);

    state = await readPoolState(this.stateFilePath);
    if (state.activeTaskId !== null && state.activeTaskId !== id && state.slots[id] === undefined) {
      throw new WorktreePoolLeaseConflictError(
        `Another pipeline holds the worktree lease (${state.activeTaskId}).`,
        state.activeTaskId,
      );
    }

    state.slots[id] = { path: slotPath, createdAtIso };
    state.activeTaskId = id;
    await writePoolStateAtomic(this.stateFilePath, state);

    return { taskId, path: slotPath, createdAtIso };
  }

  async release(taskId: TaskId): Promise<void> {
    const id = String(taskId);
    assertSafeTaskId(id);
    const state = await readPoolState(this.stateFilePath);
    const slot = state.slots[id];
    if (!slot) {
      throw new WorktreeSlotNotFoundError(`No worktree slot for task ${id}.`);
    }
    assertPathInsideWorktreesRoot(this.worktreesRoot, slot.path);

    await this.gitOps.worktreeRemove(this.repoRoot, slot.path);

    const next: WorktreePoolStateV1 = {
      version: state.version,
      activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
      slots: { ...state.slots },
    };
    delete next.slots[id];
    await writePoolStateAtomic(this.stateFilePath, next);
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
