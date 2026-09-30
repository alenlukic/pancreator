/**
 * Run engine entry point. The implementation lives in `./engine/`, one module
 * per lifecycle concern; this module re-exports its public surface so the CLI,
 * the cohort and horizon drivers, and the tests keep one stable import path.
 */

export type { OperationProgressOptions } from './engine/core.js'
export {
  PREFETCH_RELEASE_PROFILE_ENV,
  releaseProfilePrefetches,
  pendingReleaseProfilePrefetch,
} from './engine/prefetch.js'
export type {
  ReleaseProfilePrefetchRecord,
  ReleaseProfilePrefetchState,
} from './engine/prefetch.js'
export { findAdoptableRepositoryCheckBaseline } from './engine/baselines.js'
export type { AdoptableRepositoryCheckBaseline } from './engine/baselines.js'
export { classifyHorizonFailure } from './engine/limits.js'
export {
  recordSupervisorModelEvidence,
  recordInvocationModelEvidence,
  recordPendingWorkerModelProbe,
  startDetachedWorkerModelProbe,
  probeRunInvocationModel,
} from './engine/model-evidence.js'
export type {
  SupervisorModelEvidenceResult,
  StartedWorkerModelProbe,
} from './engine/model-evidence.js'
export { DEFAULT_WORKFLOW_SLUG, createRun } from './engine/create-run.js'
export type { PipelineOverride } from './engine/create-run.js'
export { resolveSubmitValidators } from './engine/submit-validators.js'
export type { ResolvedSubmitValidator } from './engine/submit-validators.js'
export { assertDelegationAgentName } from './engine/prepare-helpers.js'
export type {
  PrepareInvocationResult,
  PreparedDelegation,
  PreparedEvidenceDelegation,
} from './engine/prepare-helpers.js'
export { prepareInvocation } from './engine/prepare.js'
export {
  stageWriteRoots,
  claudeCodeToolPolicy,
  openAiToolPolicy,
} from './engine/executors.js'
export { delegateInvocation } from './engine/delegate.js'
export type {
  DelegateInvocationOptions,
  DelegateInvocationResult,
} from './engine/delegate.js'
export { materializeOutputSubmission } from './engine/submit-helpers.js'
export type { MaterializedSubmission } from './engine/submit-helpers.js'
export { submitOutput } from './engine/submit.js'
export type { SubmitOutputResult } from './engine/submit.js'
export {
  assessStage,
  decideRun,
  decideRunAsAway,
  liftOperatorOnlyPauseForHorizon,
} from './engine/decide.js'
export {
  inFlightEvidenceWorkers,
  setRunStage,
  setRunStageAsAway,
  setRunVerification,
} from './engine/set-stage.js'
export type {
  InFlightEvidenceWorker,
  SetRunStageOptions,
} from './engine/set-stage.js'
export {
  STAGE_WORKER_ROLE,
  recordDelegatedWorker,
  armWorkerWatch,
  describeDelegatedWorkers,
} from './engine/delegated-workers.js'
export type {
  RecordDelegatedWorkerOptions,
  DelegatedWorkerLaunch,
  ArmWorkerWatchOptions,
  DelegatedWorkerPathState,
  DelegatedWorkerStateView,
} from './engine/delegated-workers.js'
export { recordWorkspaceDirective } from './engine/workspace-directive.js'
export {
  pauseRun,
  quarantineRunForAgent,
  resumeRun,
  resumeRunAsAway,
} from './engine/pause-resume.js'
export type { PauseRunOptions } from './engine/pause-resume.js'
export { waiveGate } from './engine/waive-gate.js'
export type { WaiveGateOptions } from './engine/waive-gate.js'
export {
  abortRun,
  getRunStatus,
  getRunState,
  recordHorizonReplan,
} from './engine/run-status.js'
export {
  outputValidateScratchPath,
  validateOutputForSubmission,
} from './engine/output-validation.js'
export type { OutputValidateCaller } from './engine/output-validation.js'
export { delegateEvidenceWorkers } from './engine/evidence-workers.js'
export type { EvidenceWorkerDelegation } from './engine/evidence-workers.js'
