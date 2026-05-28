/** Base error for worktree pool operations. */
export class WorktreePoolError extends Error {
  override name = "WorktreePoolError";
}

/** Another task holds the single-pipeline lease (Q7). */
export class WorktreePoolLeaseConflictError extends WorktreePoolError {
  override name = "WorktreePoolLeaseConflictError";
  constructor(
    message: string,
    readonly activeTaskId: string,
  ) {
    super(message);
  }
}

/** Resolved path escapes the configured worktrees root. */
export class InvalidWorktreePathError extends WorktreePoolError {
  override name = "InvalidWorktreePathError";
}

/** No slot exists for the task. */
export class WorktreeSlotNotFoundError extends WorktreePoolError {
  override name = "WorktreeSlotNotFoundError";
}

/** Task id contains unsafe path segments. */
export class InvalidTaskIdError extends WorktreePoolError {
  override name = "InvalidTaskIdError";
}

/** Worktrees root is not `repoRoot/.ddl/worktrees`. */
export class InvalidWorktreesRootError extends WorktreePoolError {
  override name = "InvalidWorktreesRootError";
}
