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
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import { gitWorkspaceActivityFingerprint } from './git.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
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
/** Consecutive unchanged wakes that `DELEGATE-001` calls a stall. */
export const DEFAULT_STALL_WAKES = 2
/** Bound so a watch never outlives an abandoned session silently. */
export const DEFAULT_WATCH_TIMEOUT_SECONDS = 4 * 60 * 60
/** Floor that keeps a fractional test cadence from becoming a busy loop. */
export const MIN_WATCH_CADENCE_SECONDS = 0.05

export const WATCH_EXIT_CODES: Record<WatchTerminalState, number> = {
  completed: 0,
  stalled: 2,
  timed_out: 3,
  unverified: 4,
}

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
  /** Stable digest of the watched paths; equal digests mean no change. */
  fingerprint: string
}

export interface WatchRecordEntry {
  schema_version: 1
  event: 'armed' | 'wake'
  run_id: string
  invocation_id: string
  recorded_at: string
  cadence_seconds: number
  /** Ordinal of the wake this arming waits for, or of this wake. */
  wake: number
  /** Present on `armed`. */
  wake_due_at?: string
  /** Present on `wake`. */
  observation?: WatchObservation
  /** Present when the supervisor reported what the agent itself was doing. */
  agent_state?: WatchAgentState
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
  changed?: boolean
  unchanged_wakes?: number
  terminal_state?: WatchTerminalState
}

export interface WatchResult {
  state: WatchTerminalState
  run_id: string
  invocation_id: string
  output_path: string
  record_path: string
  cadence_seconds: number
  stall_wakes: number
  timeout_seconds: number
  armings: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  background_marker_path: string | null
}

export interface WatchOptions {
  invocationId?: string
  cadenceSeconds?: number
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
   * The platform identity of the launched worker. Recording it at the arm
   * makes the handle a byproduct of supervision the supervisor already owes.
   */
  workerHandle?: string
  /** The launched agent's state, as the supervisor observed it. */
  agentState?: WatchAgentState
  /** Injected for tests. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
  /** Injected for tests alongside `sleep`. Defaults to `Date.now`. */
  now?: () => number
  onWake?: (entry: WatchRecordEntry) => void
}

/** Digest of a stage record's delegation watch, written by `pan submit`. */
export interface DelegationWatchSummary {
  record_path: string
  record_present: boolean
  background_marked: boolean
  /** Seconds from the launch to the first background mark, when both are known. */
  background_mark_delay_seconds: number | null
  /** The first mark came later than `DELEGATION_WATCH_LATE_SECONDS`. */
  background_watch_late: boolean
  armings: number
  wakes: number
  first_armed_at: string | null
  last_wake_at: string | null
  /**
   * The last wake observed a finished output and that output has not moved
   * since. A watch that never reached a verdict of its own — the supervisor
   * stopped awaiting it when the platform said the worker was done — still
   * holds this observation, and it is the same fact a completed wake carries.
   */
  last_wake_observed_final_output: boolean
  terminal_state: WatchTerminalState | null
  /** What the terminal verdict rested on, when it was `completed`. */
  terminal_basis: 'agent_state' | 'output_plausible' | 'confirming_wake' | null
  cadence_seconds: number | null
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
    fingerprint,
  }
}

export function parseCadenceSeconds(value: string | null): number {
  if (value === null) {
    return DEFAULT_WATCH_CADENCE_SECONDS
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < MIN_WATCH_CADENCE_SECONDS) {
    throw new PanError(
      `--cadence-seconds MUST be a number of at least ${MIN_WATCH_CADENCE_SECONDS}.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return parsed
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
): string {
  const relative = backgroundMarkerPath(root, runId, invocationId)
  const absolute = resolveInside(root, relative)
  const existing = fileExists(absolute) ? readJson(absolute) : null

  const markedAt = new Date().toISOString()
  const firstMarkedAt =
    isRecord(existing) && typeof existing.first_marked_at === 'string'
      ? existing.first_marked_at
      : markedAt

  // Only the launch record answers when supervision was owed. Without this
  // number a supervisor that armed the watch at once and one that armed it
  // after an operator reprimand leave identical evidence.
  const launch = readLaunchRecord(root, runId, invocationId)
  const launchedAt = launch?.launched_at ?? null
  const delaySeconds =
    launchedAt === null
      ? null
      : (Date.parse(firstMarkedAt) - Date.parse(launchedAt)) / 1000

  writeJsonAtomic(absolute, {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: 'background',
    launched_at: launchedAt,
    launched_at_source: launch?.launched_at_source ?? null,
    first_marked_at: firstMarkedAt,
    mark_delay_seconds: delaySeconds,
    late: delaySeconds !== null && delaySeconds > DELEGATION_WATCH_LATE_SECONDS,
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
): CompletionEvidence {
  if (!isTerminalObservation(observation)) {
    return { strength: 'none' }
  }

  if (agentState === 'completed') {
    return { strength: 'strong', basis: 'agent_state' }
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
  const stallWakes = options.stallWakes ?? DEFAULT_STALL_WAKES
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const recordRelative = watchRecordPath(root, runId, invocationId)
  const recordAbsolute = resolveInside(root, recordRelative)

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()

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
  })

  const backgroundMarker = options.markBackground
    ? markDelegationBackground(root, runId, invocationId)
    : null

  const append = (entry: WatchRecordEntry): void => {
    appendJsonLine(recordAbsolute, entry)
  }
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

    return {
      state,
      run_id: runId,
      invocation_id: invocationId,
      output_path: invocation.output.path,
      record_path: recordRelative,
      cadence_seconds: cadenceSeconds,
      stall_wakes: stallWakes,
      timeout_seconds: timeoutSeconds,
      armings,
      wakes,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: (endedMs - startedMs) / 1000,
      background_marker_path: backgroundMarker,
    }
  }
  // An already-present output needs no timer. The wake record still proves
  // the terminal inspection happened.
  const initial = observe()
  const initialEvidence = completionEvidenceForObservation(
    initial,
    launchToOutputSeconds(root, runId, invocationId),
    cadenceSeconds,
    options.agentState,
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
      recorded_at: initial.observed_at,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      observation: initial,
      ...(options.agentState ? { agent_state: options.agentState } : {}),
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
      recorded_at: initial.observed_at,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      observation: initial,
      ...(options.agentState ? { agent_state: options.agentState } : {}),
      completion_hold: initialEvidence.reason,
      changed: true,
      unchanged_wakes: 0,
    })
  }

  let previousFingerprint = initial.fingerprint
  let unchangedWakes = 0
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
    })

    await sleep(Math.max(0, dueMs - now()))
    dueMs += cadenceMs

    wakes += 1
    const observation = observe()
    const changed = observation.fingerprint !== previousFingerprint

    previousFingerprint = observation.fingerprint
    unchangedWakes = changed ? 0 : unchangedWakes + 1

    let terminal: WatchTerminalState | undefined
    let terminalBasis: WatchRecordEntry['terminal_basis']
    let hold: WeakCompletionReason | undefined
    const evidence = completionEvidenceForObservation(
      observation,
      launchToOutputSeconds(root, runId, invocationId),
      cadenceSeconds,
      options.agentState,
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

      if (unchangedWakes >= stallWakes) {
        // A worker that scaffolded its output and then died leaves the same
        // still files as one that is thinking. The harness cannot tell those
        // apart, so it reports what it knows and sends the supervisor to the
        // agent rather than calling a working worker stalled — unless the
        // supervisor already looked and said the agent is running, which is
        // the answer the stall check was asking for.
        if (observation.output_is_scaffold) {
          if (options.agentState !== 'running') {
            terminal = 'unverified'
          }
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
      recorded_at: observation.observed_at,
      cadence_seconds: cadenceSeconds,
      wake: wakes,
      observation,
      ...(options.agentState ? { agent_state: options.agentState } : {}),
      ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
      ...(hold ? { completion_hold: hold } : {}),
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
  /** Mark every target as a platform-backgrounded launch. */
  markBackground?: boolean
  stallWakes?: number
  timeoutSeconds?: number
  /** Injected for tests. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
  /** Injected for tests alongside `sleep`. Defaults to `Date.now`. */
  now?: () => number
  onWake?: (entry: WatchRecordEntry) => void
}

export interface MultiplexedWatchMovement {
  run_id: string
  invocation_id: string
  output_path: string
  record_path: string
  terminal_state: WatchTerminalState | null
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
  const stallWakes = options.stallWakes ?? DEFAULT_STALL_WAKES
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS
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

    recordInvocationLaunch(root, target.runId, invocation.invocation_id, {
      defaultLaunchedAtMs: startedMs,
      defaultSource: 'watch_arm',
      ...(options.markBackground ? { launchMode: 'background' as const } : {}),
    })

    if (options.markBackground) {
      markDelegationBackground(root, target.runId, invocation.invocation_id)
    }

    const initial = observeInvocation(root, invocation)

    return {
      target,
      invocation,
      recordRelative,
      recordAbsolute: resolveInside(root, recordRelative),
      initial,
      previousFingerprint: initial.fingerprint,
      unchangedWakes: 0,
      // Non-null means a finished-looking output is held for one more
      // observation, exactly as the focused watch holds one.
      heldOutput: null as string | null,
    }
  })
  type WatchedTarget = (typeof watched)[number]
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
    const evidence = evidenceFor(item, item.initial)

    if (evidence.strength === 'none') {
      continue
    }

    const terminal = evidence.strength === 'strong' ? 'completed' : undefined
    const terminalBasis =
      evidence.strength === 'strong' ? evidence.basis : undefined
    const hold = evidence.strength === 'weak' ? evidence.reason : undefined

    if (hold !== undefined) {
      item.heldOutput = outputSignature(item.initial)
    }

    const entry: WatchRecordEntry = {
      schema_version: 1,
      event: 'wake',
      run_id: item.target.runId,
      invocation_id: item.invocation.invocation_id,
      recorded_at: item.initial.observed_at,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      observation: item.initial,
      ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
      ...(hold ? { completion_hold: hold } : {}),
      changed: true,
      unchanged_wakes: 0,
      ...(terminal ? { terminal_state: terminal } : {}),
    }

    appendJsonLine(item.recordAbsolute, entry)
    options.onWake?.(entry)

    if (terminal) {
      initiallyMoved.push(movement(item, terminal))
    }
  }

  if (initiallyMoved.length > 0) {
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
      } satisfies WatchRecordEntry)
    }

    await sleep(Math.max(0, dueMs - now()))
    dueMs += cadenceMs
    wakes += 1
    const moved: MultiplexedWatchMovement[] = []
    const stalled: MultiplexedWatchMovement[] = []
    const timedOut = now() - startedMs >= timeoutMs

    for (const item of watched) {
      const observation = observeInvocation(root, item.invocation)

      snapshotBlockedOutput(
        root,
        item.target.runId,
        item.invocation.invocation_id,
      )

      const changed = observation.fingerprint !== item.previousFingerprint

      item.previousFingerprint = observation.fingerprint
      item.unchangedWakes = changed ? 0 : item.unchangedWakes + 1

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
          // The confirming wake the held observation bought, across which the
          // output did not move.
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

      const movedNow =
        terminal === 'completed' || (changed && hold === undefined)

      if (!movedNow && terminal === undefined && timedOut) {
        terminal = hold === undefined ? 'timed_out' : 'unverified'
      }

      const entry: WatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        run_id: item.target.runId,
        invocation_id: item.invocation.invocation_id,
        recorded_at: observation.observed_at,
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        observation,
        ...(terminalBasis ? { terminal_basis: terminalBasis } : {}),
        ...(hold ? { completion_hold: hold } : {}),
        changed,
        unchanged_wakes: item.unchangedWakes,
        ...(terminal ? { terminal_state: terminal } : {}),
      }

      appendJsonLine(item.recordAbsolute, entry)
      options.onWake?.(entry)

      if (movedNow) {
        moved.push(movement(item, terminal))
      } else if (terminal === 'stalled' || terminal === 'unverified') {
        stalled.push(movement(item, terminal))
      }
    }

    if (moved.length > 0) {
      return finish('changed', moved, stalled, wakes)
    }

    if (stalled.length > 0) {
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
      return finish('timed_out', [], stalled, wakes)
    }
  }
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
 */
function lastWakeObservedFinalOutput(
  root: string,
  wake: WatchRecordEntry | undefined,
): boolean {
  const observation = wake?.observation

  if (observation === undefined || !isTerminalObservation(observation)) {
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

  return {
    record_path: watchRecordPath(root, runId, invocationId),
    record_present: entries.length > 0,
    background_marked: marker !== null,
    background_mark_delay_seconds: markDelay,
    background_watch_late:
      markDelay !== null && markDelay > DELEGATION_WATCH_LATE_SECONDS,
    armings: armings.length,
    wakes: wakes.length,
    first_armed_at: armings[0]?.recorded_at ?? null,
    last_wake_at: wakes.at(-1)?.recorded_at ?? null,
    last_wake_observed_final_output: lastWakeObservedFinalOutput(
      root,
      terminal === undefined ? wakes.at(-1) : undefined,
    ),
    terminal_state: terminal?.terminal_state ?? null,
    terminal_basis: terminal?.terminal_basis ?? null,
    cadence_seconds: entries[0]?.cadence_seconds ?? null,
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
          (observation.watch.terminal_state === null
            ? `, and the output moved after that last wake, so no wake ` +
              `observed the output being submitted`
            : '')
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
// Platform-guidance redline record
// ---------------------------------------------------------------------------

export const REDLINE_RECORD_FILENAME = 'platform-guidance-redline.json'

export interface RedlineCategory {
  id: string
  description: string
  harness_authority: string
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
