/**
 * Cohort session entry point. The implementation lives in `./cohorts/`, one
 * module per concern; this module re-exports its public surface so the CLI,
 * the engine, the headless driver, and the tests keep one stable import path.
 */

export {
  COHORT_PLAN_WORKFLOW_SLUG,
  COHORT_CHUNK_WORKFLOW_SLUG,
  DELIVERY_WORKFLOW_SLUG,
  RELEASE_RUN_START_STAGE,
  DEFAULT_COHORT_MAX_PARALLEL,
  COHORT_REDLINE_OCCASION,
  cohortDir,
  cohortMutexPath,
  loadCohortState,
} from './cohorts/state.js'
export type {
  CohortChunkView,
  CohortChunkBootstrap,
  CohortStatusView,
  CohortStartResult,
  CohortIntegrationResult,
  DeliveryRouteOptions,
  StartedRunHandoff,
  DeliveryAutostartResult,
  CohortAdvanceResult,
  CohortContinuationResult,
} from './cohorts/state.js'
export {
  cohortBaselineDirectory,
  claimCohortBaselineCapture,
  recordCohortBaselines,
  releaseCohortBaselineClaim,
} from './cohorts/baselines.js'
export type { CohortBaselineClaim } from './cohorts/baselines.js'
export {
  cohortMaxParallel,
  cohortIsSatisfied,
  assertCohortRunUnblocked,
} from './cohorts/chunks.js'
export { parseCohortPlan, readRatifiedCohortPlan } from './cohorts/plan.js'
export {
  initCohortSession,
  startCohort,
  cohortStatus,
} from './cohorts/start.js'
export type { InitCohortOptions, StartCohortOptions } from './cohorts/start.js'
export {
  releaseCohort,
  integrateCohort,
  maybeAdvanceCohort,
} from './cohorts/integration.js'
export {
  abandonChunk,
  cleanCohortSession,
  cohortSessionIds,
} from './cohorts/abandon.js'
export type {
  AbandonedChunkDiscard,
  CleanCohortResult,
} from './cohorts/abandon.js'
export {
  cohortSessionForPlanRun,
  maybeStartDelivery,
  retryDeliveryRoute,
} from './cohorts/delivery.js'
