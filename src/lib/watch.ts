/**
 * Harness-owned worker watching and the platform-guidance redline record.
 *
 * `DELEGATE-001` binds the agent that starts a subagent to a fixed-cadence
 * check with a record of every arming and wake. Run 63311 showed that a
 * supervisor asked by its platform "not to poll or await" the worker simply
 * did not arm the timer. This module moves the timer, the inspection, and the
 * record out of model judgment: `pan watch` sleeps, inspects the invocation's
 * output and evidence paths, and appends one JSONL line per arming and wake.
 * A launch that returned in the foreground with its output present exposes no
 * observation point, so `pan watch --foreground-returned` records the launch
 * and return wall-clock times instead. `pan submit` requires one of three
 * records for every Cursor worker invocation — a completed watch, a watch
 * whose last wake observed the final output, or the foreground-return
 * attestation — and refuses with `DELEGATION_UNOBSERVED` otherwise.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `watch/`; new source importers should import the specific module.
 */

export type { AgentActivity } from './agent-index.js'
export {
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  MIN_WATCH_CADENCE_SECONDS,
  WATCH_LOW_COVERAGE_RATIO,
  WATCH_EXIT_CODES,
  WATCH_CADENCE_UNAUTHORIZED,
  WATCH_CADENCE_BELOW_MINIMUM,
  WATCH_TIMEOUT_BELOW_CADENCE,
  WATCH_STALL_WAKES_TOO_SMALL,
  WATCH_EVIDENCE_INVALID,
  WATCH_TARGET_BUSY,
  DELEGATION_CADENCE_EXTENDED,
  DELEGATION_WATCH_LOW_COVERAGE,
  DELEGATION_TIMER_UNAWAITED,
  DELEGATION_FOREGROUND_RETURN,
  DELEGATION_UNOBSERVED,
  DELEGATION_WATCH_LATE,
  DELEGATION_WATCH_LATE_SECONDS,
} from './watch/types.js'
export type {
  WatchTerminalState,
  WatchAgentState,
  WeakCompletionReason,
  CompletionEvidence,
  WatchedPathObservation,
  WatchObservation,
  AgentStopReason,
  WatchGap,
  AgentStateEvidenceReference,
  EvidenceRoleObservation,
  WatchRecordEntry,
  WatchResult,
  WatchStallEvidence,
  WatchOptions,
  DelegationWatchSummary,
  ForegroundReturnRecord,
  ForegroundReturnSummary,
  DelegationObservationSource,
  DelegationObservation,
  ForegroundReturnOptions,
  LaunchTimeSource,
} from './watch/types.js'
export {
  watchRecordPath,
  backgroundMarkerPath,
  watchLockPath,
  evidenceWatchRecordPath,
  evidenceWatchLockPath,
  evidenceReadyPath,
  foregroundReturnRecordPath,
  resolveWatchedInvocation,
} from './watch/paths.js'
export {
  invocationEvidencePaths,
  missingRequiredOutputFields,
  OUTPUT_SCAFFOLD_ORDER_ADVISORY,
  watchedAgentActivity,
  agentStopVerdict,
  observeInvocation,
  isTerminalObservation,
  launchToOutputSeconds,
} from './watch/observe.js'
export {
  parseCadenceSeconds,
  parseStallWakes,
  parseAgentState,
  parsePositiveInteger,
  parseTimeoutSeconds,
} from './watch/options.js'
export {
  launchRecordPath,
  readLaunchRecord,
  resolveLaunchMs,
  recordInvocationLaunch,
  markDelegationBackground,
} from './watch/launch.js'
export type { LaunchRecord, LaunchRecordOptions } from './watch/launch.js'
export {
  processStartIdentity,
  processIsZombie,
  loadAgentStateEvidence,
  watchWakeSpanSeconds,
} from './watch/process-evidence.js'
export type { AgentStateEvidence } from './watch/process-evidence.js'
export {
  blockedOutputSnapshotPath,
  snapshotBlockedOutput,
} from './watch/blocked-snapshot.js'
export {
  completionEvidenceForObservation,
  recordForegroundReturn,
} from './watch/completion.js'
export {
  watchLockOwnerAlive,
  runHasLiveWatch,
  acquireWatchLock,
  detectSessionGap,
  appendSessionGap,
  installInterruptionHandlers,
} from './watch/session.js'
export type { WatchLockRecord, WatchLockAcquisition } from './watch/session.js'
export { watchInvocation } from './watch/focused.js'
export {
  parseMultiplexedWatchTargets,
  watchInvocations,
} from './watch/multiplexed.js'
export type {
  MultiplexedWatchTarget,
  MultiplexedWatchOptions,
  MultiplexedWatchMovement,
  MultiplexedWatchGap,
  MultiplexedWatchResult,
} from './watch/multiplexed.js'
export {
  readForegroundReturn,
  formatSessionStartLine,
  formatGapLine,
  formatOpenCallSuffix,
  formatWakeLine,
  formatStallEvidenceLine,
  stallEvidenceFrom,
  readWatchRecord,
  summarizeDelegationWatch,
  summarizeForegroundReturn,
  summarizeDelegationObservation,
  delegationUnobservedMessage,
} from './watch/record.js'
export {
  GENERIC_WATCH_RECORD_DIRECTORY,
  SHELL_RECORD_DIRECTORY,
  resolveShellRecord,
  watchProcess,
  formatProcessWakeLines,
} from './watch/process.js'
export type {
  ShellRecordTarget,
  GenericWatchTerminalState,
  GenericWatchRecordEntry,
  GenericWatchResult,
  ProcessWatchOptions,
  TimerWatchOptions,
} from './watch/process.js'
export {
  WATCH_ATTACH_EXIT_ORPHANED,
  WATCH_ATTACH_EXIT_WAKE,
  WATCH_ATTACH_NO_SESSION,
  watchAttach,
} from './watch/attach.js'
export {
  WATCH_PARENT_BACKSTOP_SECONDS,
  WATCH_BLOCK_BOUND_MS,
  ATTACH_POLL_MS,
  WORKER_STILL_ACTIVE,
} from './watch/types.js'
export { agentLiveness, workerActivityRefusal } from './watch/liveness.js'
export type {
  AttachTerminalState,
  AttachSessionEntry,
  WatchAttachOptions,
  WatchAttachResult,
} from './watch/attach.js'
export { watchTimer } from './watch/timer.js'
export {
  REDLINE_RECORD_FILENAME,
  PLATFORM_ACTION_CATEGORY,
  REDLINE_CATEGORIES,
  readAuthorityOrder,
  redlineRecordPath,
  readRedlineRecord,
  writeRedlineRecord,
} from './watch/redline.js'
export type {
  RedlineCategory,
  RedlineDeclaration,
  RedlineRecord,
} from './watch/redline.js'
export { watchAgent } from './watch/agent.js'
export type {
  WatchAgentOptions,
  AgentWatchVerdict,
  WatchAgentSessionEntry,
  WatchAgentWakeInfo,
  WatchAgentResult,
} from './watch/agent.js'
