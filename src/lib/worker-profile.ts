/**
 * Worker transcript profiling and the per-invocation suite-cost advisory.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `worker-profile/`; new source importers should import the specific
 * module.
 */

export {
  assistantTurns,
  effectiveShellCommand,
  isShellBrowsingCommand,
  isUnfilteredTestCommand,
  toolPath,
  shellBrowsingCalls,
  profileWorkerTranscript,
} from './worker-profile/transcript.js'
export type {
  ToolUse,
  WorkerTranscriptProfile,
} from './worker-profile/transcript.js'
export {
  stageFromInvocationId,
  generateWorkerProfileReport,
  formatWorkerProfileReport,
} from './worker-profile/report.js'
export type {
  WorkerProfileStage,
  WorkerProfileReport,
  GenerateWorkerProfileOptions,
} from './worker-profile/report.js'
export {
  CURSOR_TRANSCRIPTS_ENV,
  invocationTranscriptsRoot,
  findInvocationTranscripts,
  workerInvocationSuiteCost,
  invocationShellBrowsingCalls,
} from './worker-profile/invocations.js'
export type { WorkerInvocationSuiteCost } from './worker-profile/invocations.js'
