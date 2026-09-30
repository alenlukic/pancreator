/**
 * Managed worktree entry point. The implementation lives in `./worktree/`,
 * one module per concern; this module re-exports its public surface so the
 * CLI, the engine, and the tests keep one stable import path.
 */

export {
  isWorktreeName,
  handoffSelfDevelopmentLocalConfig,
} from './worktree/store.js'
export type {
  WorktreeRecord,
  WorktreeIndex,
  CreatedWorktree,
  ListedWorktree,
  CreateWorktreeOptions,
  RemoveWorktreeResult,
  ReconcileTarget,
  ReconcileOptions,
  ReconcileWorktreesResult,
} from './worktree/store.js'
export {
  worktreeReadiness,
  parseWorktreeIndex,
  readWorktreeIndex,
  writeWorktreeIndex,
  workspaceRepositoryRoot,
  resolveRepositoryRoot,
  resolveBranchCheckout,
} from './worktree/registry.js'
export type {
  WorktreeReadinessGap,
  WorktreeReadinessReport,
} from './worktree/registry.js'
export {
  createWorktree,
  listWorktrees,
  resolveWorktreeWorkspace,
  resolveOrCreateWorktree,
  resolveWorkspacePathOrWorktree,
} from './worktree/create.js'
export {
  sweepWorktreeTestScratch,
  sweepDiscardedWorktreeScratch,
  removeWorktree,
} from './worktree/remove.js'
export {
  materializeBranchCheckout,
  reconcileWorktrees,
} from './worktree/reconcile.js'
