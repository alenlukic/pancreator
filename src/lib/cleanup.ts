/**
 * Retention cleanup entry point. The implementation lives in `./cleanup/`:
 * `classes.ts` holds `CLEANUP_ARTIFACT_CLASSES`, the single inventory of every
 * runtime class, with the plan and result shapes, and `plan.ts` plans and
 * applies the cleanup. This module re-exports their public surface so the CLI
 * and the tests keep one stable import path.
 */

export { CLEANUP_ARTIFACT_CLASSES } from './cleanup/classes.js'
export type {
  CleanupDisposal,
  CleanupAgeSource,
  CleanupArtifactClass,
  CleanupAction,
  CleanupSkip,
  CleanupBranch,
  CleanupWorktree,
  CleanupPlan,
  CleanupOptions,
  CleanupResult,
} from './cleanup/classes.js'
export { planCleanup, applyCleanup } from './cleanup/plan.js'
