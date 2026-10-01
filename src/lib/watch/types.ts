/** Watch result states, record shapes, cadence defaults, and error codes. */

import type { AgentActivity, ShellHeartbeat } from '../agent-index/activity.js'
import type { EventKind } from '../agent-index/store.js'

export type WatchTerminalState =
  | 'completed'
  | 'stalled'
  | 'timed_out'
  | 'unverified'
  | 'interrupted'

/**
 * What the supervisor saw when it inspected the launched agent itself.
 *
 * `DELEGATE-001` makes the agent's state the observation point, not the
 * output file. The harness cannot read a Cursor subagent's state, so the
 * supervisor supplies it.
 */
export type WatchAgentState = 'running' | 'completed'

/**
 * Why the evidence that a finished-looking output is finished is weak.
 *
 * `Q-006`: a running report must not outrank output plausibility forever, or
 * no such watch could ever complete. These three conditions therefore buy one
 * confirming wake rather than a verdict, and the watch completes when the
 * output did not move across it.
 */
export type WeakCompletionReason =
  | 'agent_reported_running'
  | 'output_younger_than_cadence'
  | 'elapsed_time_unreadable'
  | 'agent_completion_basis_missing'
  | 'agent_active'
  | 'output_unconfirmed'
  | 'agent_turn_open'

/** What the terminal verdict for one observation rests on. */
export type CompletionEvidence =
  | { strength: 'none' }
  | { strength: 'strong'; basis: 'agent_state' | 'output_plausible' }
  | { strength: 'weak'; reason: WeakCompletionReason }

/**
 * The one cadence `DELEGATE-001` names, whatever the expected run time.
 *
 * `--cadence-seconds` still overrides it for an operator-directed exception.
 */
export const DEFAULT_WATCH_CADENCE_SECONDS = 60

/** Unchanged duration before `DELEGATE-001` permits a stall verdict. */
export const DEFAULT_STALL_TIMEOUT_SECONDS = 5 * 60

/** Bound so a watch never outlives an abandoned session silently. */
export const DEFAULT_WATCH_TIMEOUT_SECONDS = 1 * 60 * 60

/** Parent backstop: attach returns attach_wake after this many seconds. */
export const WATCH_PARENT_BACKSTOP_SECONDS = 300

/** Printed block bound for every blocking pan watch call. */
export const WATCH_BLOCK_BOUND_MS = 330_000

export const ATTACH_POLL_MS = 1_000

/**
 * How often a sleeping watch checks the agent index for a worker stop, so a
 * finished worker is reported within seconds instead of at the next wake.
 */
export const WATCH_STOP_POLL_MS = 5_000

export const WORKER_STILL_ACTIVE = 'WORKER_STILL_ACTIVE'

export type WatchStallCause =
  | 'shell_dead'
  | 'shell_stopped'
  | 'shell_heartbeat_stale'
  | 'quiet_fallback'

/** Floor that keeps a fractional test cadence from becoming a busy loop. */
export const MIN_WATCH_CADENCE_SECONDS = 0.05

/**
 * Coverage ratio below which a watched delegation earns the low-coverage
 * advisory. The threshold is a ratified planning choice: strictly below one
 * half, with a trustworthy launch clock and a lifetime past one cadence.
 */
export const WATCH_LOW_COVERAGE_RATIO = 0.5

export const WATCH_EXIT_CODES: Record<WatchTerminalState, number> = {
  completed: 0,
  stalled: 2,
  timed_out: 3,
  unverified: 4,
  // Conventional signal status is 128 + signo; the interrupted watch dies by
  // re-raising the signal it caught, so this entry only backs in-process
  // callers that swallowed the re-raise.
  interrupted: 130,
}

export const WATCH_CADENCE_UNAUTHORIZED = 'WATCH_CADENCE_UNAUTHORIZED'

export const WATCH_CADENCE_BELOW_MINIMUM = 'WATCH_CADENCE_BELOW_MINIMUM'

export const WATCH_TIMEOUT_BELOW_CADENCE = 'WATCH_TIMEOUT_BELOW_CADENCE'

export const WATCH_STALL_WAKES_TOO_SMALL = 'WATCH_STALL_WAKES_TOO_SMALL'

export const WATCH_EVIDENCE_INVALID = 'WATCH_EVIDENCE_INVALID'

export const WATCH_TARGET_BUSY = 'WATCH_TARGET_BUSY'

export const DELEGATION_CADENCE_EXTENDED = 'DELEGATION_CADENCE_EXTENDED'

export const DELEGATION_WATCH_LOW_COVERAGE = 'DELEGATION_WATCH_LOW_COVERAGE'

export const DELEGATION_TIMER_UNAWAITED = 'DELEGATION_TIMER_UNAWAITED'

export const DELEGATION_FOREGROUND_RETURN = 'DELEGATION_FOREGROUND_RETURN'

export interface WatchedPathObservation {
  path: string
  exists: boolean
  size: number | null
  mtime_ms: number | null
}

export interface WatchObservation {
  observed_at: string
  output_path: string
  output_present: boolean
  output_parses: boolean
  /** The parsed output names this invocation. */
  output_matches_invocation: boolean
  /**
   * The output is still the scaffold the worker writes before it starts.
   * `AUTO-001` requires that file, so its presence marks a worker that began,
   * never one that finished.
   */
  output_is_scaffold: boolean
  /**
   * Declared fields of the invocation's output contract the observed document
   * does not carry yet, as dotted paths. A document that parses and is not a
   * scaffold can still be a half-written one.
   */
  output_missing_required_fields: string[]
  watched_paths: WatchedPathObservation[]
  /**
   * Digest of every file under the run's `agent/` tree, by path, size, and
   * mtime. A worker that writes evidence to a declared path the invocation
   * prefix does not cover still registers as progress.
   */
  run_tree_fingerprint?: string
  /**
   * Digest of the workspace Git state: status entries, index, and dirty file
   * content. A source-allowed worker spends most of its life editing the
   * workspace before it writes any output, and without this a watch calls
   * that worker stalled.
   */
  workspace_fingerprint?: string
  /** The Git-visible workspace differs from the invocation's pre-work state. */
  workspace_changed_from_invocation?: boolean
  /**
   * The watched worker as the hook-fed agent index sees it: its latest tool
   * event, an open call, and its stop record. Absent when the index knows no
   * agent for this invocation.
   */
  agent_activity?: AgentActivity
  /** Stable digest of the watched paths; equal digests mean no change. */
  fingerprint: string
}

/** Why an agent stop ended a run-scoped watch without a completion. */
export type AgentStopReason =
  | 'agent_stopped_error'
  | 'agent_stopped_aborted'
  | 'agent_stopped_without_output'

/**
 * An observation gap between two watch sessions of one invocation.
 *
 * The event is append-only and carries no session id of its own: it describes
 * the interval between the session that ended (or vanished) and the one that
 * found it. `key` deduplicates the same gap across retries, because `from`
 * comes from the prior session's durable history and never moves.
 */
export interface WatchGap {
  /** Last observed time of the prior session, or its arming time. */
  from: string
  /** Session start that discovered the gap. */
  to: string
  seconds: number
  /** Interval beyond the prior session's cadence. */
  overdue_seconds: number
  reason:
    | 'orphan_session'
    | 'sibling_handoff'
    | 'interrupted'
    | 'legacy_unclassified'
  /** What established the gap: the ledger, a session end, or a stale lock. */
  source: 'ledger' | 'session_end' | 'lock'
  key: string
}

/** A recorded supervisor inspection supplied as completion evidence. */
export interface AgentStateEvidenceReference {
  path: string
  sha256: string
  /** A supplied record is an attributable assertion, not platform proof. */
  source: 'supervisor_assertion'
}

/** One evidence role's newest declared report, as a watch observed it. */
export interface EvidenceRoleObservation {
  role: string
  attempt: number
  path: string
  exists: boolean
  non_empty: boolean
  /** The report carries the evidence-report completion marker. */
  complete: boolean
}

export interface WatchRecordEntry {
  schema_version: 1
  event: 'session_started' | 'armed' | 'wake' | 'gap' | 'session_ended'
  run_id: string
  invocation_id: string
  recorded_at: string
  cadence_seconds: number
  /** Ordinal of the wake this arming waits for, or of this wake. */
  wake: number
  /**
   * One watch process's session. A ledger entry without it predates session
   * identity; restart recovery marks that history `legacy_unclassified`
   * rather than inventing one.
   */
  watch_session_id?: string
  /** Watcher process identity, on `session_started`. */
  watcher_pid?: number
  watcher_process_identity?: string | null
  /** Resolved bound of the session, on `session_started` and `armed`. */
  timeout_seconds?: number
  /**
   * Trimmed operator direction authorizing a non-default cadence. Present on
   * `session_started` and `armed` entries of an excepted session.
   */
  cadence_authority?: string
  /** Present on `armed`. */
  wake_due_at?: string
  /** Present on `wake`. */
  observation?: WatchObservation
  /** Present when the supervisor reported what the agent itself was doing. */
  agent_state?: WatchAgentState
  /** The inspection record behind an agent-state report, when supplied. */
  agent_state_evidence?: AgentStateEvidenceReference
  /**
   * What a `completed` verdict rests on. `agent_state` means the supervisor
   * inspected the launched agent and said so. `output_plausible` means only
   * that a non-scaffold output landed far enough after the launch to be a
   * finished one — files cannot rule out a worker still editing, so the
   * record says which of the two it was rather than presenting both as the
   * same fact.
   */
  terminal_basis?:
    | 'agent_state'
    | 'output_plausible'
    | 'confirming_wake'
    | 'evidence_complete'
  /**
   * The evidence reports an evidence-complete watch observed on this wake.
   * Present only in the evidence watch ledger.
   */
  evidence_roles?: EvidenceRoleObservation[]
  /**
   * The observation looked finished but its evidence was weak, so the watch
   * held it for one more observation instead of completing. Present on the
   * held wake, never on the wake that settles it.
   */
  completion_hold?: WeakCompletionReason
  stall_cause?: WatchStallCause
  /** Named non-blocking diagnostics observed on this wake. */
  advisories?: string[]
  changed?: boolean
  unchanged_wakes?: number
  terminal_state?: WatchTerminalState
  /** The signal that closed an `interrupted` terminal wake. */
  interrupted_reason?: string
  /** The agent stop behind an `unverified` terminal wake, when one was. */
  unverified_reason?: AgentStopReason
  /** Present on `gap` entries. */
  gap?: WatchGap
  /** Present on `session_ended`: why a session closed without a verdict. */
  session_end_reason?: 'sibling_handoff'
}

export interface WatchResult {
  state: WatchTerminalState
  run_id: string
  invocation_id: string
  output_path: string
  record_path: string
  cadence_seconds: number
  stall_timeout_seconds: number
  /** Compatibility count derived from the duration and active cadence. */
  stall_wakes: number
  timeout_seconds: number
  armings: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  background_marker_path: string | null
  /** The session this watch process owned in the ledger. */
  watch_session_id: string
  /** Gaps the session discovered in the prior ledger before arming. */
  gaps: WatchGap[]
  /** The signal that ended an `interrupted` watch, when one did. */
  interrupted_signal?: string
  /** Exact command that starts another bounded observation after timeout. */
  rearm_command?: string
  /**
   * The worker's last known activity behind a `stalled`, `unverified`, or
   * `timed_out` verdict. Absent for every other state.
   */
  stall_evidence?: WatchStallEvidence
}

/**
 * What a `stalled`, `unverified`, or `timed_out` verdict rests on: the
 * worker's last known activity from the hook-fed agent index, so a
 * supervisor deciding on recovery reads it in the same place it reads the
 * verdict, under `DELEGATE-001`. `agent_id: null` means the index has no
 * entry for the worker at all, distinct from an indexed worker with no open
 * call.
 */
export interface WatchStallEvidence {
  agent_id: string | null
  last_event_kind: EventKind | null
  last_event_at: string | null
  last_event_age_seconds: number | null
  open_call: {
    tool: string
    started_at: string
    age_seconds: number
    summary?: string
    shell_heartbeat: ShellHeartbeat | null
  } | null
  stall_suppressed: boolean
}

export interface WatchOptions {
  invocationId?: string
  cadenceSeconds?: number
  /**
   * Trimmed operator direction authorizing a non-default cadence. The CLI
   * refuses a non-default cadence without it; the library records it on the
   * session so later audits can name the authority.
   */
  cadenceAuthority?: string
  stallTimeoutSeconds?: number
  /** Test and compatibility override; ordinary callers configure a duration. */
  stallWakes?: number
  timeoutSeconds?: number
  markBackground?: boolean
  /**
   * ISO-8601 time the supervisor made the launch. Supplying it is the only
   * way the harness learns a launch time it did not witness itself, and it
   * is what makes a late arming measurable.
   */
  launchedAt?: string
  /**
   * ISO-8601 time the platform returned control for the launch, and the time
   * it detached the launch into the background, when it reported either.
   * Lateness is measured from these rather than from the launch itself.
   */
  platformReturnedAt?: string
  platformDetachedAt?: string
  /**
   * The platform identity of the launched worker. Recording it at the arm
   * makes the handle a byproduct of supervision the supervisor already owes.
   */
  workerHandle?: string
  /** The launched agent's state, as the supervisor observed it. */
  agentState?: WatchAgentState
  /**
   * Harness-relative path of the recorded supervisor inspection behind
   * `--agent-state`. Without it a `completed` report buys one confirming
   * wake rather than a verdict.
   */
  agentStateEvidence?: string
  /** Injected for tests. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
  /** Injected for tests alongside `sleep`. Defaults to `Date.now`. */
  now?: () => number
  onWake?: (entry: WatchRecordEntry) => void
  /** Fired once with the `session_started` entry before the first arming. */
  onSessionStart?: (entry: WatchRecordEntry) => void
  /** Fired for each gap the session discovered before arming. */
  onGap?: (entry: WatchRecordEntry) => void
  /**
   * Test hook replacing the signal re-raise that ends an interrupted watch.
   * Production re-raises so the process exits with the conventional status.
   */
  onInterrupted?: (signal: string) => void
}

/** Digest of a stage record's delegation watch, written by `pan submit`. */
export interface DelegationWatchSummary {
  record_path: string
  record_present: boolean
  background_marked: boolean
  /** Seconds from the launch to the first background mark, when both are known. */
  background_mark_delay_seconds: number | null
  /**
   * What the delay was measured against. `platform_return` is the evidenced
   * control return; `launch_unattributed` is the numerical fallback that
   * cannot separate platform launch latency from supervisor delay.
   */
  background_mark_delay_basis: 'platform_return' | 'launch_unattributed' | null
  /** The first mark came later than `DELEGATION_WATCH_LATE_SECONDS`. */
  background_watch_late: boolean
  armings: number
  wakes: number
  first_armed_at: string | null
  last_wake_at: string | null
  /**
   * The last wake observed a finished output with no pending completion hold,
   * and that output has not moved since. A watch that never reached a verdict of its own — the supervisor
   * stopped awaiting it when the platform said the worker was done — still
   * holds this observation, and it is the same fact a completed wake carries.
   */
  last_wake_observed_final_output: boolean
  /**
   * The weak-evidence hold on the last wake of a record with no verdict: the
   * confirming wake it bought never ran.
   */
  last_wake_completion_hold: WeakCompletionReason | null
  terminal_state: WatchTerminalState | null
  /** What the terminal verdict rested on, when it was `completed`. */
  terminal_basis: 'agent_state' | 'output_plausible' | 'confirming_wake' | null
  cadence_seconds: number | null
  /**
   * Every session whose cadence differed from the default, with the authority
   * recorded for it. The ledger's first cadence alone masked later exceptions.
   */
  cadence_exceptions: Array<{
    cadence_seconds: number
    authority: string | null
  }>
  /** First-arming to last-wake span across the whole ledger, in seconds. */
  raw_span_seconds: number | null
  /**
   * Union of the per-session observed intervals, excluding recorded gaps.
   * Widely separated starts cannot manufacture coverage from a raw span.
   */
  covered_seconds: number | null
  /** `covered_seconds` over the launch-to-output elapsed time. */
  coverage_ratio: number | null
  /** What the ratio was computed from; null when no launch clock exists. */
  coverage_basis: 'launch_record' | 'unknown' | null
  /** Awaitedness the transport could establish. Never fabricated. */
  await_status: 'unknown' | null
  /** The background mark ran with no attached terminal. */
  unawaited_timer_suspected: boolean
}

export const DELEGATION_UNOBSERVED = 'DELEGATION_UNOBSERVED'

export const DELEGATION_WATCH_LATE = 'DELEGATION_WATCH_LATE'

/**
 * How long after a launch a background watch may be armed before the run
 * records that supervision was late. `DELEGATE-001` says "immediately"; this
 * is the number that makes the word auditable.
 */
export const DELEGATION_WATCH_LATE_SECONDS = 60

/**
 * The supervisor's attestation that a foreground launch returned with the
 * worker output present. `DELEGATE-001` binds a foreground blocking call to
 * launch evidence before the call and completion evidence after it; this
 * record is that completion evidence, written by the harness.
 */
export interface ForegroundReturnRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  launch_mode: 'foreground'
  /** Wall-clock time the launch happened, as the launch record holds it. */
  launched_at: string
  /** Where the launch record got `launched_at`. */
  launched_at_source: LaunchTimeSource
  /** Wall-clock time the supervisor observed the launch return. */
  returned_at: string
  elapsed_seconds: number
  /**
   * The watch record's own first-to-last wake span, when it holds two wakes.
   * The watch saw the worker across it, so the elapsed time above cannot
   * honestly be shorter.
   */
  elapsed_lower_bound_seconds: number | null
  /** `elapsed_seconds` fell below that lower bound. */
  elapsed_implausible: boolean
  /** Names both numbers when they disagree, else null. */
  elapsed_implausibility: string | null
  /** Terminal-state inspection of the output and evidence paths at return. */
  observation: WatchObservation
  watch_record_path: string
  launch_record_path: string
  recorded_at: string
}

/** Digest of the foreground-return attestation `pan submit` carries. */
export interface ForegroundReturnSummary {
  record_path: string
  record_present: boolean
  launched_at: string | null
  returned_at: string | null
  elapsed_seconds: number | null
  /** The watch's first-to-last wake span, when the record named one. */
  elapsed_lower_bound_seconds: number | null
  /** The attested elapsed time is shorter than that lower bound. */
  elapsed_implausible: boolean
  output_present_at_return: boolean | null
}

/** How `pan submit` saw the delegation reach its terminal state. */
export type DelegationObservationSource =
  | 'watch_completed'
  | 'watch_observed_final_output'
  | 'foreground_return'
  | 'external_executor'

export interface DelegationObservation {
  observed: boolean
  source: DelegationObservationSource | null
  watch: DelegationWatchSummary
  foreground_return: ForegroundReturnSummary
  /** Where `pan delegate` writes the delegation-execution record. */
  execution_record_path: string
  execution_record_present: boolean
  /**
   * Whether `pan delegate` is the dispatch path an operator session would have
   * used for this stage. It shapes the refusal wording only: a Cursor stage
   * that session delegated itself is not an external executor and must not be
   * sent to a command that refuses it.
   */
  external_executor: boolean
}

export interface ForegroundReturnOptions {
  invocationId?: string
  /** ISO-8601 launch time the supervisor recorded before the call. */
  launchedAt?: string
}

/**
 * Where a launch time came from.
 *
 * `supervisor` is the only one the harness did not infer: the supervisor
 * passed `--launched-at` because it knows when it made the call. `watch_arm`
 * is the first arming of the watch, which is the earliest moment the harness
 * itself can witness. `invocation_record` is the last resort for a foreground
 * return attested without any prior arming.
 */
export type LaunchTimeSource = 'supervisor' | 'watch_arm' | 'invocation_record'
