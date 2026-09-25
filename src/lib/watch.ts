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
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PanError, invariant, isNodeError } from './errors.js'
import { gitWorkspaceActivityFingerprint, gitWorkspaceSnapshot } from './git.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  processIsAlive,
  readJson,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { isUntouchedScaffold } from './requirements/scaffold.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState, operationMutexPath, persist } from './state.js'
import type { Invocation, RunState } from './types.js'
import {
  delegationExecutionPath,
  loadDelegationExecutionRecord,
} from './validation.js'

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
  /** Stable digest of the watched paths; equal digests mean no change. */
  fingerprint: string
}

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
  terminal_basis?: 'agent_state' | 'output_plausible' | 'confirming_wake'
  /**
   * The observation looked finished but its evidence was weak, so the watch
   * held it for one more observation instead of completing. Present on the
   * held wake, never on the wake that settles it.
   */
  completion_hold?: WeakCompletionReason
  /** Named non-blocking diagnostics observed on this wake. */
  advisories?: string[]
  changed?: boolean
  unchanged_wakes?: number
  terminal_state?: WatchTerminalState
  /** The signal that closed an `interrupted` terminal wake. */
  interrupted_reason?: string
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

export function watchRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(`${invocationId}-watch.jsonl`)
    .relative
}

export function backgroundMarkerPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-delegation-background.json`,
  ).relative
}

/**
 * The ownership lock one live watcher holds over its invocation. It is
 * independent of the run-operation mutex: a watch holds it for minutes while
 * ordinary `pan` commands keep mutating the run.
 */
export function watchLockPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(`${invocationId}-watch.lock`)
    .relative
}

export function foregroundReturnRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-foreground-return.json`,
  ).relative
}

/**
 * Resolve the invocation a watch targets: the named one, else the run's
 * current pending invocation.
 */
export function resolveWatchedInvocation(
  root: string,
  runId: string,
  invocationId?: string,
): Invocation {
  const state = loadState(root, runId)
  const targetId = invocationId ?? state.current_invocation?.id

  invariant(
    targetId,
    `Run ${runId} has no pending invocation to watch. Name one with --invocation.`,
    { code: 'NO_ACTIVE_INVOCATION' },
  )

  const jsonPath = resolveRunLayout(root, runId).invocation(
    targetId,
    '.json',
  ).relative
  const absolute = resolveInside(root, jsonPath)

  invariant(fileExists(absolute), `Invocation record not found: ${jsonPath}`, {
    code: 'INVOCATION_NOT_FOUND',
  })

  const value = readJson(absolute)

  invariant(
    isRecord(value) && value.invocation_id === targetId,
    `${jsonPath} MUST contain invocation ${targetId}.`,
    { code: 'INVALID_INVOCATION' },
  )

  return value as unknown as Invocation
}

function observePath(
  root: string,
  relativePath: string,
): WatchedPathObservation {
  try {
    const stats = statSync(resolveInside(root, relativePath))

    return {
      path: relativePath,
      exists: true,
      size: stats.size,
      mtime_ms: stats.mtimeMs,
    }
  } catch {
    return { path: relativePath, exists: false, size: null, mtime_ms: null }
  }
}

/**
 * Evidence paths the invocation owns: the files already on disk under the
 * `<invocation-id>` name prefix, plus every evidence-worker report the
 * invocation declares.
 *
 * The listing alone cannot see a report nobody has written, so a watch armed
 * before an evidence worker produced anything read its absence as no change
 * at all. Declaring the path makes that report pending rather than invisible.
 */
export function invocationEvidencePaths(
  root: string,
  runId: string,
  invocation: Pick<Invocation, 'invocation_id' | 'evidence_workers'>,
): string[] {
  const invocationId = invocation.invocation_id
  const evidenceDir = resolveRunLayout(root, runId).evidence('.')
  const own = new Set([
    path.basename(watchRecordPath(root, runId, invocationId)),
    path.basename(backgroundMarkerPath(root, runId, invocationId)),
    path.basename(foregroundReturnRecordPath(root, runId, invocationId)),
    path.basename(watchLockPath(root, runId, invocationId)),
  ])
  const paths = new Set<string>()

  try {
    for (const name of readdirSync(evidenceDir.absolute)) {
      if (name.startsWith(invocationId) && !own.has(name)) {
        paths.add(path.posix.join(evidenceDir.relative, name))
      }
    }
  } catch {
    // A run whose evidence directory does not exist yet still declares paths.
  }

  // Every attempt of a role, not the role's first path alone: a relaunched
  // worker writes its own report, and the watch is what says that report is
  // still pending.
  for (const worker of invocation.evidence_workers ?? []) {
    for (const declared of [
      worker.evidence_path,
      ...(worker.attempts ?? []).map((attempt) => attempt.evidence_path),
    ]) {
      if (typeof declared === 'string') {
        paths.add(declared)
      }
    }
  }

  return [...paths].sort()
}

/**
 * Declared required fields the observed output document does not carry.
 *
 * `required_data` keys are dotted paths under `data`. `result` is checked
 * alongside them because a submission without it is rejected, so a document
 * missing it is not one the supervisor could submit. The scaffold emits
 * `result`, so an untouched scaffold reaches this check with nothing
 * missing; `output_is_scaffold` is what separates a scaffold from a
 * finished output.
 */
export function missingRequiredOutputFields(
  parsed: unknown,
  requiredData: Record<string, string> | undefined,
): string[] {
  if (!isRecord(parsed)) {
    return []
  }

  const missing: string[] = []

  if (typeof parsed.result !== 'string' || parsed.result.trim().length === 0) {
    missing.push('result')
  }

  for (const dotted of Object.keys(requiredData ?? {})) {
    let current: unknown = parsed.data

    for (const key of dotted.split('.')) {
      current = isRecord(current) ? current[key] : undefined
    }

    if (current === undefined || current === null) {
      missing.push(`data.${dotted}`)
    }
  }

  return missing
}

/**
 * Digest of every regular file under one directory tree by relative path,
 * size, and mtime. The run's `agent/` tree is small, so a full walk per wake
 * costs less than one missed evidence write.
 */
function directoryTreeFingerprint(
  directory: string,
  exclude: (relativePath: string) => boolean,
): string {
  const lines: string[] = []
  const pending = [directory]

  while (pending.length > 0) {
    const current = pending.pop() as string
    let names: string[]

    try {
      names = readdirSync(current)
    } catch {
      continue
    }

    for (const name of names) {
      const absolute = path.join(current, name)

      try {
        const stats = statSync(absolute)

        if (stats.isDirectory()) {
          pending.push(absolute)
        } else if (stats.isFile()) {
          const relative = path.relative(directory, absolute)

          if (!exclude(relative)) {
            lines.push(`${relative}:${stats.size}:${stats.mtimeMs}`)
          }
        }
      } catch {
        continue
      }
    }
  }

  return sha256(lines.sort().join('\n'))
}

/**
 * Fingerprint of the workspace the invocation edits, or null when the
 * invocation names no readable workspace. Failures are swallowed: a watch
 * must never die because a fingerprint could not be taken.
 */
function workspaceFingerprint(
  root: string,
  invocation: Invocation,
): string | null {
  const declared = invocation.workspace_root

  if (typeof declared !== 'string' || declared.length === 0) {
    return null
  }

  const workspace = path.isAbsolute(declared)
    ? declared
    : path.resolve(root, declared)

  if (!fileExists(workspace)) {
    return null
  }

  try {
    return gitWorkspaceActivityFingerprint(workspace)
  } catch {
    return null
  }
}

/** Inspect the invocation's output and evidence paths once. */
export const OUTPUT_SCAFFOLD_ORDER_ADVISORY =
  'OUTPUT_SCAFFOLD_MISSING_BEFORE_WORKSPACE_CHANGE'

function workspaceChangedFromInvocation(
  root: string,
  invocation: Invocation,
): boolean | null {
  const declared = invocation.workspace_root

  if (typeof declared !== 'string' || declared.length === 0) {
    return null
  }

  const workspace = path.isAbsolute(declared)
    ? declared
    : path.resolve(root, declared)

  if (!fileExists(workspace)) {
    return null
  }

  try {
    return (
      gitWorkspaceSnapshot(workspace).fingerprint !==
      invocation.workspace_before.fingerprint
    )
  } catch {
    return null
  }
}

export function observeInvocation(
  root: string,
  invocation: Invocation,
): WatchObservation {
  const outputPath = invocation.output.path
  const outputAbsolute = resolveInside(root, outputPath)

  let outputPresent = false
  let outputParses = false
  let outputMatches = false
  let outputIsScaffold = false

  let missingRequired: string[] = []

  if (fileExists(outputAbsolute)) {
    outputPresent = true

    try {
      const parsed = JSON.parse(readText(outputAbsolute)) as unknown

      outputParses = isRecord(parsed)
      outputMatches =
        isRecord(parsed) &&
        (parsed.invocation_id === invocation.invocation_id ||
          // A revision submission names the current card inside its patch.
          (isRecord(parsed.patch) &&
            parsed.patch.invocation_id === invocation.invocation_id))
      outputIsScaffold = isUntouchedScaffold(parsed)
      // A revision patch declares only the fields it changes, so the whole
      // contract cannot be required of it.
      missingRequired =
        isRecord(parsed) && isRecord(parsed.patch)
          ? []
          : missingRequiredOutputFields(
              parsed,
              invocation.output?.required_data,
            )
    } catch {
      outputParses = false
    }
  }

  // The delegation artifact is the worker's input, not its product. A change
  // to it is the supervisor re-rendering a card, so counting it as progress
  // reset the stall count and the confirming wake on an idle worker.
  const watched = [
    outputPath,
    ...invocationEvidencePaths(root, invocation.run_id, invocation),
  ].map((relative) => observePath(root, relative))
  // The watch's own records, the background marker, the preserved blocked
  // outputs, and the event log change on every wake by construction, so they
  // are excluded from the progress digest; otherwise no watch could ever
  // observe a stall.
  const layout = resolveRunLayout(root, invocation.run_id)
  const runTree = directoryTreeFingerprint(layout.root.absolute, (relative) => {
    const name = path.basename(relative)

    return (
      name.endsWith('-watch.jsonl') ||
      name.endsWith('-watch.lock') ||
      name.endsWith('-delegation-background.json') ||
      name.endsWith('-launch.json') ||
      name.endsWith('.delegation.md') ||
      BLOCKED_OUTPUT_SNAPSHOT_PATTERN.test(name) ||
      name === 'events.jsonl' ||
      name === 'state.json' ||
      name.startsWith('.')
    )
  })
  const workspace = workspaceFingerprint(root, invocation)
  const workspaceChanged = outputPresent
    ? null
    : workspaceChangedFromInvocation(root, invocation)
  const fingerprint = [
    ...watched.map(
      (item) => `${item.path}:${item.exists}:${item.size}:${item.mtime_ms}`,
    ),
    `run-tree:${runTree}`,
    `workspace:${workspace ?? 'none'}`,
  ].join('|')

  return {
    observed_at: new Date().toISOString(),
    output_path: outputPath,
    output_present: outputPresent,
    output_parses: outputParses,
    output_is_scaffold: outputIsScaffold,
    output_missing_required_fields: missingRequired,
    output_matches_invocation: outputMatches,
    watched_paths: watched,
    run_tree_fingerprint: runTree,
    ...(workspace ? { workspace_fingerprint: workspace } : {}),
    ...(workspaceChanged !== null
      ? { workspace_changed_from_invocation: workspaceChanged }
      : {}),
    fingerprint,
  }
}

export function parseCadenceSeconds(
  value: string | null,
  authority?: string | null,
): number {
  if (value === null) {
    return DEFAULT_WATCH_CADENCE_SECONDS
  }

  const parsed = Number(value)

  if (Number.isNaN(parsed)) {
    throw new PanError(`--cadence-seconds MUST be a number, not '${value}'.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (!Number.isFinite(parsed) || parsed < MIN_WATCH_CADENCE_SECONDS) {
    throw new PanError(
      `--cadence-seconds MUST be a finite number of at least ${MIN_WATCH_CADENCE_SECONDS}.`,
      { code: WATCH_CADENCE_BELOW_MINIMUM },
    )
  }

  const trimmed = authority?.trim()

  if (parsed !== DEFAULT_WATCH_CADENCE_SECONDS && !trimmed) {
    throw new PanError(
      `--cadence-seconds ${parsed} differs from the one 60-second cadence ` +
        `DELEGATE-001 fixes. A cadence exception needs the recorded operator ` +
        `direction: pass --cadence-directed-by-operator <reason>.`,
      { code: WATCH_CADENCE_UNAUTHORIZED },
    )
  }

  return parsed
}

/**
 * Recognize the legacy `--stall-wakes` count as a duration override.
 *
 * The count only ever meant "this many cadences without change", so the
 * supported conversion is back into seconds against the resolved cadence. A
 * count of 1 named "stall on the first quiet wake", which was never a
 * supported behavior; refusing it beats silently ignoring it.
 */
export function parseStallWakes(
  value: string | null,
  cadenceSeconds: number,
): number | null {
  if (value === null) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PanError(`--stall-wakes MUST be a positive integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (parsed === 1) {
    throw new PanError(
      `--stall-wakes 1 would call the first quiet wake a stall. The stall ` +
        `bound is a duration: pass --stall-timeout-seconds, or a wake count ` +
        `of at least 2.`,
      { code: WATCH_STALL_WAKES_TOO_SMALL },
    )
  }

  return parsed * cadenceSeconds
}

export function parseAgentState(value: string | null): WatchAgentState | null {
  if (value === null) {
    return null
  }

  if (value !== 'running' && value !== 'completed') {
    throw new PanError(
      `--agent-state MUST be 'running' or 'completed', not '${value}'. It ` +
        `reports what you saw when you inspected the launched agent itself.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value
}

export function parsePositiveInteger(
  value: string | null,
  name: string,
  fallback: number,
): number {
  if (value === null) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PanError(`${name} MUST be a positive integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}

export function parseTimeoutSeconds(value: string | null): number {
  if (value === null) {
    return DEFAULT_WATCH_TIMEOUT_SECONDS
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PanError('--timeout-seconds MUST be a positive number.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
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

/**
 * When the worker behind one invocation was launched, and how well the
 * harness knows it.
 *
 * Every launch-relative number the harness reports reads this record. The
 * delegation artifact used to serve that purpose, but `pan prepare` writes it
 * and the supervisor can spend minutes reading the card before it launches
 * anything, so its modification time measured reading and called it lateness.
 */
export interface LaunchRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  launch_mode: 'background' | 'foreground' | 'unknown'
  launched_at: string
  launched_at_source: LaunchTimeSource
  /**
   * The platform identity the arming supervisor supplied, or null when it
   * supplied none. Null is a recorded answer, not a missing one.
   */
  worker_handle: string | null
  /**
   * When the platform returned control for the launch, and when it detached
   * the launch into the background, as evidenced at the first background
   * mark. Lateness is measured from these rather than from the launch, so
   * platform launch latency is never attributed to supervisor delay.
   */
  platform_returned_at?: string | null
  platform_returned_at_source?:
    | 'supervisor_assertion'
    | 'harness_observed'
    | null
  platform_detached_at?: string | null
  recorded_at: string
}

export interface LaunchRecordOptions {
  /** ISO-8601 launch time the supervisor recorded for the call itself. */
  launchedAt?: string
  /** Launch time to record when neither a supervisor time nor a record exists. */
  defaultLaunchedAtMs: number
  defaultSource: Exclude<LaunchTimeSource, 'supervisor'>
  launchMode?: LaunchRecord['launch_mode']
  workerHandle?: string
  /** ISO-8601 platform control-return and detach times, when reported. */
  platformReturnedAt?: string
  platformDetachedAt?: string
}

export function launchRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(`${invocationId}-launch.json`)
    .relative
}

export function readLaunchRecord(
  root: string,
  runId: string,
  invocationId: string,
): LaunchRecord | null {
  const absolute = resolveInside(
    root,
    launchRecordPath(root, runId, invocationId),
  )

  if (!fileExists(absolute)) {
    return null
  }

  try {
    const value = readJson(absolute)

    return isRecord(value) &&
      value.schema_version === 1 &&
      value.invocation_id === invocationId &&
      typeof value.launched_at === 'string'
      ? (value as unknown as LaunchRecord)
      : null
  } catch {
    return null
  }
}

/** Launch time from the record in epoch milliseconds, or null. */
function launchedMsFromRecord(record: LaunchRecord | null): number | null {
  if (record === null) {
    return null
  }

  const parsed = Date.parse(record.launched_at)

  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The launch time `recordInvocationLaunch` would record, without writing it.
 *
 * A caller that rejects an impossible time needs the answer before the
 * record exists, because a rejected value must never reach the file every
 * later reader trusts.
 */
export function resolveLaunchMs(
  root: string,
  runId: string,
  invocationId: string,
  options: LaunchRecordOptions,
): number {
  return options.launchedAt !== undefined
    ? parseIsoTime(options.launchedAt, '--launched-at')
    : (launchedMsFromRecord(readLaunchRecord(root, runId, invocationId)) ??
        Math.floor(options.defaultLaunchedAtMs))
}

/**
 * Write or amend the invocation's launch record and return it.
 *
 * The recorded time is decided once, at the first arming, so re-arming a
 * watch does not reset the clock a lateness advisory measures against. The
 * supervisor's own `--launched-at` is the exception: it is the only source
 * that knows the launch rather than inferring it, so it corrects a recorded
 * default. A handle or a launch mode learned later fills a gap the first
 * arming left and never contradicts a recorded time.
 */
export function recordInvocationLaunch(
  root: string,
  runId: string,
  invocationId: string,
  options: LaunchRecordOptions,
): LaunchRecord {
  const existing = readLaunchRecord(root, runId, invocationId)
  const launchedMs = resolveLaunchMs(root, runId, invocationId, options)
  const launchMode =
    options.launchMode && options.launchMode !== 'unknown'
      ? options.launchMode
      : (existing?.launch_mode ?? 'unknown')

  // The platform return and detach clocks are recorded once, at the first
  // supply, and a later supply fills a gap without moving a recorded one.
  const platformReturnedAt =
    options.platformReturnedAt !== undefined
      ? new Date(
          parseIsoTime(options.platformReturnedAt, '--platform-returned-at'),
        ).toISOString()
      : (existing?.platform_returned_at ?? null)
  const platformDetachedAt =
    options.platformDetachedAt !== undefined
      ? new Date(
          parseIsoTime(options.platformDetachedAt, '--platform-detached-at'),
        ).toISOString()
      : (existing?.platform_detached_at ?? null)

  // An impossible order is rejected before the record every later reader
  // trusts is touched.
  for (const [name, value] of [
    ['--platform-returned-at', platformReturnedAt],
    ['--platform-detached-at', platformDetachedAt],
  ] as const) {
    if (value !== null) {
      invariant(
        Date.parse(value) >= launchedMs,
        `${name} ${value} is before the launch ${new Date(launchedMs).toISOString()}.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }
  }

  const record: LaunchRecord = {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: launchMode,
    launched_at: new Date(launchedMs).toISOString(),
    launched_at_source:
      options.launchedAt !== undefined
        ? 'supervisor'
        : (existing?.launched_at_source ?? options.defaultSource),
    worker_handle: options.workerHandle ?? existing?.worker_handle ?? null,
    platform_returned_at: platformReturnedAt,
    platform_returned_at_source:
      platformReturnedAt !== null
        ? options.platformReturnedAt !== undefined
          ? 'supervisor_assertion'
          : (existing?.platform_returned_at_source ?? 'supervisor_assertion')
        : null,
    platform_detached_at: platformDetachedAt,
    recorded_at: new Date().toISOString(),
  }

  writeJsonAtomic(
    resolveInside(root, launchRecordPath(root, runId, invocationId)),
    record,
  )

  return record
}

/** Record that the platform turned this launch into a background subagent. */
export function markDelegationBackground(
  root: string,
  runId: string,
  invocationId: string,
  options: { markedAtMs?: number } = {},
): string {
  const relative = backgroundMarkerPath(root, runId, invocationId)
  const absolute = resolveInside(root, relative)
  const existing = fileExists(absolute) ? readJson(absolute) : null

  const markedAt = new Date(options.markedAtMs ?? Date.now()).toISOString()
  const firstMarkedAt =
    isRecord(existing) && typeof existing.first_marked_at === 'string'
      ? existing.first_marked_at
      : markedAt

  // Only the launch record answers when supervision was owed. Without this
  // number a supervisor that armed the watch at once and one that armed it
  // after an operator reprimand leave identical evidence.
  const launch = readLaunchRecord(root, runId, invocationId)
  const launchedAt = launch?.launched_at ?? null

  // The evidenced control-return or detach time is the lateness basis: the
  // platform's own launch latency is never the supervisor's delay. Without
  // it the launch-relative number stays as a labeled fallback that cannot
  // attribute lateness to anyone.
  const basisTime =
    launch?.platform_detached_at ?? launch?.platform_returned_at ?? null
  const delayBasis: 'platform_return' | 'launch_unattributed' =
    basisTime !== null ? 'platform_return' : 'launch_unattributed'
  const delayFrom = basisTime ?? launchedAt
  const delaySeconds =
    delayFrom === null
      ? null
      : (Date.parse(firstMarkedAt) - Date.parse(delayFrom)) / 1000

  // A return or detach evidenced after the first mark is a clock disorder the
  // record must not absorb silently.
  if (basisTime !== null) {
    invariant(
      Date.parse(basisTime) <= Date.parse(firstMarkedAt),
      `The platform return/detach time ${basisTime} is after the first ` +
        `background mark ${firstMarkedAt}.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  // The transport the mark was made over. No attached terminal means the
  // timer may be running unawaited; it is a suspicion to carry, never a
  // proof, and a flag alone never fabricates awaitedness either.
  const transport = {
    stdin_tty: Boolean(process.stdin.isTTY),
    stdout_tty: Boolean(process.stdout.isTTY),
    stderr_tty: Boolean(process.stderr.isTTY),
  }
  const anyTerminal =
    transport.stdin_tty || transport.stdout_tty || transport.stderr_tty

  writeJsonAtomic(absolute, {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: 'background',
    redline_category: PLATFORM_ACTION_CATEGORY.id,
    launched_at: launchedAt,
    launched_at_source: launch?.launched_at_source ?? null,
    platform_returned_at: launch?.platform_returned_at ?? null,
    platform_detached_at: launch?.platform_detached_at ?? null,
    first_marked_at: firstMarkedAt,
    mark_delay_seconds: delaySeconds,
    mark_delay_basis: delayBasis,
    late:
      delayBasis === 'platform_return' && delaySeconds !== null
        ? delaySeconds > DELEGATION_WATCH_LATE_SECONDS
        : false,
    transport,
    await_status: 'unknown',
    unawaited_timer_suspected: !anyTerminal,
    marked_at: markedAt,
    watch_record_path: watchRecordPath(root, runId, invocationId),
    launch_record_path: launchRecordPath(root, runId, invocationId),
  })

  return relative
}

function parseIsoTime(value: string, name: string): number {
  const parsed = Date.parse(value)

  if (!Number.isFinite(parsed)) {
    throw new PanError(`${name} MUST be an ISO-8601 wall-clock time.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}

/**
 * A process's start identity, so a reused PID cannot impersonate the watched
 * process. `ps -o lstart=` answers on macOS and Linux; an unavailable answer
 * degrades to null, which callers treat as "identity unknown" rather than as
 * a match.
 */
export function processStartIdentity(pid: number): string | null {
  if (!processIsAlive(pid)) {
    return null
  }

  try {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    })

    if (result.error || result.status !== 0) {
      return null
    }

    const identity = result.stdout.trim()

    return identity.length > 0 ? identity : null
  } catch {
    return null
  }
}

/**
 * Whether the process is a zombie: exited but not yet reaped. `kill(pid, 0)`
 * still succeeds for one, so liveness without this check reads a dead child
 * as alive until its parent collects it.
 */
export function processIsZombie(pid: number): boolean {
  try {
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    })

    if (result.error || result.status !== 0) {
      return false
    }

    return result.stdout.trim().toUpperCase().startsWith('Z')
  } catch {
    return false
  }
}

/** Liveness for watch purposes: present in the process table and not a zombie. */
function processRunning(pid: number): boolean {
  return processIsAlive(pid) && !processIsZombie(pid)
}

/** The validated content of a `--agent-state-evidence` record. */
export interface AgentStateEvidence {
  path: string
  digest: string
  run_id: string
  invocation_id: string
  observed_state: WatchAgentState
  observed_at: string
  record_source: string
  evidence_reference: string
}

/**
 * Load and validate the recorded supervisor inspection behind an agent-state
 * report. The record is a supervisor assertion: it is checked for shape,
 * identity, and clock sanity, then labeled rather than trusted blindly.
 */
export function loadAgentStateEvidence(
  root: string,
  runId: string,
  invocationId: string,
  evidencePath: string,
  nowMs: number = Date.now(),
): AgentStateEvidence {
  const absolute = resolveInside(root, evidencePath)
  const logsRoot = resolveInside(root, 'runtime/logs')

  invariant(
    absolute === logsRoot || absolute.startsWith(`${logsRoot}${path.sep}`),
    `--agent-state-evidence MUST resolve inside the runtime evidence tree ` +
      `(runtime/logs): ${evidencePath}`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    fileExists(absolute),
    `--agent-state-evidence record not found: ${evidencePath}`,
    { code: WATCH_EVIDENCE_INVALID },
  )

  let value: unknown

  try {
    value = readJson(absolute)
  } catch {
    throw new PanError(
      `--agent-state-evidence record is not readable JSON: ${evidencePath}`,
      { code: WATCH_EVIDENCE_INVALID },
    )
  }

  const record = isRecord(value) ? value : {}
  const observedState = record.observed_state
  const observedAt = record.observed_at

  invariant(
    record.run_id === runId && record.invocation_id === invocationId,
    `--agent-state-evidence record ${evidencePath} names run ` +
      `${String(record.run_id)} invocation ${String(record.invocation_id)}, ` +
      `not ${runId} ${invocationId}.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    observedState === 'running' || observedState === 'completed',
    `--agent-state-evidence record ${evidencePath} MUST carry ` +
      `observed_state 'running' or 'completed'.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt)),
    `--agent-state-evidence record ${evidencePath} MUST carry an ISO-8601 ` +
      `observed_at.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    Date.parse(observedAt) <= nowMs + 60_000,
    `--agent-state-evidence record ${evidencePath} is future-dated ` +
      `(${observedAt}).`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof record.source === 'string' && record.source.trim().length > 0,
    `--agent-state-evidence record ${evidencePath} MUST name its source.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof record.evidence === 'string' && record.evidence.trim().length > 0,
    `--agent-state-evidence record ${evidencePath} MUST name the evidence ` +
      `reference the inspection rests on.`,
    { code: WATCH_EVIDENCE_INVALID },
  )

  return {
    path: evidencePath,
    digest: sha256(readText(absolute)),
    run_id: runId,
    invocation_id: invocationId,
    observed_state: observedState,
    observed_at: observedAt,
    record_source: record.source.trim(),
    evidence_reference: record.evidence.trim(),
  }
}

/**
 * The conditions that make an observation terminal.
 *
 * Parsing as a non-scaffold document is not enough: a plausible draft reads
 * exactly like a finished stage until the declared required fields are all
 * there, so the invocation's own output contract decides.
 */
export function isTerminalObservation(observation: WatchObservation): boolean {
  return (
    observation.output_present &&
    observation.output_parses &&
    observation.output_matches_invocation &&
    !observation.output_is_scaffold &&
    (observation.output_missing_required_fields ?? []).length === 0
  )
}

/**
 * Seconds between the launch and the output the watch is about to call
 * terminal, or null when either time is unreadable. The launch time is the
 * one the launch record holds, which is also what the foreground-return
 * attestation reports.
 */
export function launchToOutputSeconds(
  root: string,
  runId: string,
  invocationId: string,
): number | null {
  const launchedMs = launchedMsFromRecord(
    readLaunchRecord(root, runId, invocationId),
  )
  const output = observePath(
    root,
    resolveRunLayout(root, runId).output(invocationId).relative,
  )

  if (launchedMs === null || output.mtime_ms === null) {
    return null
  }

  return (output.mtime_ms - launchedMs) / 1000
}

/**
 * Seconds between the first and the last wake the invocation's watch record
 * holds, or null when it holds fewer than two wakes.
 *
 * The watch observed the worker across that whole span, so no honest
 * launch-to-return elapsed time can be shorter than it. It is the
 * independent lower bound a foreground-return attestation is checked against.
 */
export function watchWakeSpanSeconds(
  root: string,
  runId: string,
  invocationId: string,
): number | null {
  const wakes = readWatchRecord(root, runId, invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  if (wakes.length < 2) {
    return null
  }

  const first = Date.parse(wakes[0].recorded_at)
  const last = Date.parse(wakes[wakes.length - 1].recorded_at)

  return Number.isFinite(first) && Number.isFinite(last)
    ? (last - first) / 1000
    : null
}

/** Snapshots of a `blocked` output, numbered from 1 beside their invocation. */
const BLOCKED_OUTPUT_SNAPSHOT_PATTERN = /\.blocked-\d+\.json$/u

export function blockedOutputSnapshotPath(
  root: string,
  runId: string,
  invocationId: string,
  ordinal: number,
): string {
  return resolveRunLayout(root, runId).invocation(
    invocationId,
    `.blocked-${ordinal}.json`,
  ).relative
}

/**
 * How long the snapshot event waits for a `pan` command holding the run mutex.
 *
 * The watched worker runs `./bin/pan` concurrently with the watch by design,
 * so contention here is an expected operational failure. A short wait clears
 * the common collision; a longer one would stall the wake that found it.
 */
const SNAPSHOT_EVENT_MUTEX_WAIT_MS = 250

/**
 * Append the `blocked_output_snapshotted` event, and report whether it landed.
 *
 * Losing the event must never end supervision: the snapshot file is already
 * on disk when this runs, so a contended run mutex costs the event-log entry
 * and nothing else. Every failure is swallowed rather than narrowed to
 * `RUN_OPERATION_IN_PROGRESS`, because no way of failing to write one audit
 * line is worth the watch the run depends on. A later observation retries.
 */
function recordBlockedSnapshotEvent(
  root: string,
  runId: string,
  invocationId: string,
  snapshotPath: string,
  ordinal: number,
): boolean {
  try {
    withOperationMutex(
      operationMutexPath(root, runId),
      () => {
        persist(root, loadState(root, runId), 'blocked_output_snapshotted', {
          invocation_id: invocationId,
          snapshot_path: snapshotPath,
          ordinal,
        })
      },
      { waitForHolderMs: SNAPSHOT_EVENT_MUTEX_WAIT_MS },
    )

    return true
  } catch {
    return false
  }
}

/** Whether the run's event log already names this snapshot. */
function blockedSnapshotEventRecorded(
  root: string,
  runId: string,
  snapshotPath: string,
): boolean {
  const absolute = resolveRunLayout(root, runId).events.absolute

  if (!fileExists(absolute)) {
    return false
  }

  return readText(absolute)
    .split('\n')
    .some((line) => {
      if (!line.includes('blocked_output_snapshotted')) {
        return false
      }

      try {
        const parsed = JSON.parse(line) as unknown

        return (
          isRecord(parsed) &&
          parsed.type === 'blocked_output_snapshotted' &&
          parsed.snapshot_path === snapshotPath
        )
      } catch {
        return false
      }
    })
}

/**
 * Preserve an output that reports `blocked` beside its own invocation.
 *
 * The output path belongs to the invocation rather than to the attempt, so a
 * worker relaunched against the same card rewrites it in place. A `blocked`
 * output is usually the most valuable thing a stage produced — it names the
 * precondition the run lacks — and it is exactly the one the supervisor
 * resolves without submitting, so nothing else in the run ever records it.
 *
 * Returns the snapshot path, or null when there is nothing new to preserve.
 * A second, different blocked output takes the next ordinal; the same one
 * observed again on a later wake is already preserved and writes nothing —
 * except the event a contended earlier observation could not write, which
 * this re-observation takes then.
 */
export function snapshotBlockedOutput(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const outputAbsolute = resolveInside(
    root,
    resolveRunLayout(root, runId).output(invocationId).relative,
  )

  if (!fileExists(outputAbsolute)) {
    return null
  }

  let text: string
  let parsed: unknown

  try {
    text = readText(outputAbsolute)
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.result !== 'blocked') {
    return null
  }

  const digest = sha256(text)
  let ordinal = 1

  for (;;) {
    const candidate = blockedOutputSnapshotPath(
      root,
      runId,
      invocationId,
      ordinal,
    )
    const candidateAbsolute = resolveInside(root, candidate)

    if (!fileExists(candidateAbsolute)) {
      writeTextAtomic(candidateAbsolute, text)
      recordBlockedSnapshotEvent(root, runId, invocationId, candidate, ordinal)

      return candidate
    }

    let candidateDigest: string

    try {
      candidateDigest = sha256(readText(candidateAbsolute))
    } catch {
      return null
    }

    if (candidateDigest === digest) {
      // Already preserved. The event it owes the run log is not durable the
      // way the file is, so a contended write on the observation that made
      // this snapshot lands here instead.
      if (!blockedSnapshotEventRecorded(root, runId, candidate)) {
        recordBlockedSnapshotEvent(
          root,
          runId,
          invocationId,
          candidate,
          ordinal,
        )
      }

      return null
    }

    ordinal += 1
  }
}

/**
 * How strong the evidence is that one observation shows a finished worker.
 *
 * Both the pre-loop check and every wake run this. Run 63310 genre-label
 * showed why: the early-output guard sat only before the timer, so a draft
 * that appeared after the loop started still terminated the watch.
 *
 * Three separate conditions used to end a watch on an answer it did not
 * have — a supervisor's running report, an output younger than one cadence,
 * and an unreadable elapsed time. All three mean the same thing, so all three
 * now produce `weak`, which buys one confirming wake rather than a verdict.
 */
export function completionEvidenceForObservation(
  observation: WatchObservation,
  sinceLaunchSeconds: number | null,
  cadenceSeconds: number,
  agentState?: WatchAgentState,
  agentStateEvidence?: AgentStateEvidence | null,
): CompletionEvidence {
  if (!isTerminalObservation(observation)) {
    return { strength: 'none' }
  }

  if (agentState === 'completed') {
    // A completion report without its recorded inspection is an assertion
    // nobody can audit, so it buys the same confirming wake a running report
    // does. The supplied record keeps the strong basis it validates.
    return agentStateEvidence
      ? { strength: 'strong', basis: 'agent_state' }
      : { strength: 'weak', reason: 'agent_completion_basis_missing' }
  }

  if (agentState === 'running') {
    return { strength: 'weak', reason: 'agent_reported_running' }
  }

  if (sinceLaunchSeconds === null) {
    return { strength: 'weak', reason: 'elapsed_time_unreadable' }
  }

  // An output written within one cadence of the launch is a draft far more
  // often than a finished stage, and files cannot tell the two apart.
  return sinceLaunchSeconds < cadenceSeconds
    ? { strength: 'weak', reason: 'output_younger_than_cadence' }
    : { strength: 'strong', basis: 'output_plausible' }
}

/** One POSIX shell word, safe for any free-text value. */
function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * The observed state of the output file itself, used to decide whether the
 * output moved across a confirming wake. The whole-observation fingerprint
 * cannot answer that: it also covers the run tree and the workspace, which
 * the watch's own records change on every wake.
 */
function outputSignature(observation: WatchObservation): string {
  const output = observation.watched_paths.find(
    (item) => item.path === observation.output_path,
  )

  return `${output?.exists ?? false}:${output?.size ?? null}:${output?.mtime_ms ?? null}`
}

function foregroundReturnNotTerminalMessage(
  observation: WatchObservation,
): string {
  return (
    `A foreground return cannot be attested: the output ` +
    `${observation.output_path} does not exist. The attestation records a ` +
    `launch the harness saw finish, and the output path is unique to this ` +
    `invocation. When the launch returned before the output existed, await ` +
    `\`pan watch <run-id>\` instead.`
  )
}

/**
 * Record that a foreground launch returned, with the launch and return
 * wall-clock times.
 *
 * The launch time comes from the invocation's launch record. A supervisor
 * that supplies `--launched-at` writes that record here; an arming watch
 * wrote it earlier. Only an attestation with neither falls back to the
 * invocation record's modification time, which is an upper bound on the
 * launch rather than the launch itself.
 */
export function recordForegroundReturn(
  root: string,
  runId: string,
  options: ForegroundReturnOptions = {},
): ForegroundReturnRecord {
  const invocation = resolveWatchedInvocation(root, runId, options.invocationId)
  const invocationId = invocation.invocation_id
  const returnedMs = Date.now()

  // File times carry sub-millisecond precision; `Date.now()` does not, so a
  // fractional mtime taken in the same millisecond would read as later.
  const invocationRecord = observePath(
    root,
    resolveRunLayout(root, runId).invocation(invocationId, '.json').relative,
  )
  const launchOptions: LaunchRecordOptions = {
    ...(options.launchedAt !== undefined
      ? { launchedAt: options.launchedAt }
      : {}),
    defaultLaunchedAtMs: Math.floor(invocationRecord.mtime_ms ?? returnedMs),
    defaultSource: 'invocation_record',
    launchMode: 'foreground',
  }

  const proposedMs = resolveLaunchMs(root, runId, invocationId, launchOptions)

  // A rejected launch time must not reach the record every later reader
  // trusts, so the impossible case fails before the write.
  invariant(
    proposedMs <= returnedMs,
    `The launch time ${new Date(proposedMs).toISOString()} is after the ` +
      `return time ${new Date(returnedMs).toISOString()}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const launch = recordInvocationLaunch(
    root,
    runId,
    invocationId,
    launchOptions,
  )
  const launchedMs = Date.parse(launch.launched_at)

  // The attestation is evidence that the harness saw the worker finish, so it
  // requires the worker's output to exist rather than the supervisor's word.
  // The output path is unique to the invocation. Whether the output parses
  // and names the invocation is the submission's judgment: a malformed output
  // is still a returned worker, and submit must be able to fail it.
  const observation = observeInvocation(root, invocation)

  invariant(
    observation.output_present,
    foregroundReturnNotTerminalMessage(observation),
    {
      code: 'FOREGROUND_RETURN_NOT_TERMINAL',
      details: {
        output_path: observation.output_path,
        output_present: observation.output_present,
        output_parses: observation.output_parses,
        output_matches_invocation: observation.output_matches_invocation,
      },
    },
  )

  const elapsedSeconds = (returnedMs - launchedMs) / 1000
  const lowerBoundSeconds = watchWakeSpanSeconds(root, runId, invocationId)
  // The record is labeled rather than refused. A return that happened is
  // evidence whether or not its clock agrees with the watch, and refusing it
  // would delete the supervisor's only account of the launch while leaving
  // the disagreement undiagnosed. Naming both numbers puts the contradiction
  // in the durable record, where a reader can act on it.
  const implausible =
    lowerBoundSeconds !== null && elapsedSeconds < lowerBoundSeconds
  const record: ForegroundReturnRecord = {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: 'foreground',
    launched_at: launch.launched_at,
    launched_at_source: launch.launched_at_source,
    returned_at: new Date(returnedMs).toISOString(),
    elapsed_seconds: elapsedSeconds,
    elapsed_lower_bound_seconds: lowerBoundSeconds,
    elapsed_implausible: implausible,
    elapsed_implausibility: implausible
      ? `The attested elapsed time ${elapsedSeconds.toFixed(1)}s is shorter ` +
        `than the ${lowerBoundSeconds.toFixed(1)}s the watch record ` +
        `${watchRecordPath(root, runId, invocationId)} spans between its ` +
        `first and last wake, so the launch time ` +
        `${launch.launched_at} (source ${launch.launched_at_source}) is ` +
        `later than the launch actually was.`
      : null,
    observation,
    watch_record_path: watchRecordPath(root, runId, invocationId),
    launch_record_path: launchRecordPath(root, runId, invocationId),
    recorded_at: new Date(returnedMs).toISOString(),
  }

  writeJsonAtomic(
    resolveInside(root, foregroundReturnRecordPath(root, runId, invocationId)),
    record,
  )

  return record
}

export function readForegroundReturn(
  root: string,
  runId: string,
  invocationId: string,
): ForegroundReturnRecord | null {
  const absolute = resolveInside(
    root,
    foregroundReturnRecordPath(root, runId, invocationId),
  )

  if (!fileExists(absolute)) {
    return null
  }

  try {
    const value = readJson(absolute)

    return isRecord(value) &&
      value.schema_version === 1 &&
      value.invocation_id === invocationId &&
      typeof value.launched_at === 'string' &&
      typeof value.returned_at === 'string'
      ? (value as unknown as ForegroundReturnRecord)
      : null
  } catch {
    return null
  }
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

// ---------------------------------------------------------------------------
// Watch sessions: ownership lock, interruption closure, and gap recovery
// ---------------------------------------------------------------------------

/** The recorded owner of a live watch target. */
export interface WatchLockRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  watch_session_id: string
  pid: number
  /** Start identity of the watcher process, so a reused PID cannot claim it. */
  process_identity: string | null
  armed_at: string
}

function readWatchLock(absolute: string): WatchLockRecord | null {
  if (!fileExists(absolute)) {
    return null
  }

  try {
    const value = readJson(absolute)

    return isRecord(value) &&
      value.schema_version === 1 &&
      typeof value.watch_session_id === 'string' &&
      typeof value.pid === 'number'
      ? (value as unknown as WatchLockRecord)
      : null
  } catch {
    return null
  }
}

/** Whether the recorded lock owner is still the same live process. */
export function watchLockOwnerAlive(record: WatchLockRecord): boolean {
  if (!processIsAlive(record.pid)) {
    return false
  }

  // Without a recorded identity the PID alone is all the evidence there is.
  // With one, a reused PID shows a different start and reads as stale.
  if (record.process_identity === null) {
    return true
  }

  return processStartIdentity(record.pid) === record.process_identity
}

export interface WatchLockAcquisition {
  /** Release the claim. Idempotent; safe on every exit path. */
  release: () => void
  /** The stale owner this acquisition recovered from, when there was one. */
  recovered: WatchLockRecord | null
}

/**
 * Claim one watch target for this process. A live concurrent owner refuses
 * with `WATCH_TARGET_BUSY` rather than stealing the watch; a dead owner is
 * recovered by process identity rather than by PID alone.
 */
export function acquireWatchLock(
  root: string,
  runId: string,
  invocationId: string,
  sessionId: string,
): WatchLockAcquisition {
  const absolute = resolveInside(root, watchLockPath(root, runId, invocationId))
  const record: WatchLockRecord = {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    watch_session_id: sessionId,
    pid: process.pid,
    process_identity: processStartIdentity(process.pid),
    armed_at: new Date().toISOString(),
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let recovered: WatchLockRecord | null = null
    const existing = readWatchLock(absolute)

    if (existing !== null) {
      if (watchLockOwnerAlive(existing)) {
        const recordPath = watchRecordPath(root, runId, invocationId)
        throw new PanError(
          `Invocation ${invocationId} already has a live watch: session ` +
            `${existing.watch_session_id} (pid ${existing.pid}, armed ` +
            `${existing.armed_at}). Run ` +
            `\`./bin/pan watch --attach ${recordPath}\` to follow it instead of arming a ` +
            `second watch over the same target.`,
          { code: WATCH_TARGET_BUSY },
        )
      }

      recovered = existing
      rmSync(absolute, { force: true })
    }

    try {
      writeFileSync(absolute, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      })

      return {
        release: () => {
          // Only the session that acquired the lock may release it: a late
          // release from a recovered watch must not clear a live successor.
          const current = readWatchLock(absolute)

          if (current?.watch_session_id === sessionId) {
            rmSync(absolute, { force: true })
          }
        },
        recovered,
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        // Lost a race with another acquirer; re-read and judge that owner.
        continue
      }

      throw error
    }
  }

  // The second pass found a live owner or could not write; say which.
  const standing = readWatchLock(absolute)

  if (standing !== null && watchLockOwnerAlive(standing)) {
    const recordPath = watchRecordPath(root, runId, invocationId)
    throw new PanError(
      `Invocation ${invocationId} already has a live watch: session ` +
        `${standing.watch_session_id} (pid ${standing.pid}). ` +
        `Run \`./bin/pan watch --attach ${recordPath}\` to follow it instead.`,
      { code: WATCH_TARGET_BUSY },
    )
  }

  throw new PanError(`Failed to claim the watch lock for ${invocationId}.`, {
    code: 'WATCH_LOCK_UNAVAILABLE',
  })
}

/**
 * The gap a new session discovers in the invocation's ledger, or null.
 *
 * A session is closed by a terminal wake or an explicit `session_ended`. A
 * session an explicit end or an interrupted wake closed still left its
 * target unobserved until this restart, so both yield a gap. An unclosed
 * last session is an orphan: its watcher died without cleanup. A
 * ledger with no session identity at all is legacy history, classified rather
 * than assigned an invented process.
 */
export function detectSessionGap(
  root: string,
  runId: string,
  invocationId: string,
  newSessionStartedAt: string,
): WatchGap | null {
  const entries = readWatchRecord(root, runId, invocationId)

  if (entries.length === 0) {
    return null
  }

  const last = entries[entries.length - 1] as WatchRecordEntry

  // A gap event is the newest entry only while a session is starting; it
  // never makes the prior history look closed or open.
  const lastSessionEntry = [...entries]
    .reverse()
    .find((entry) => entry.watch_session_id !== undefined)

  const toMs = Date.parse(newSessionStartedAt)

  const buildGap = (
    from: string,
    reason: WatchGap['reason'],
    source: WatchGap['source'],
    cadenceSeconds: number,
  ): WatchGap => {
    const fromMs = Date.parse(from)
    const seconds = Math.max(0, (toMs - fromMs) / 1000)

    return {
      from,
      to: newSessionStartedAt,
      seconds,
      overdue_seconds: Math.max(0, seconds - cadenceSeconds),
      reason,
      source,
      key: `gap:${from}:${reason}`,
    }
  }

  if (lastSessionEntry === undefined) {
    // Legacy history: no session identity anywhere. A terminal last wake is a
    // closed watch; anything else is an unclassified interruption.
    if (last.event === 'wake' && last.terminal_state !== undefined) {
      return null
    }

    const lastWake = [...entries]
      .reverse()
      .find((entry) => entry.event === 'wake')
    const from = (lastWake ?? last).recorded_at

    return buildGap(from, 'legacy_unclassified', 'ledger', last.cadence_seconds)
  }

  const sessionId = lastSessionEntry.watch_session_id as string
  const sessionEntries = entries.filter(
    (entry) => entry.watch_session_id === sessionId,
  )
  const closing = sessionEntries.find(
    (entry) =>
      (entry.event === 'wake' && entry.terminal_state !== undefined) ||
      entry.event === 'session_ended',
  )

  if (closing !== undefined) {
    if (closing.event === 'session_ended') {
      const lastWake = [...sessionEntries]
        .reverse()
        .find((entry) => entry.event === 'wake')
      const from = (lastWake ?? closing).recorded_at

      return buildGap(
        from,
        closing.session_end_reason ?? 'sibling_handoff',
        'session_end',
        closing.cadence_seconds,
      )
    }

    if (closing.terminal_state === 'interrupted') {
      // A signal closed the session cleanly, but nobody observed from its
      // last real wake, or its arming, until this restart.
      const observed = sessionEntries.filter((entry) => entry !== closing)
      const anchor =
        [...observed].reverse().find((entry) => entry.event === 'wake') ??
        observed[observed.length - 1] ??
        closing

      return buildGap(
        anchor.recorded_at,
        'interrupted',
        'session_end',
        closing.cadence_seconds,
      )
    }

    return null
  }

  // An unclosed session is an orphan. The gap runs from its last observation,
  // or from its arming when it never woke.
  const lastWake = [...sessionEntries]
    .reverse()
    .find((entry) => entry.event === 'wake')
  const anchor = lastWake ?? sessionEntries[sessionEntries.length - 1]

  return buildGap(
    (anchor ?? lastSessionEntry).recorded_at,
    'orphan_session',
    'ledger',
    lastSessionEntry.cadence_seconds,
  )
}

/** Append a gap event unless an identical one is already recorded. */
export function appendSessionGap(
  root: string,
  runId: string,
  invocationId: string,
  gap: WatchGap,
  cadenceSeconds: number,
): WatchRecordEntry | null {
  const existing = readWatchRecord(root, runId, invocationId).some(
    (entry) => entry.event === 'gap' && entry.gap?.key === gap.key,
  )

  if (existing) {
    return null
  }

  const entry: WatchRecordEntry = {
    schema_version: 1,
    event: 'gap',
    run_id: runId,
    invocation_id: invocationId,
    recorded_at: gap.to,
    cadence_seconds: cadenceSeconds,
    wake: 0,
    gap,
  }

  appendJsonLine(
    resolveInside(root, watchRecordPath(root, runId, invocationId)),
    entry,
  )

  return entry
}

const WATCH_INTERRUPTION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
}

/**
 * Close the active watch with one terminal interrupted wake when a catchable
 * signal arrives, then re-raise so the process exits with the conventional
 * status. The appended wake records the signal as the reason and never
 * fabricates a worker completion. SIGKILL cannot run this cleanup; restart
 * recovery is the branch that covers it.
 *
 * Returns the disposer every exit path MUST run.
 */
export function installInterruptionHandlers(
  close: (signal: string) => void,
  onInterrupted?: (signal: string) => void,
): () => void {
  let handled = false

  const dispose = (): void => {
    for (const signal of WATCH_INTERRUPTION_SIGNALS) {
      process.removeListener(signal, handlers[signal])
    }
  }
  const handlers = Object.fromEntries(
    WATCH_INTERRUPTION_SIGNALS.map((signal) => [
      signal,
      () => {
        if (handled) {
          return
        }

        handled = true
        dispose()
        close(signal)

        if (onInterrupted) {
          onInterrupted(signal)
          return
        }

        // Default disposition is back once listeners are removed, so this
        // dies by the signal itself: the conventional 128+signo status.
        process.kill(process.pid, signal)
        process.exit(128 + (SIGNAL_NUMBERS[signal] ?? 0))
      },
    ]),
  ) as Record<(typeof WATCH_INTERRUPTION_SIGNALS)[number], () => void>

  for (const signal of WATCH_INTERRUPTION_SIGNALS) {
    process.on(signal, handlers[signal])
  }

  return dispose
}

/**
 * Await a launched worker on a fixed cadence and record every arming and wake.
 *
 * The call blocks for its whole duration, so it is the awaited foreground call
 * the supervisor makes. Re-running it appends to the same record and returns
 * `completed` at once when the output is already present.
 */
export async function watchInvocation(
  root: string,
  runId: string,
  options: WatchOptions = {},
): Promise<WatchResult> {
  const invocation = resolveWatchedInvocation(root, runId, options.invocationId)
  const invocationId = invocation.invocation_id

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const stallTimeoutSeconds =
    options.stallTimeoutSeconds ?? DEFAULT_STALL_TIMEOUT_SECONDS
  const stallWakes =
    options.stallWakes ??
    Math.max(1, Math.ceil(stallTimeoutSeconds / cadenceSeconds))
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  // A bound below the cadence could never observe even one wake. Refuse it
  // before the initial-output shortcut, so no timed mode skips the check.
  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ` +
      `${cadenceSeconds}: the watch could not complete a single wake. Raise ` +
      `the bound past the cadence.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  // The recorded inspection behind an agent-state report is validated before
  // any write, so a malformed or mismatched record never reaches the ledger.
  const agentStateEvidence =
    options.agentStateEvidence !== undefined
      ? loadAgentStateEvidence(
          root,
          runId,
          invocationId,
          options.agentStateEvidence,
        )
      : null

  if (agentStateEvidence && options.agentState) {
    invariant(
      agentStateEvidence.observed_state === options.agentState,
      `--agent-state ${options.agentState} contradicts the inspection ` +
        `record ${agentStateEvidence.path}, which observed ` +
        `${agentStateEvidence.observed_state}.`,
      { code: WATCH_EVIDENCE_INVALID },
    )
  }

  const agentState = options.agentState ?? agentStateEvidence?.observed_state
  const evidenceReference: AgentStateEvidenceReference | null =
    agentStateEvidence
      ? {
          path: agentStateEvidence.path,
          sha256: agentStateEvidence.digest,
          source: 'supervisor_assertion',
        }
      : null

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const recordRelative = watchRecordPath(root, runId, invocationId)
  const recordAbsolute = resolveInside(root, recordRelative)

  const sessionId = randomUUID()
  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()

  // One live watcher per target. A concurrent claim is refused; a dead one
  // is recovered by process identity and surfaces as the orphan gap below.
  const lock = acquireWatchLock(root, runId, invocationId, sessionId)

  // An interrupted watch appends one terminal wake with the signal as its
  // reason, then dies by re-raising it. The ledger never shows a vanished
  // watcher as a silent end.
  let wakesForInterruption = 0
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    appendJsonLine(recordAbsolute, {
      schema_version: 1,
      event: 'wake',
      run_id: runId,
      invocation_id: invocationId,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: wakesForInterruption + 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    } satisfies WatchRecordEntry)
    // The re-raise ends the process before `finally` runs, and a lock left
    // behind reads as a live owner wherever PID reuse cannot be ruled out.
    lock.release()
  }, options.onInterrupted)

  const gaps: WatchGap[] = []

  try {
    // The arming is the first moment the harness itself witnesses the launch,
    // so it is the default launch time. Every later reader — the lateness
    // advisory, the elapsed time, the foreground-return attestation — reads
    // this record rather than an artifact's modification time.
    recordInvocationLaunch(root, runId, invocationId, {
      ...(options.launchedAt !== undefined
        ? { launchedAt: options.launchedAt }
        : {}),
      defaultLaunchedAtMs: startedMs,
      defaultSource: 'watch_arm',
      ...(options.markBackground ? { launchMode: 'background' as const } : {}),
      ...(options.workerHandle ? { workerHandle: options.workerHandle } : {}),
      ...(options.platformReturnedAt !== undefined
        ? { platformReturnedAt: options.platformReturnedAt }
        : {}),
      ...(options.platformDetachedAt !== undefined
        ? { platformDetachedAt: options.platformDetachedAt }
        : {}),
    })

    const backgroundMarker = options.markBackground
      ? markDelegationBackground(root, runId, invocationId)
      : null

    const append = (entry: WatchRecordEntry): void => {
      appendJsonLine(recordAbsolute, entry)
    }

    // Gap discovery precedes the new session's first entry, so the ledger
    // reads: what was lost, then the session that found it.
    const discovered = detectSessionGap(root, runId, invocationId, startedAt)

    if (discovered) {
      const gapEntry = appendSessionGap(
        root,
        runId,
        invocationId,
        discovered,
        cadenceSeconds,
      )

      if (gapEntry) {
        gaps.push(discovered)
        options.onGap?.(gapEntry)
      }
    }

    const sessionStart: WatchRecordEntry = {
      schema_version: 1,
      event: 'session_started',
      run_id: runId,
      invocation_id: invocationId,
      recorded_at: startedAt,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      watch_session_id: sessionId,
      watcher_pid: process.pid,
      watcher_process_identity: processStartIdentity(process.pid),
      timeout_seconds: timeoutSeconds,
      ...(options.cadenceAuthority
        ? { cadence_authority: options.cadenceAuthority }
        : {}),
    }

    append(sessionStart)
    options.onSessionStart?.(sessionStart)

    // A `blocked` output is preserved the moment the watch sees it, because
    // the supervisor commonly resolves one without submitting and the next
    // worker rewrites the same path.
    const observe = (): WatchObservation => {
      const observation = observeInvocation(root, invocation)

      snapshotBlockedOutput(root, runId, invocationId)

      return observation
    }
    const finish = (
      state: WatchTerminalState,
      armings: number,
      wakes: number,
    ): WatchResult => {
      const endedMs = now()
      const cadenceDefaulted = cadenceSeconds === DEFAULT_WATCH_CADENCE_SECONDS

      return {
        state,
        run_id: runId,
        invocation_id: invocationId,
        output_path: invocation.output.path,
        record_path: recordRelative,
        cadence_seconds: cadenceSeconds,
        stall_timeout_seconds: stallTimeoutSeconds,
        stall_wakes: stallWakes,
        timeout_seconds: timeoutSeconds,
        armings,
        wakes,
        started_at: startedAt,
        ended_at: new Date(endedMs).toISOString(),
        elapsed_seconds: (endedMs - startedMs) / 1000,
        background_marker_path: backgroundMarker,
        watch_session_id: sessionId,
        gaps,
        ...(state === 'timed_out'
          ? {
              rearm_command:
                `./bin/pan watch ${runId} --invocation ${invocationId} ` +
                // The default cadence is the one value no rearm needs to
                // name; an exception carries its recorded authority with it.
                (cadenceDefaulted
                  ? ''
                  : `--cadence-seconds ${cadenceSeconds} ` +
                    (options.cadenceAuthority
                      ? `--cadence-directed-by-operator ${shellSingleQuote(options.cadenceAuthority)} `
                      : '')) +
                `--stall-timeout-seconds ${stallTimeoutSeconds} ` +
                `--timeout-seconds ${timeoutSeconds}` +
                (agentState ? ` --agent-state ${agentState}` : ''),
            }
          : {}),
      }
    }
    // An already-present output needs no timer. The wake record still proves
    // the terminal inspection happened.
    const initial = observe()
    const initialEvidence = completionEvidenceForObservation(
      initial,
      launchToOutputSeconds(root, runId, invocationId),
      cadenceSeconds,
      agentState,
      agentStateEvidence,
    )
    // The output signature the confirming wake compares against. Non-null means
    // a finished-looking output is being held for one more observation.
    let heldOutput: string | null = null

    if (initialEvidence.strength === 'strong') {
      append({
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: 0,
        watch_session_id: sessionId,
        observation: initial,
        ...(agentState ? { agent_state: agentState } : {}),
        ...(evidenceReference
          ? { agent_state_evidence: evidenceReference }
          : {}),
        terminal_basis: initialEvidence.basis,
        changed: true,
        unchanged_wakes: 0,
        terminal_state: 'completed',
      })

      return finish('completed', 0, 0)
    }

    if (initialEvidence.strength === 'weak') {
      heldOutput = outputSignature(initial)

      append({
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: 0,
        watch_session_id: sessionId,
        observation: initial,
        ...(agentState ? { agent_state: agentState } : {}),
        ...(evidenceReference
          ? { agent_state_evidence: evidenceReference }
          : {}),
        completion_hold: initialEvidence.reason,
        changed: true,
        unchanged_wakes: 0,
      })
    }

    let previousFingerprint = initial.fingerprint
    let unchangedWakes = 0
    let scaffoldOrderAdvised = false

    let armings = 0
    let wakes = 0

    // Wakes keep an absolute schedule so the time an observation takes does not
    // push every later wake back. A wake that already fell due is taken at once;
    // the schedule then restarts from now rather than firing a burst.
    // Whole milliseconds: `0.1 * 3 * 1000` is not 300 in floating point, and a
    // due time that misses the timeout by a rounding error costs a whole wake.
    const cadenceMs = Math.round(cadenceSeconds * 1000)
    const timeoutMs = Math.round(timeoutSeconds * 1000)
    let dueMs = startedMs + cadenceMs

    for (;;) {
      armings += 1
      const armedAt = now()

      if (dueMs < armedAt) {
        dueMs = armedAt + cadenceMs
      }

      append({
        schema_version: 1,
        event: 'armed',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(armedAt).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes + 1,
        wake_due_at: new Date(dueMs).toISOString(),
        watch_session_id: sessionId,
        timeout_seconds: timeoutSeconds,
        ...(options.cadenceAuthority
          ? { cadence_authority: options.cadenceAuthority }
          : {}),
      })

      await sleep(Math.max(0, dueMs - now()))
      dueMs += cadenceMs

      wakes += 1
      wakesForInterruption = wakes
      const observation = observe()
      const changed = observation.fingerprint !== previousFingerprint
      const scaffoldOrderAdvisory =
        !scaffoldOrderAdvised &&
        !observation.output_present &&
        observation.workspace_changed_from_invocation === true
          ? OUTPUT_SCAFFOLD_ORDER_ADVISORY
          : null

      if (scaffoldOrderAdvisory) {
        scaffoldOrderAdvised = true
      }

      previousFingerprint = observation.fingerprint
      unchangedWakes = changed || scaffoldOrderAdvisory ? 0 : unchangedWakes + 1

      let terminal: WatchTerminalState | undefined
      let terminalBasis: WatchRecordEntry['terminal_basis']
      let hold: WeakCompletionReason | undefined
      const evidence = completionEvidenceForObservation(
        observation,
        launchToOutputSeconds(root, runId, invocationId),
        cadenceSeconds,
        agentState,
        agentStateEvidence,
      )

      if (evidence.strength === 'strong') {
        terminal = 'completed'
        terminalBasis = evidence.basis
      } else if (evidence.strength === 'weak') {
        const signature = outputSignature(observation)

        if (heldOutput === signature) {
          // This is the confirming wake the held observation bought, and the
          // output did not move across it.
          terminal = 'completed'
          terminalBasis = 'confirming_wake'
        } else {
          heldOutput = signature
          hold = evidence.reason
        }
      } else {
        heldOutput = null

        if (unchangedWakes >= stallWakes && agentState !== 'running') {
          // A worker that scaffolded its output and then died leaves the same
          // still files as one that is thinking. The harness cannot tell those
          // apart, so it reports what it knows and sends the supervisor to the
          // agent rather than calling a working worker stalled — unless the
          // supervisor already looked and said the agent is running, which is
          // the answer the stall check was asking for.
          if (observation.output_is_scaffold) {
            terminal = 'unverified'
          } else {
            terminal = 'stalled'
          }
        }
      }

      if (terminal === undefined && now() - startedMs >= timeoutMs) {
        // A watch that ran out of time while still holding a finished-looking
        // output could not settle the question it was asking. That is what an
        // unverified verdict now means.
        terminal = hold === undefined ? 'timed_out' : 'unverified'
      }

      const entry: WatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        observation,
        ...(agentState ? { agent_state: agentState } : {}),
        ...(evidenceReference
          ? { agent_state_evidence: evidenceReference }
          : {}),
        ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
        ...(hold ? { completion_hold: hold } : {}),
        ...(scaffoldOrderAdvisory
          ? { advisories: [scaffoldOrderAdvisory] }
          : {}),
        changed,
        unchanged_wakes: unchangedWakes,
        ...(terminal ? { terminal_state: terminal } : {}),
      }

      append(entry)
      options.onWake?.(entry)

      if (terminal) {
        return finish(terminal, armings, wakes)
      }
    }
  } finally {
    disposeInterruptionHandlers()
    lock.release()
  }
}

export interface MultiplexedWatchTarget {
  runId: string
  invocationId: string
}

export function parseMultiplexedWatchTargets(
  value: string | null,
): MultiplexedWatchTarget[] | null {
  if (value === null) {
    return null
  }

  const targets = value.split(',').map((item) => {
    const separator = item.indexOf(':')
    const runId = separator === -1 ? '' : item.slice(0, separator).trim()
    const invocationId =
      separator === -1 ? '' : item.slice(separator + 1).trim()

    invariant(
      runId.length > 0 && invocationId.length > 0,
      `Invalid watch target '${item}'. Use <run-id>:<invocation-id>.`,
      { code: 'INVALID_ARGUMENT' },
    )

    return { runId, invocationId }
  })

  invariant(targets.length > 0, '--targets requires at least one target.', {
    code: 'INVALID_ARGUMENT',
  })

  return targets
}

export interface MultiplexedWatchOptions {
  cadenceSeconds?: number
  /** Trimmed operator direction behind a non-default cadence. */
  cadenceAuthority?: string
  /** Mark every target as a platform-backgrounded launch. */
  markBackground?: boolean
  stallTimeoutSeconds?: number
  stallWakes?: number
  timeoutSeconds?: number
  /**
   * Hold the wait until a target reaches a terminal state or the bound,
   * rather than returning on routine movement. Wakes are still recorded on
   * every cadence; only the return changes.
   */
  untilTerminal?: boolean
  /** Injected for tests. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
  /** Injected for tests alongside `sleep`. Defaults to `Date.now`. */
  now?: () => number
  onWake?: (entry: WatchRecordEntry) => void
  /** Fired once per target with its `session_started` entry. */
  onSessionStart?: (entry: WatchRecordEntry) => void
  /** Fired for each gap a target's session discovered before arming. */
  onGap?: (entry: WatchRecordEntry) => void
  /** Test hook replacing the signal re-raise; see `WatchOptions`. */
  onInterrupted?: (signal: string) => void
}

export interface MultiplexedWatchMovement {
  run_id: string
  invocation_id: string
  output_path: string
  record_path: string
  terminal_state: WatchTerminalState | null
}

/** A gap one target's new session discovered in its own ledger. */
export interface MultiplexedWatchGap {
  run_id: string
  invocation_id: string
  gap: WatchGap
}

export interface MultiplexedWatchResult {
  state: 'changed' | 'stalled' | 'unverified' | 'timed_out'
  targets: number
  moved: MultiplexedWatchMovement[]
  /**
   * Targets whose own inspection ended the wait: one that sat unchanged for
   * the stall bound, or one holding a scaffold nobody can verify. The
   * supervisor owes each of these the recovery `DELEGATE-001` names.
   */
  stalled: MultiplexedWatchMovement[]
  cadence_seconds: number
  stall_wakes: number
  timeout_seconds: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  /** Every gap the new sessions discovered before arming. */
  gaps: MultiplexedWatchGap[]
}

/**
 * Watch several independent run invocations on one cadence and return as soon
 * as any target changes. Each target receives the same schema-1 `armed` and
 * `wake` entries as the single-invocation watch, so submission readers remain
 * unaware of which wait form produced their ledger.
 *
 * Each target also keeps the two guarantees the focused watch owes its one
 * worker. A finished-looking output whose evidence is weak buys one confirming
 * wake rather than a verdict, so a supervisor never advances a run whose worker
 * is still writing. A target that sits unchanged for `stallWakes` wakes ends
 * the wait with the stall signal, because a multiplexed wait that could only
 * report movement would hold a cohort of stalled siblings until the timeout.
 *
 * With `untilTerminal` the wait holds through routine movement and returns
 * only for a terminal target or at the bound, so a cohort supervisor spends
 * one awaited watch instead of one model round per cadence. Every return
 * closes the other sessions with a `sibling_handoff` end, and the next
 * arming on each of those targets records the explicit gap.
 */
export async function watchInvocations(
  root: string,
  targets: MultiplexedWatchTarget[],
  options: MultiplexedWatchOptions = {},
): Promise<MultiplexedWatchResult> {
  invariant(
    targets.length > 0,
    'A multiplexed watch requires at least one target.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )
  const unique = new Set(
    targets.map((target) => `${target.runId}:${target.invocationId}`),
  )

  invariant(
    unique.size === targets.length,
    'A multiplexed watch target MUST be unique.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  // The stall window is a duration, as for the focused watch, so a cadence
  // change does not alter the liveness rule.
  const stallTimeoutSeconds =
    options.stallTimeoutSeconds ?? DEFAULT_STALL_TIMEOUT_SECONDS
  const stallWakes =
    options.stallWakes ??
    Math.max(1, Math.ceil(stallTimeoutSeconds / cadenceSeconds))
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ` +
      `${cadenceSeconds}: the watch could not complete a single wake. Raise ` +
      `the bound past the cadence.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()

  const watched = targets.map((target) => {
    const invocation = resolveWatchedInvocation(
      root,
      target.runId,
      target.invocationId,
    )
    const recordRelative = watchRecordPath(
      root,
      target.runId,
      invocation.invocation_id,
    )

    return {
      target,
      invocation,
      recordRelative,
      recordAbsolute: resolveInside(root, recordRelative),
      sessionId: randomUUID(),
      initial: null as WatchObservation | null,
      previousFingerprint: '',
      unchangedWakes: 0,
      wakes: 0,
      terminalReached: false,
      scaffoldOrderAdvised: false,
      // Non-null means a finished-looking output is held for one more
      // observation, exactly as the focused watch holds one.
      heldOutput: null as string | null,
    }
  })
  type WatchedTarget = (typeof watched)[number]

  // Locks are claimed in one stable order and rolled back as a group, so a
  // busy sibling never leaves a half-armed wait holding claims it cannot use.
  const ordered = [...watched].sort((left, right) =>
    `${left.target.runId}:${left.target.invocationId}`.localeCompare(
      `${right.target.runId}:${right.target.invocationId}`,
    ),
  )
  const acquisitions: WatchLockAcquisition[] = []

  try {
    for (const item of ordered) {
      acquisitions.push(
        acquireWatchLock(
          root,
          item.target.runId,
          item.invocation.invocation_id,
          item.sessionId,
        ),
      )
    }
  } catch (error) {
    for (const acquisition of acquisitions) {
      acquisition.release()
    }

    throw error
  }

  const gaps: MultiplexedWatchGap[] = []
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    for (const item of watched) {
      if (item.terminalReached) {
        continue
      }

      appendJsonLine(item.recordAbsolute, {
        schema_version: 1,
        event: 'wake',
        run_id: item.target.runId,
        invocation_id: item.invocation.invocation_id,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: item.wakes + 1,
        watch_session_id: item.sessionId,
        terminal_state: 'interrupted',
        interrupted_reason: signal,
      } satisfies WatchRecordEntry)
    }

    // The re-raise ends the process before `finally` runs.
    for (const acquisition of acquisitions) {
      acquisition.release()
    }
  }, options.onInterrupted)

  /** Close every session that reached no verdict of its own. */
  const endOpenSessions = (): void => {
    for (const item of watched) {
      if (item.terminalReached) {
        continue
      }

      item.terminalReached = true
      appendJsonLine(item.recordAbsolute, {
        schema_version: 1,
        event: 'session_ended',
        run_id: item.target.runId,
        invocation_id: item.invocation.invocation_id,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: item.wakes,
        watch_session_id: item.sessionId,
        session_end_reason: 'sibling_handoff',
      } satisfies WatchRecordEntry)
    }
  }

  try {
    for (const item of watched) {
      recordInvocationLaunch(
        root,
        item.target.runId,
        item.invocation.invocation_id,
        {
          defaultLaunchedAtMs: startedMs,
          defaultSource: 'watch_arm',
          ...(options.markBackground
            ? { launchMode: 'background' as const }
            : {}),
        },
      )

      if (options.markBackground) {
        markDelegationBackground(
          root,
          item.target.runId,
          item.invocation.invocation_id,
        )
      }

      const discovered = detectSessionGap(
        root,
        item.target.runId,
        item.invocation.invocation_id,
        startedAt,
      )

      if (discovered) {
        const gapEntry = appendSessionGap(
          root,
          item.target.runId,
          item.invocation.invocation_id,
          discovered,
          cadenceSeconds,
        )

        if (gapEntry) {
          gaps.push({
            run_id: item.target.runId,
            invocation_id: item.invocation.invocation_id,
            gap: discovered,
          })
          options.onGap?.(gapEntry)
        }
      }

      const sessionStart: WatchRecordEntry = {
        schema_version: 1,
        event: 'session_started',
        run_id: item.target.runId,
        invocation_id: item.invocation.invocation_id,
        recorded_at: startedAt,
        cadence_seconds: cadenceSeconds,
        wake: 0,
        watch_session_id: item.sessionId,
        watcher_pid: process.pid,
        watcher_process_identity: processStartIdentity(process.pid),
        timeout_seconds: timeoutSeconds,
        ...(options.cadenceAuthority
          ? { cadence_authority: options.cadenceAuthority }
          : {}),
      }

      appendJsonLine(item.recordAbsolute, sessionStart)
      options.onSessionStart?.(sessionStart)

      const initial = observeInvocation(root, item.invocation)

      item.initial = initial
      item.previousFingerprint = initial.fingerprint
    }

    const finish = (
      state: MultiplexedWatchResult['state'],
      moved: MultiplexedWatchMovement[],
      stalled: MultiplexedWatchMovement[],
      wakes: number,
    ): MultiplexedWatchResult => {
      const endedMs = now()

      return {
        state,
        targets: watched.length,
        moved,
        stalled,
        cadence_seconds: cadenceSeconds,
        stall_wakes: stallWakes,
        timeout_seconds: timeoutSeconds,
        wakes,
        started_at: startedAt,
        ended_at: new Date(endedMs).toISOString(),
        elapsed_seconds: (endedMs - startedMs) / 1000,
        gaps,
      }
    }
    const movement = (
      item: WatchedTarget,
      terminal: WatchTerminalState | undefined,
    ): MultiplexedWatchMovement => ({
      run_id: item.target.runId,
      invocation_id: item.invocation.invocation_id,
      output_path: item.invocation.output.path,
      record_path: item.recordRelative,
      terminal_state: terminal ?? null,
    })
    const evidenceFor = (
      item: WatchedTarget,
      observation: WatchObservation,
    ): CompletionEvidence =>
      completionEvidenceForObservation(
        observation,
        launchToOutputSeconds(
          root,
          item.target.runId,
          item.invocation.invocation_id,
        ),
        cadenceSeconds,
      )
    const initiallyMoved: MultiplexedWatchMovement[] = []

    for (const item of watched) {
      const initial = item.initial as WatchObservation
      const evidence = evidenceFor(item, initial)

      if (evidence.strength === 'none') {
        continue
      }

      const terminal = evidence.strength === 'strong' ? 'completed' : undefined
      const terminalBasis =
        evidence.strength === 'strong' ? evidence.basis : undefined
      const hold = evidence.strength === 'weak' ? evidence.reason : undefined

      if (hold !== undefined) {
        item.heldOutput = outputSignature(initial)
      }

      const entry: WatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        run_id: item.target.runId,
        invocation_id: item.invocation.invocation_id,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: 0,
        watch_session_id: item.sessionId,
        observation: initial,
        ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
        ...(hold ? { completion_hold: hold } : {}),
        changed: true,
        unchanged_wakes: 0,
        ...(terminal ? { terminal_state: terminal } : {}),
      }

      appendJsonLine(item.recordAbsolute, entry)
      options.onWake?.(entry)

      if (terminal) {
        item.terminalReached = true
        initiallyMoved.push(movement(item, terminal))
      }
    }

    if (initiallyMoved.length > 0) {
      endOpenSessions()

      return finish('changed', initiallyMoved, [], 0)
    }

    const cadenceMs = Math.round(cadenceSeconds * 1000)
    const timeoutMs = Math.round(timeoutSeconds * 1000)
    let dueMs = startedMs + cadenceMs
    let wakes = 0

    for (;;) {
      const armedAt = now()

      if (dueMs < armedAt) {
        dueMs = armedAt + cadenceMs
      }

      for (const item of watched) {
        appendJsonLine(item.recordAbsolute, {
          schema_version: 1,
          event: 'armed',
          run_id: item.target.runId,
          invocation_id: item.invocation.invocation_id,
          recorded_at: new Date(armedAt).toISOString(),
          cadence_seconds: cadenceSeconds,
          wake: wakes + 1,
          wake_due_at: new Date(dueMs).toISOString(),
          watch_session_id: item.sessionId,
          timeout_seconds: timeoutSeconds,
          ...(options.cadenceAuthority
            ? { cadence_authority: options.cadenceAuthority }
            : {}),
        } satisfies WatchRecordEntry)
      }

      await sleep(Math.max(0, dueMs - now()))
      dueMs += cadenceMs
      wakes += 1
      const moved: MultiplexedWatchMovement[] = []
      const stalled: MultiplexedWatchMovement[] = []
      const timedOut = now() - startedMs >= timeoutMs

      for (const item of watched) {
        item.wakes = wakes
        const observation = observeInvocation(root, item.invocation)

        snapshotBlockedOutput(
          root,
          item.target.runId,
          item.invocation.invocation_id,
        )

        const changed = observation.fingerprint !== item.previousFingerprint
        const scaffoldOrderAdvisory =
          !item.scaffoldOrderAdvised &&
          !observation.output_present &&
          observation.workspace_changed_from_invocation === true
            ? OUTPUT_SCAFFOLD_ORDER_ADVISORY
            : null

        if (scaffoldOrderAdvisory) {
          item.scaffoldOrderAdvised = true
        }

        item.previousFingerprint = observation.fingerprint
        item.unchangedWakes =
          changed || scaffoldOrderAdvisory ? 0 : item.unchangedWakes + 1

        const evidence = evidenceFor(item, observation)
        let terminal: WatchTerminalState | undefined
        let terminalBasis: WatchRecordEntry['terminal_basis']
        let hold: WeakCompletionReason | undefined

        if (evidence.strength === 'strong') {
          terminal = 'completed'
          terminalBasis = evidence.basis
        } else if (evidence.strength === 'weak') {
          const signature = outputSignature(observation)

          if (item.heldOutput === signature) {
            // The confirming wake the held observation bought, across which
            // the output did not move.
            terminal = 'completed'
            terminalBasis = 'confirming_wake'
          } else {
            item.heldOutput = signature
            hold = evidence.reason
          }
        } else {
          item.heldOutput = null

          if (item.unchangedWakes >= stallWakes) {
            // A scaffold that stopped moving is the case the focused watch
            // refuses to call a stall: the supervisor must inspect the agent
            // itself, which a group wait cannot report for one member.
            terminal = observation.output_is_scaffold ? 'unverified' : 'stalled'
          }
        }

        // A terminal-only wait records routine movement without returning for
        // it; the first completed, stalled, or unverifiable target — or the
        // bound — is what hands control back.
        const movedNow = options.untilTerminal
          ? terminal === 'completed'
          : terminal === 'completed' || (changed && hold === undefined)

        if (!movedNow && terminal === undefined && timedOut) {
          terminal = hold === undefined ? 'timed_out' : 'unverified'
        }

        const entry: WatchRecordEntry = {
          schema_version: 1,
          event: 'wake',
          run_id: item.target.runId,
          invocation_id: item.invocation.invocation_id,
          recorded_at: new Date(now()).toISOString(),
          cadence_seconds: cadenceSeconds,
          wake: wakes,
          watch_session_id: item.sessionId,
          observation,
          ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
          ...(hold ? { completion_hold: hold } : {}),
          ...(scaffoldOrderAdvisory
            ? { advisories: [scaffoldOrderAdvisory] }
            : {}),
          changed,
          unchanged_wakes: item.unchangedWakes,
          ...(terminal ? { terminal_state: terminal } : {}),
        }

        appendJsonLine(item.recordAbsolute, entry)
        options.onWake?.(entry)

        if (terminal) {
          item.terminalReached = true
        }

        if (movedNow) {
          moved.push(movement(item, terminal))
        } else if (terminal === 'stalled' || terminal === 'unverified') {
          stalled.push(movement(item, terminal))
        }
      }

      if (moved.length > 0) {
        endOpenSessions()

        return finish('changed', moved, stalled, wakes)
      }

      if (stalled.length > 0) {
        endOpenSessions()

        return finish(
          stalled.some((item) => item.terminal_state === 'stalled')
            ? 'stalled'
            : 'unverified',
          [],
          stalled,
          wakes,
        )
      }

      if (timedOut) {
        endOpenSessions()

        return finish('timed_out', [], stalled, wakes)
      }
    }
  } finally {
    disposeInterruptionHandlers()

    for (const acquisition of acquisitions) {
      acquisition.release()
    }
  }
}

/**
 * The first line of an interactive watch names the resolved lifetime: the
 * cadence it wakes on and the bound it exits at, so the supervisor never
 * discovers the four-hour default from a timeout.
 */
export function formatSessionStartLine(entry: WatchRecordEntry): string {
  const timeout = entry.timeout_seconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS
  const boundNote =
    timeout === DEFAULT_WATCH_TIMEOUT_SECONDS
      ? `${timeout}s (default bound)`
      : `${timeout}s`

  return (
    `[pan watch:${entry.invocation_id}] session ${entry.watch_session_id ?? 'legacy'} ` +
    `armed at ${entry.recorded_at}: cadence ${entry.cadence_seconds}s, ` +
    `timeout ${boundNote}` +
    (entry.cadence_authority
      ? `, cadence directed by operator: ${entry.cadence_authority}`
      : '')
  )
}

/** The gap notice is the first diagnostic a restarted watch prints. */
export function formatGapLine(entry: WatchRecordEntry): string {
  const gap = entry.gap

  return (
    `[pan watch:${entry.invocation_id}] observation gap: ` +
    `${gap?.seconds.toFixed(1)}s from ${gap?.from} to ${gap?.to} ` +
    `(${gap?.reason}, ${gap?.overdue_seconds.toFixed(1)}s beyond cadence)`
  )
}

/** One line per wake for an interactive terminal. */
export function formatWakeLine(entry: WatchRecordEntry): string {
  const observation = entry.observation
  const output = observation?.output_present
    ? observation.output_is_scaffold
      ? // Naming it here means the supervisor never has to open the file and
        // rediscover that a present output is the pre-work scaffold.
        'output present (still the scaffold, worker has not written yet)'
      : observation.output_matches_invocation
        ? 'output present'
        : 'output present (other invocation)'
    : 'no output'
  const suffix = entry.terminal_state
    ? ` -> ${entry.terminal_state}`
    : entry.completion_hold
      ? ` -> holding for one confirming wake (${entry.completion_hold})`
      : ''

  return (
    `[pan watch:${entry.invocation_id}] wake ${entry.wake} at ` +
    `${entry.recorded_at}: ${output}, ` +
    `${entry.changed ? 'changed' : `unchanged x${entry.unchanged_wakes ?? 0}`}` +
    suffix
  )
}

export function readWatchRecord(
  root: string,
  runId: string,
  invocationId: string,
): WatchRecordEntry[] {
  const absolute = resolveInside(
    root,
    watchRecordPath(root, runId, invocationId),
  )

  if (!fileExists(absolute)) {
    return []
  }

  return readText(absolute)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown

        return isRecord(parsed) && parsed.schema_version === 1
          ? [parsed as unknown as WatchRecordEntry]
          : []
      } catch {
        return []
      }
    })
}

/**
 * Whether the given wake saw a finished output that has not moved since.
 *
 * This is what a watch the supervisor stopped awaiting still proves. The
 * platform's completion notice routinely lands between two wakes, and the
 * supervisor then has no completed record to submit with; the documented
 * workaround was a foreground-return attestation written for a launch nobody
 * watched return, which degraded the audit trail every time it was used.
 *
 * The caller passes a wake only when the record reached no verdict of its
 * own. A watch that did reach one has answered the question already, and an
 * `unverified` or `stalled` verdict is an answer this MUST NOT overturn.
 *
 * A held wake saw a finished-looking output on weak evidence and bought one
 * confirming wake to settle it. When that wake never ran, the hold is still
 * pending, so the observation is not final-output evidence.
 */
function lastWakeObservedFinalOutput(
  root: string,
  wake: WatchRecordEntry | undefined,
): boolean {
  const observation = wake?.observation

  if (
    observation === undefined ||
    wake?.completion_hold !== undefined ||
    !isTerminalObservation(observation)
  ) {
    return false
  }

  const observed = observation.watched_paths.find(
    (item) => item.path === observation.output_path,
  )
  const current = observePath(root, observation.output_path)

  return (
    observed !== undefined &&
    current.exists === observed.exists &&
    current.size === observed.size &&
    current.mtime_ms === observed.mtime_ms
  )
}

/**
 * Per-session observed intervals of one ledger. A session spans its first
 * entry to its last wake; entries without a session id are the legacy
 * segment. Gap events mark excluded time and carry no interval themselves.
 */
function watchSessionSpans(
  entries: WatchRecordEntry[],
): Array<{ startMs: number; endMs: number }> {
  const spans: Array<{ startMs: number; endMs: number }> = []
  const bySessionId = new Map<string, WatchRecordEntry[]>()
  const legacy: WatchRecordEntry[] = []

  for (const entry of entries) {
    if (entry.event === 'gap') {
      continue
    }

    if (entry.watch_session_id === undefined) {
      legacy.push(entry)
    } else {
      const list = bySessionId.get(entry.watch_session_id) ?? []

      list.push(entry)
      bySessionId.set(entry.watch_session_id, list)
    }
  }

  const groups = [...bySessionId.values()]

  if (legacy.length > 0) {
    groups.push(legacy)
  }

  for (const group of groups) {
    const startMs = Date.parse(group[0]?.recorded_at ?? '')
    const lastWake = [...group]
      .reverse()
      .find((entry) => entry.event === 'wake')
    const endMs = Date.parse(
      (lastWake ?? group[group.length - 1])?.recorded_at ?? '',
    )

    if (
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs >= startMs
    ) {
      spans.push({ startMs, endMs })
    }
  }

  return spans
}

/** Total milliseconds covered by the union of the given intervals. */
function unionCoverageMs(
  spans: Array<{ startMs: number; endMs: number }>,
): number {
  const sorted = [...spans].sort((left, right) => left.startMs - right.startMs)
  let covered = 0
  let currentStart: number | null = null
  let currentEnd: number | null = null

  for (const span of sorted) {
    if (
      currentStart === null ||
      currentEnd === null ||
      span.startMs > currentEnd
    ) {
      if (currentStart !== null && currentEnd !== null) {
        covered += currentEnd - currentStart
      }

      currentStart = span.startMs
      currentEnd = span.endMs
    } else {
      currentEnd = Math.max(currentEnd, span.endMs)
    }
  }

  if (currentStart !== null && currentEnd !== null) {
    covered += currentEnd - currentStart
  }

  return covered
}

/** Summarize the watch record `pan submit` carries into the stage record. */
export function summarizeDelegationWatch(
  root: string,
  runId: string,
  invocationId: string,
): DelegationWatchSummary {
  const entries = readWatchRecord(root, runId, invocationId)
  const armings = entries.filter((entry) => entry.event === 'armed')
  const wakes = entries.filter((entry) => entry.event === 'wake')
  const terminal = [...wakes]
    .reverse()
    .find((entry) => entry.terminal_state !== undefined)

  const markerPath = resolveInside(
    root,
    backgroundMarkerPath(root, runId, invocationId),
  )
  const marker = fileExists(markerPath) ? readJson(markerPath) : null
  const markDelay =
    isRecord(marker) && typeof marker.mark_delay_seconds === 'number'
      ? marker.mark_delay_seconds
      : null
  const markDelayBasis =
    isRecord(marker) &&
    (marker.mark_delay_basis === 'platform_return' ||
      marker.mark_delay_basis === 'launch_unattributed')
      ? marker.mark_delay_basis
      : // A marker written before the basis field existed measured from the
        // launch, which is exactly the unattributed fallback.
        marker !== null && markDelay !== null
        ? ('launch_unattributed' as const)
        : null

  // Every excepted session, not only the ledger's first cadence: a directed
  // 300-second session after a 60-second one must survive summarization.
  const exceptionsByCadence = new Map<number, string | null>()
  const sessionCadence = new Map<string, number>()

  for (const entry of entries) {
    if (entry.event === 'gap') {
      continue
    }

    const key = entry.watch_session_id ?? 'legacy'

    if (!sessionCadence.has(key)) {
      sessionCadence.set(key, entry.cadence_seconds)
    }

    if (
      entry.cadence_seconds !== DEFAULT_WATCH_CADENCE_SECONDS &&
      !exceptionsByCadence.has(entry.cadence_seconds)
    ) {
      exceptionsByCadence.set(
        entry.cadence_seconds,
        entry.cadence_authority ?? null,
      )
    }
  }

  const cadenceExceptions = [...exceptionsByCadence.entries()].map(
    ([cadence_seconds, authority]) => ({ cadence_seconds, authority }),
  )

  // Coverage: the raw first-arm to last-wake span, and the union of the
  // per-session observed intervals with recorded gaps excluded. The two
  // diverge exactly when separated sessions would manufacture coverage.
  const firstArming = armings.at(0)
  const lastWake = wakes.at(-1)
  const rawSpanSeconds =
    firstArming && lastWake
      ? Math.max(
          0,
          (Date.parse(lastWake.recorded_at) -
            Date.parse(firstArming.recorded_at)) /
            1000,
        )
      : null
  const coveredSeconds =
    entries.length > 0
      ? unionCoverageMs(watchSessionSpans(entries)) / 1000
      : null

  // The ratio reads against the launch-to-output elapsed time when a launch
  // clock exists. A missing or unreadable clock is reported as unknown
  // rather than passed off as a numerical result.
  const launchToOutput = launchToOutputSeconds(root, runId, invocationId)
  const coverageBasis: DelegationWatchSummary['coverage_basis'] =
    launchToOutput !== null && launchToOutput >= 0
      ? 'launch_record'
      : entries.length > 0
        ? 'unknown'
        : null
  const coverageRatio =
    coverageBasis === 'launch_record' &&
    launchToOutput !== null &&
    launchToOutput > 0 &&
    coveredSeconds !== null
      ? coveredSeconds / launchToOutput
      : null

  return {
    record_path: watchRecordPath(root, runId, invocationId),
    record_present: entries.length > 0,
    background_marked: marker !== null,
    background_mark_delay_seconds: markDelay,
    background_mark_delay_basis: markDelayBasis,
    background_watch_late:
      markDelayBasis === 'platform_return' &&
      markDelay !== null &&
      markDelay > DELEGATION_WATCH_LATE_SECONDS,
    armings: armings.length,
    wakes: wakes.length,
    first_armed_at: armings[0]?.recorded_at ?? null,
    last_wake_at: wakes.at(-1)?.recorded_at ?? null,
    last_wake_observed_final_output: lastWakeObservedFinalOutput(
      root,
      terminal === undefined ? wakes.at(-1) : undefined,
    ),
    last_wake_completion_hold:
      terminal === undefined ? (wakes.at(-1)?.completion_hold ?? null) : null,
    terminal_state: terminal?.terminal_state ?? null,
    terminal_basis: terminal?.terminal_basis ?? null,
    cadence_seconds: entries[0]?.cadence_seconds ?? null,
    cadence_exceptions: cadenceExceptions,
    raw_span_seconds: rawSpanSeconds,
    covered_seconds: coveredSeconds,
    coverage_ratio: coverageRatio,
    coverage_basis: coverageBasis,
    await_status:
      isRecord(marker) && marker.await_status === 'unknown' ? 'unknown' : null,
    unawaited_timer_suspected:
      isRecord(marker) && marker.unawaited_timer_suspected === true,
  }
}

export function summarizeForegroundReturn(
  root: string,
  runId: string,
  invocationId: string,
): ForegroundReturnSummary {
  const record = readForegroundReturn(root, runId, invocationId)

  return {
    record_path: foregroundReturnRecordPath(root, runId, invocationId),
    record_present: record !== null,
    launched_at: record?.launched_at ?? null,
    returned_at: record?.returned_at ?? null,
    elapsed_seconds: record?.elapsed_seconds ?? null,
    elapsed_lower_bound_seconds: record?.elapsed_lower_bound_seconds ?? null,
    elapsed_implausible: record?.elapsed_implausible === true,
    output_present_at_return: record?.observation.output_present ?? null,
  }
}

/**
 * Decide whether the harness saw the delegation reach its terminal state.
 * A completed watch, a watch whose last wake observed the final output, or a
 * foreground-return attestation satisfies `DELEGATE-001`; a harness-delegated
 * stage is exempt because `pan delegate` writes its delegation evidence itself.
 *
 * `externalExecutor` describes who owns the dispatch in an operator session,
 * and reaches the refusal wording only. The exemption itself reads the
 * execution record for every executor, because the harness delegates a Cursor
 * stage too.
 */
export function summarizeDelegationObservation(
  root: string,
  runId: string,
  invocationId: string,
  options: { externalExecutor?: boolean } = {},
): DelegationObservation {
  const watch = summarizeDelegationWatch(root, runId, invocationId)
  const foregroundReturn = summarizeForegroundReturn(root, runId, invocationId)

  // The exemption rests on the execution record `pan delegate` writes. A
  // hand-supplied output for a harness-dispatched stage has no such record
  // and is as unobserved as any other.
  const executionRecord = loadDelegationExecutionRecord(
    root,
    runId,
    invocationId,
  )
  const executionRecordMatches =
    executionRecord !== null &&
    executionRecord.run_id === runId &&
    executionRecord.invocation_id === invocationId
  const source: DelegationObservationSource | null = executionRecordMatches
    ? 'external_executor'
    : watch.terminal_state === 'completed'
      ? 'watch_completed'
      : watch.last_wake_observed_final_output
        ? 'watch_observed_final_output'
        : foregroundReturn.output_present_at_return === true
          ? 'foreground_return'
          : null

  return {
    observed: source !== null,
    source,
    watch,
    foreground_return: foregroundReturn,
    execution_record_path: delegationExecutionPath(runId, invocationId, root),
    execution_record_present: executionRecord !== null,
    external_executor: options.externalExecutor === true,
  }
}

/** The `DELEGATION_UNOBSERVED` message for a delegation without a record. */
export function delegationUnobservedMessage(
  observation: DelegationObservation,
  panCommandLine: string,
  runId: string,
  invocationId: string,
): string {
  const watchDetail =
    observation.watch.terminal_state === 'unverified'
      ? `the watch record ${observation.watch.record_path} ends unverified: ` +
        `the confirming wake could not settle the observation. The evidence ` +
        `for completion was weak — the agent was reported running, the ` +
        `output landed within one cadence of the launch, or the elapsed ` +
        `time was unreadable — and the output kept moving, so the harness ` +
        `never saw it hold still`
      : observation.watch.record_present
        ? `the watch record ${observation.watch.record_path} ends without a ` +
          `completed wake (${observation.watch.wakes} wakes, last state ` +
          `${observation.watch.terminal_state ?? 'none'})` +
          (observation.watch.terminal_state !== null
            ? ''
            : observation.watch.last_wake_completion_hold !== null
              ? `, and that last wake held the output for a confirming wake ` +
                `that never ran (${observation.watch.last_wake_completion_hold}), ` +
                `so no wake confirmed the output being submitted`
              : `, and the output moved after that last wake, so no wake ` +
                `observed the output being submitted`)
        : `no watch record exists at ${observation.watch.record_path}`
  const attestationDetail =
    observation.foreground_return.record_present &&
    observation.foreground_return.output_present_at_return !== true
      ? `the attestation at ${observation.foreground_return.record_path} ` +
        `recorded no output present at return and does not count`
      : `no attestation exists at ${observation.foreground_return.record_path}`
  const external =
    observation.external_executor && !observation.execution_record_present
      ? ` The stage names an external executor, but no execution record ` +
        `exists at ${observation.execution_record_path}, so \`pan delegate\` ` +
        `did not run this worker.`
      : ''
  const background = observation.watch.background_marked
    ? ' The launch was marked as a background subagent.'
    : ''

  return (
    `${DELEGATION_UNOBSERVED}: invocation ${invocationId} has neither a ` +
    `completed watch record nor a foreground-return attestation: ` +
    `${watchDetail}, and ${attestationDetail}.${background}${external} ` +
    `DELEGATE-001 requires the supervisor to observe the worker reach a ` +
    `terminal state. When the launch returned with the output present, run ` +
    `\`${panCommandLine} watch ${runId} --foreground-returned --invocation ` +
    `${invocationId}\`. When it returned before the output existed, run ` +
    `\`${panCommandLine} watch ${runId} --invocation ${invocationId}\` and ` +
    `await it.` +
    (observation.watch.terminal_state === 'unverified'
      ? ` Inspect the launched agent itself and re-run the watch with what ` +
        `you saw: \`--agent-state running\` to keep watching, or ` +
        `\`--agent-state completed\` once the agent has stopped or reported ` +
        `it finished. A re-run against an output that has stopped moving ` +
        `settles on its own confirming wake.`
      : '')
  )
}

// ---------------------------------------------------------------------------
// Generic process and opaque-timer watches
// ---------------------------------------------------------------------------

/**
 * Where a generic watch writes when the caller names no record. The directory
 * lives under the harness runtime tree rather than in any run, because these
 * forms exist for waits outside a workflow.
 */
export const GENERIC_WATCH_RECORD_DIRECTORY = 'runtime/logs/watch'

/** The result states a generic watch can reach. */
export type GenericWatchTerminalState =
  | 'exited'
  | 'elapsed'
  | 'timed_out'
  | 'unverified'
  | 'interrupted'

export interface GenericWatchRecordEntry {
  schema_version: 1
  event: 'session_started' | 'armed' | 'wake'
  /** The process pid, or the opaque handle label for a timer. */
  subject: string
  label: string
  recorded_at: string
  cadence_seconds: number
  wake: number
  watch_session_id: string
  watcher_pid?: number
  timeout_seconds?: number
  wake_due_at?: string
  /** Process liveness observed on this wake, when knowable. */
  process_alive?: boolean
  /** The recorded start identity still matches the live process. */
  process_identity_match?: boolean
  /** Bounded metadata of the watched output file, when one was declared. */
  output?: {
    path: string
    exists: boolean
    size: number | null
    mtime_ms: number | null
  }
  /**
   * A timer wake carries the inspection the caller owes. A generic record
   * never satisfies delegation completion.
   */
  requires_inspection?: boolean
  terminal_state?: GenericWatchTerminalState
  interrupted_reason?: string
}

export interface GenericWatchResult {
  state: GenericWatchTerminalState
  label: string
  subject: string
  record_path: string
  cadence_seconds: number
  timeout_seconds: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  /**
   * Observed exit is reported, never success: the harness saw the process
   * leave, and nothing about why. An exit status is knowable only from
   * authoritative completion evidence, which this surface does not collect.
   */
  exit_status: 'unknown' | null
  watch_session_id: string
  /**
   * Exact command to re-arm the same bounded observation. Present only when
   * state is `timed_out`, so an agent can keep waiting without re-entering
   * --process and --label.
   */
  rearm_command?: string
}

export interface ProcessWatchOptions {
  /** The process to observe. */
  pid: number
  /** Operator-readable name for the wait. */
  label: string
  /** Optional file whose bounded metadata each wake records. */
  outputPath?: string
  /** Harness-relative record path; defaults under `runtime/logs/watch/`. */
  recordPath?: string
  cadenceSeconds?: number
  timeoutSeconds?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  /** Injected for tests. Defaults to `processStartIdentity`. */
  identityProbe?: (pid: number) => string | null
  onWake?: (entry: GenericWatchRecordEntry) => void
  onInterrupted?: (signal: string) => void
}

export interface TimerWatchOptions {
  /** Operator-readable name for the wait. */
  label: string
  recordPath?: string
  cadenceSeconds?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  onWake?: (entry: GenericWatchRecordEntry) => void
  onInterrupted?: (signal: string) => void
}

function genericWatchRecordPath(
  root: string,
  label: string,
  recordPath: string | undefined,
): { absolute: string; relative: string } {
  if (recordPath !== undefined) {
    const absolute = resolveInside(root, recordPath)
    const logsRoot = resolveInside(root, 'runtime/logs')

    invariant(
      absolute === logsRoot || absolute.startsWith(`${logsRoot}${path.sep}`),
      `A watch record path MUST stay inside the runtime tree ` +
        `(runtime/logs): ${recordPath}`,
      { code: 'PATH_ESCAPE' },
    )

    return { absolute, relative: recordPath }
  }

  const safeLabel = label
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const relative = path.posix.join(
    GENERIC_WATCH_RECORD_DIRECTORY,
    `${safeLabel || 'watch'}-${stamp}-${randomUUID().slice(0, 8)}.jsonl`,
  )

  return { absolute: resolveInside(root, relative), relative }
}

/**
 * Watch one process by PID and start identity until it exits, its identity
 * changes, or the bound arrives. Liveness that cannot be observed is
 * `unverified`, never `completed`; an observed exit is reported as an exit,
 * never as a success.
 */
export async function watchProcess(
  root: string,
  options: ProcessWatchOptions,
): Promise<GenericWatchResult> {
  invariant(
    Number.isInteger(options.pid) && options.pid > 0,
    `--process MUST be a positive integer pid, not ${options.pid}.`,
    { code: 'INVALID_ARGUMENT' },
  )
  invariant(options.label.trim().length > 0, '--label MUST name the wait.', {
    code: 'INVALID_ARGUMENT',
  })

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ` +
      `${cadenceSeconds}.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const record = genericWatchRecordPath(root, options.label, options.recordPath)
  const sessionId = randomUUID()

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const subject = String(options.pid)

  // The identity captured at arm is what a later liveness answer is compared
  // against: a reused PID is an identity change, not the watched process.
  const identityProbe = options.identityProbe ?? processStartIdentity
  const startIdentity = identityProbe(options.pid)
  const aliveAtArm = processRunning(options.pid)

  const outputAbsolute = options.outputPath
    ? resolveInside(root, options.outputPath)
    : null

  const append = (entry: GenericWatchRecordEntry): void => {
    appendJsonLine(record.absolute, entry)
  }
  let wakes = 0
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    append({
      schema_version: 1,
      event: 'wake',
      subject,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: wakes + 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
  }, options.onInterrupted)

  const finish = (state: GenericWatchTerminalState): GenericWatchResult => {
    const endedMs = now()
    const rearmCommand =
      state === 'timed_out'
        ? `./bin/pan watch --process ${options.pid} --label ${shellSingleQuote(options.label)} --timeout-seconds ${timeoutSeconds}`
        : undefined

    return {
      state,
      label: options.label,
      subject,
      record_path: record.relative,
      cadence_seconds: cadenceSeconds,
      timeout_seconds: timeoutSeconds,
      wakes,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: (endedMs - startedMs) / 1000,
      exit_status: state === 'exited' ? 'unknown' : null,
      watch_session_id: sessionId,
      ...(rearmCommand ? { rearm_command: rearmCommand } : {}),
    }
  }

  try {
    append({
      schema_version: 1,
      event: 'session_started',
      subject,
      label: options.label,
      recorded_at: startedAt,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      watch_session_id: sessionId,
      watcher_pid: process.pid,
      timeout_seconds: timeoutSeconds,
    })

    const observeOutput = (): GenericWatchRecordEntry['output'] =>
      outputAbsolute === null
        ? undefined
        : {
            path: options.outputPath as string,
            ...(() => {
              try {
                const stats = statSync(outputAbsolute)

                return {
                  exists: true,
                  size: stats.size,
                  mtime_ms: stats.mtimeMs,
                }
              } catch {
                return { exists: false, size: null, mtime_ms: null }
              }
            })(),
          }

    if (!aliveAtArm) {
      // The process was already gone when the watch armed. That is an
      // observed absence, not a watched exit: nothing was held across it.
      wakes += 1
      const output = observeOutput()
      const entry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        subject,
        label: options.label,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        process_alive: false,
        process_identity_match: false,
        ...(output ? { output } : {}),
        terminal_state: 'unverified',
      }

      append(entry)
      options.onWake?.(entry)

      return finish('unverified')
    }

    const cadenceMs = Math.round(cadenceSeconds * 1000)
    const timeoutMs = Math.round(timeoutSeconds * 1000)
    let dueMs = startedMs + cadenceMs

    for (;;) {
      const armedAt = now()

      if (dueMs < armedAt) {
        dueMs = armedAt + cadenceMs
      }

      append({
        schema_version: 1,
        event: 'armed',
        subject,
        label: options.label,
        recorded_at: new Date(armedAt).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes + 1,
        wake_due_at: new Date(dueMs).toISOString(),
        watch_session_id: sessionId,
        timeout_seconds: timeoutSeconds,
      })

      await sleep(Math.max(0, dueMs - now()))
      dueMs += cadenceMs
      wakes += 1

      const alive = processRunning(options.pid)
      const identityNow = alive ? identityProbe(options.pid) : null
      // A change is only claimed on evidence: both identities known and
      // different. An unavailable answer never convicts a live process.
      const identityChanged =
        alive &&
        startIdentity !== null &&
        identityNow !== null &&
        identityNow !== startIdentity
      const identityMatch = alive ? !identityChanged : false

      const timedOut = now() - startedMs >= timeoutMs

      let terminal: GenericWatchTerminalState | undefined

      if (!alive || identityChanged) {
        terminal = 'exited'
      } else if (timedOut) {
        terminal = 'timed_out'
      }

      const output = observeOutput()
      const entry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        subject,
        label: options.label,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        process_alive: alive,
        process_identity_match: identityMatch,
        ...(output ? { output } : {}),
        ...(terminal ? { terminal_state: terminal } : {}),
      }

      append(entry)
      options.onWake?.(entry)

      if (terminal) {
        return finish(terminal)
      }
    }
  } finally {
    disposeInterruptionHandlers()
  }
}

/** Exit code the CLI returns when an attach session is orphaned. */
export const WATCH_ATTACH_EXIT_ORPHANED = 5

export type AttachTerminalState =
  | 'attach_completed'
  | 'attach_timed_out'
  | 'orphaned'

export interface AttachSessionEntry {
  ledger: string
  state: AttachTerminalState | null
  session_terminal_state?: string
}

export interface WatchAttachOptions {
  /** One or more ledger paths (relative to root, within runtime/logs). */
  ledgers: string[]
  timeoutSeconds?: number
  cadenceSeconds?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface WatchAttachResult {
  state: AttachTerminalState
  ledgers: AttachSessionEntry[]
  started_at: string
  ended_at: string
  elapsed_seconds: number
  timeout_seconds: number
}

/** Read all entries from an arbitrary JSONL watch ledger. */
function readLedgerEntries(
  absolutePath: string,
): Array<Record<string, unknown>> {
  if (!fileExists(absolutePath)) {
    return []
  }

  return readText(absolutePath)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown

        return isRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
}

/**
 * Inspect a ledger and return the latest session's watcher_pid and whether
 * a terminal wake has been appended.
 */
function inspectLedger(absolutePath: string): {
  watcherPid: number | null
  watcherIdentity: string | null
  terminalState: string | null
} {
  const entries = readLedgerEntries(absolutePath)

  // Find the last session_started entry to get the current watcher PID.
  let watcherPid: number | null = null
  let watcherIdentity: string | null = null

  for (const entry of entries) {
    if (
      entry.event === 'session_started' &&
      typeof entry.watcher_pid === 'number'
    ) {
      watcherPid = entry.watcher_pid
      watcherIdentity =
        typeof entry.watcher_process_identity === 'string'
          ? entry.watcher_process_identity
          : null
    }
  }

  // Find any terminal state in wake entries (most recent session wins).
  // We only care about wakes after the last session_started.
  let lastSessionIdx = -1

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.event === 'session_started') {
      lastSessionIdx = i
      break
    }
  }

  let terminalState: string | null = null

  for (let i = lastSessionIdx + 1; i < entries.length; i += 1) {
    const entry = entries[i]

    if (
      entry !== undefined &&
      entry.event === 'wake' &&
      typeof entry.terminal_state === 'string'
    ) {
      terminalState = entry.terminal_state
    }
  }

  return { watcherPid, watcherIdentity, terminalState }
}

/**
 * Attach to one or more existing watch sessions by ledger path and block until
 * all reach a terminal state, any watcher process orphans, or the bound arrives.
 *
 * This form appends nothing to the followed ledger.
 */
export async function watchAttach(
  root: string,
  options: WatchAttachOptions,
): Promise<WatchAttachResult> {
  invariant(
    options.ledgers.length > 0,
    '--attach requires at least one ledger.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )

  const logsRoot = resolveInside(root, 'runtime/logs')

  for (const ledger of options.ledgers) {
    const abs = resolveInside(root, ledger)

    invariant(
      abs === logsRoot || abs.startsWith(`${logsRoot}${path.sep}`),
      `--attach ledger must be within runtime/logs: ${ledger}`,
      { code: 'PATH_ESCAPE' },
    )
  }

  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS
  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the cadence ${cadenceSeconds}.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const timeoutMs = Math.round(timeoutSeconds * 1000)
  const cadenceMs = Math.round(cadenceSeconds * 1000)

  const sessions: AttachSessionEntry[] = options.ledgers.map((ledger) => ({
    ledger,
    state: null,
  }))

  for (;;) {
    let allDone = true

    for (const session of sessions) {
      if (session.state !== null) {
        continue
      }

      const abs = resolveInside(root, session.ledger)

      if (!fileExists(abs)) {
        // No ledger at all — treat as already orphaned.
        session.state = 'orphaned'
        session.session_terminal_state = undefined
        continue
      }

      const { watcherPid, watcherIdentity, terminalState } = inspectLedger(abs)

      if (terminalState !== null) {
        session.state = 'attach_completed'
        session.session_terminal_state = terminalState
        continue
      }

      // Not yet terminal — check watcher liveness.
      if (watcherPid !== null) {
        const alive = processRunning(watcherPid)
        const identityNow = alive ? processStartIdentity(watcherPid) : null
        const identityMatch =
          alive &&
          (watcherIdentity === null ||
            identityNow === null ||
            identityNow === watcherIdentity)

        if (!alive || !identityMatch) {
          // Watcher is gone without a terminal entry.
          session.state = 'orphaned'
          continue
        }
      }

      allDone = false
    }

    if (allDone) {
      break
    }

    if (now() - startedMs >= timeoutMs) {
      for (const session of sessions) {
        if (session.state === null) {
          session.state = 'attach_timed_out'
        }
      }

      break
    }

    await sleep(cadenceMs)
  }

  // Determine overall state: any orphan → orphaned; any timeout → timed_out;
  // all completed → attach_completed.
  let overallState: AttachTerminalState = 'attach_completed'

  for (const session of sessions) {
    if (session.state === 'orphaned') {
      overallState = 'orphaned'
      break
    }

    if (session.state === 'attach_timed_out') {
      overallState = 'attach_timed_out'
    }
  }

  const endedMs = now()

  return {
    state: overallState,
    ledgers: sessions,
    started_at: startedAt,
    ended_at: new Date(endedMs).toISOString(),
    elapsed_seconds: (endedMs - startedMs) / 1000,
    timeout_seconds: timeoutSeconds,
  }
}

/**
 * Arm exactly one common-cadence timer for an opaque platform handle and
 * return its wake. The wake records the named subject and the inspection the
 * caller owes; it never satisfies delegation completion, because an opaque
 * handle exposes no machine-readable state the harness could verify.
 */
export async function watchTimer(
  root: string,
  options: TimerWatchOptions,
): Promise<GenericWatchResult> {
  invariant(options.label.trim().length > 0, '--label MUST name the wait.', {
    code: 'INVALID_ARGUMENT',
  })

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const record = genericWatchRecordPath(root, options.label, options.recordPath)
  const sessionId = randomUUID()

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()

  const append = (entry: GenericWatchRecordEntry): void => {
    appendJsonLine(record.absolute, entry)
  }
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    append({
      schema_version: 1,
      event: 'wake',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
  }, options.onInterrupted)

  try {
    append({
      schema_version: 1,
      event: 'session_started',
      subject: options.label,
      label: options.label,
      recorded_at: startedAt,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      watch_session_id: sessionId,
      watcher_pid: process.pid,
    })
    append({
      schema_version: 1,
      event: 'armed',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      wake_due_at: new Date(
        startedMs + Math.round(cadenceSeconds * 1000),
      ).toISOString(),
      watch_session_id: sessionId,
    })

    await sleep(
      Math.max(0, startedMs + Math.round(cadenceSeconds * 1000) - now()),
    )

    const wake: GenericWatchRecordEntry = {
      schema_version: 1,
      event: 'wake',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      watch_session_id: sessionId,
      requires_inspection: true,
      terminal_state: 'elapsed',
    }

    append(wake)
    options.onWake?.(wake)

    const endedMs = now()

    return {
      state: 'elapsed',
      label: options.label,
      subject: options.label,
      record_path: record.relative,
      cadence_seconds: cadenceSeconds,
      timeout_seconds: cadenceSeconds,
      wakes: 1,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: (endedMs - startedMs) / 1000,
      exit_status: null,
      watch_session_id: sessionId,
    }
  } finally {
    disposeInterruptionHandlers()
  }
}

// ---------------------------------------------------------------------------
// Platform-guidance redline record
// ---------------------------------------------------------------------------

export const REDLINE_RECORD_FILENAME = 'platform-guidance-redline.json'

export interface RedlineCategory {
  id: string
  description: string
  harness_authority: string
}

/** A platform action taken on the session, distinct from guidance it emitted. */
export const PLATFORM_ACTION_CATEGORY: RedlineCategory = {
  id: 'platform_initiated_detach',
  description:
    'The platform detached a foreground launch from the session without the supervisor choosing a background mode.',
  harness_authority: 'DELEGATE-001, OPERATOR-001',
}

/** Categories of platform guidance pre-declared non-authoritative in a run. */
export const REDLINE_CATEGORIES: RedlineCategory[] = [
  {
    id: 'polling_await_background',
    description:
      'Platform text about polling, awaiting, or backgrounding a subagent or command, including "do not poll or await the background worker".',
    harness_authority: 'DELEGATE-001, ORCH-001',
  },
  {
    id: 'session_mode',
    description:
      'Platform session-mode text, mode switches, and wake or interruption framing.',
    harness_authority: 'OPERATOR-001, ORCH-001',
  },
  {
    id: 'model_tool_suggestions',
    description:
      'Platform suggestions about which model, agent, or tool to use for a launch.',
    harness_authority: 'AGENTS.md role routing, the run pipeline snapshot',
  },
  {
    id: 'command_execution_hints',
    description:
      'Platform hints not to run commands, to skip verification, or to end the turn early.',
    harness_authority: 'ORCH-001, VALID-001, the invocation card',
  },
]

const FALLBACK_AUTHORITY_ORDER = [
  'An explicit operator directive.',
  'The invariants above and every other MUST or MUST NOT in force.',
  'The mission and operating principles, for every tradeoff an invariant leaves open.',
  'The active invocation or standalone governance card.',
  'This operating card.',
  'The run snapshots.',
  'The remaining preferences of the policies and skills resolved for the active context.',
]

/** The numbered authority order under `## Authority and context` in AGENTS.md. */
export function readAuthorityOrder(root: string): string[] {
  const agentsPath = path.join(root, 'AGENTS.md')

  if (!fileExists(agentsPath)) {
    return FALLBACK_AUTHORITY_ORDER
  }

  const lines = readText(agentsPath).split('\n')
  const start = lines.findIndex((line) =>
    /^## Authority and context/u.test(line),
  )

  if (start === -1) {
    return FALLBACK_AUTHORITY_ORDER
  }

  const items: string[] = []

  for (const line of lines.slice(start + 1)) {
    if (/^## /u.test(line)) {
      break
    }

    const match = /^\d+\.\s+(.+)$/u.exec(line)

    if (match) {
      items.push(match[1].trim())
    }
  }

  return items.length > 0 ? items : FALLBACK_AUTHORITY_ORDER
}

export interface RedlineDeclaration {
  declared_at: string
  occasion: string
  /** The supervisor-card generation this declaration belongs to. */
  session_generation: number | null
  run_status: string
  current_stage: string | null
  pending_action: string
}

export interface RedlineRecord {
  schema_version: 1
  run_id: string
  record_path: string
  authority_order: string[]
  authority_source: string
  policy_basis: string[]
  non_authoritative_guidance: RedlineCategory[]
  platform_action_categories: RedlineCategory[]
  statement: string
  declarations: RedlineDeclaration[]
}

export function redlineRecordPath(root: string, runId: string): string {
  return resolveRunLayout(root, runId).evidence(REDLINE_RECORD_FILENAME)
    .relative
}

export function readRedlineRecord(
  root: string,
  runId: string,
): RedlineRecord | null {
  const absolute = resolveInside(root, redlineRecordPath(root, runId))

  if (!fileExists(absolute)) {
    return null
  }

  const value = readJson(absolute)

  return isRecord(value) && value.schema_version === 1
    ? (value as unknown as RedlineRecord)
    : null
}

/**
 * Write or extend the run's platform-guidance redline. Each `/pan-start` and
 * `/pan-resume` appends one declaration, so the record shows every session
 * that pre-committed before it could meet the guidance.
 */
export function writeRedlineRecord(
  root: string,
  runId: string,
  occasion = 'session',
): RedlineRecord {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state: RunState = loadState(root, runId)
    const relative = redlineRecordPath(root, runId)
    const absolute = resolveInside(root, relative)

    const existing = fileExists(absolute) ? readJson(absolute) : null
    const priorDeclarations =
      isRecord(existing) && Array.isArray(existing.declarations)
        ? (existing.declarations as RedlineDeclaration[])
        : []

    const declaration: RedlineDeclaration = {
      declared_at: new Date().toISOString(),
      occasion,
      session_generation: state.supervisor_card?.session_generation ?? null,
      run_status: state.status,
      current_stage: state.current_stage ?? null,
      pending_action: state.pending_action.type,
    }
    const record: RedlineRecord = {
      schema_version: 1,
      run_id: runId,
      record_path: relative,
      authority_order: readAuthorityOrder(root),
      authority_source: 'AGENTS.md, section "Authority and context"',
      policy_basis: ['OPERATOR-001', 'DELEGATE-001', 'ORCH-001'],
      non_authoritative_guidance: REDLINE_CATEGORIES,
      platform_action_categories: [PLATFORM_ACTION_CATEGORY],
      statement:
        'The supervisor pre-declares the listed platform guidance categories ' +
        'non-authoritative for this run. Harness governance and the operator ' +
        'govern each covered step. A later conflict is still recorded per ' +
        'OPERATOR-001 instruction 5.',
      declarations: [...priorDeclarations, declaration],
    }

    writeJsonAtomic(absolute, record)
    persist(root, state, 'platform_guidance_redline_recorded', {
      record_path: relative,
      occasion,
      declaration_count: record.declarations.length,
    })

    return record
  })
}
