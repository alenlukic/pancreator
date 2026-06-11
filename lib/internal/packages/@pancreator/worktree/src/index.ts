/**
 * Compatibility stub for the removed worktree package.
 *
 * Feature-delivery no longer creates isolated parallel checkouts. Keep this tiny
 * package only so historical package imports fail softly during the deprecation
 * window instead of restoring parallel-checkout behavior.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_WORKTREE_VERSION = "removed" as const;
export const PANCREATOR_WORKTREE_STUB = "worktree-disabled" as const;
export const PANCREATOR_WORKTREE_REMOVED = true as const;

export function worktreeStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
