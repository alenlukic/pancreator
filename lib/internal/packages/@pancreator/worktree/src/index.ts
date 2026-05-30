/**
 * @packageDocumentation
 * Git worktree pool with persisted lease state and a single active pipeline guard (Q7).
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_WORKTREE_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const PANCREATOR_WORKTREE_STUB = "worktree" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function worktreeStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export {
  GitWorktreePool,
  type GitWorktreePoolOptions,
} from "./git-worktree-pool.js";
export { createMemoryGitOps, createNodeGitOps, type GitOps } from "./git-ops.js";
export {
  InvalidTaskIdError,
  InvalidWorktreePathError,
  InvalidWorktreesRootError,
  WorktreePoolError,
  WorktreePoolLeaseConflictError,
  WorktreeSlotNotFoundError,
} from "./errors.js";
export type { WorktreeLease, WorktreePool } from "./types.js";
