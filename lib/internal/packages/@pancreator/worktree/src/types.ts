import type { TaskId } from "@pancreator/core";

/** Lease for one pipeline worktree under `.pan/worktrees/`. */
export interface WorktreeLease {
  taskId: TaskId;
  path: string;
  createdAtIso: string;
}

/** Acquires and releases git worktrees with a single active pipeline guard. */
export interface WorktreePool {
  acquire(taskId: TaskId, ref?: string): Promise<WorktreeLease>;
  release(taskId: TaskId): Promise<void>;
  list(): Promise<WorktreeLease[]>;
}
