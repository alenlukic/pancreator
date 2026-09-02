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
 * and return wall-clock times instead. `pan submit` requires one of the two
 * records for every Cursor worker invocation and refuses with
 * `DELEGATION_UNOBSERVED` otherwise.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import { isUntouchedScaffold } from './requirements/scaffold.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState, operationMutexPath, persist } from './state.js'
import type { Invocation, RunState } from './types.js'
import {
  delegationExecutionPath,
  delegationPath,
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

/** Cadence `DELEGATE-001` names for a background subagent under 15 minutes. */
export const DEFAULT_WATCH_CADENCE_SECONDS = 120
/** Cadence `DELEGATE-001` names for work expected to exceed 15 minutes. */
export const LONG_WORK_WATCH_CADENCE_SECONDS = 300
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
  watched_paths: WatchedPathObservation[]
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
  terminal_basis?: 'agent_state' | 'output_plausible'
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
  /** The launched agent's state, as the supervisor observed it. */
  agentState?: WatchAgentState
  /** Injected for tests. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
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
  terminal_state: WatchTerminalState | null
  /** What the terminal verdict rested on, when it was `completed`. */
  terminal_basis: 'agent_state' | 'output_plausible' | null
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
  /** Wall-clock time the launch happened. */
  launched_at: string
  /**
   * Where `launched_at` came from: the supervisor's `--launched-at` value, the
   * delegation artifact the supervisor persisted immediately before the
   * launch, or the invocation record when no delegation artifact exists yet.
   */
  launched_at_source: 'supervisor' | 'delegation_artifact' | 'invocation_record'
  /** Wall-clock time the supervisor observed the launch return. */
  returned_at: string
  elapsed_seconds: number
  /** Terminal-state inspection of the output and evidence paths at return. */
  observation: WatchObservation
  watch_record_path: string
  recorded_at: string
}

/** Digest of the foreground-return attestation `pan submit` carries. */
export interface ForegroundReturnSummary {
  record_path: string
  record_present: boolean
  launched_at: string | null
  returned_at: string | null
  elapsed_seconds: number | null
  output_present_at_return: boolean | null
}

/** How `pan submit` saw the delegation reach its terminal state. */
export type DelegationObservationSource =
  | 'watch_completed'
  | 'foreground_return'
  | 'external_executor'

export interface DelegationObservation {
  observed: boolean
  source: DelegationObservationSource | null
  watch: DelegationWatchSummary
  foreground_return: ForegroundReturnSummary
  /** Where `pan delegate` writes the external-executor record, when relevant. */
  execution_record_path: string | null
  execution_record_present: boolean
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

/** Evidence files the invocation owns, by the `<invocation-id>` name prefix. */
function invocationEvidencePaths(
  root: string,
  runId: string,
  invocationId: string,
): string[] {
  const evidenceDir = resolveRunLayout(root, runId).evidence('.')
  const ownRecord = path.basename(watchRecordPath(root, runId, invocationId))
  const ownMarker = path.basename(
    backgroundMarkerPath(root, runId, invocationId),
  )
  const ownReturn = path.basename(
    foregroundReturnRecordPath(root, runId, invocationId),
  )

  try {
    return readdirSync(evidenceDir.absolute)
      .filter(
        (name) =>
          name.startsWith(invocationId) &&
          name !== ownRecord &&
          name !== ownMarker &&
          name !== ownReturn,
      )
      .sort()
      .map((name) => path.posix.join(evidenceDir.relative, name))
  } catch {
    return []
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
    } catch {
      outputParses = false
    }
  }

  const watched = [
    outputPath,
    delegationPath(invocation.run_id, invocation.invocation_id, root),
    ...invocationEvidencePaths(
      root,
      invocation.run_id,
      invocation.invocation_id,
    ),
  ].map((relative) => observePath(root, relative))
  const fingerprint = watched
    .map((item) => `${item.path}:${item.exists}:${item.size}:${item.mtime_ms}`)
    .join('|')

  return {
    observed_at: new Date().toISOString(),
    output_path: outputPath,
    output_present: outputPresent,
    output_parses: outputParses,
    output_is_scaffold: outputIsScaffold,
    output_matches_invocation: outputMatches,
    watched_paths: watched,
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
  // The delegation artifact is written immediately before the launch, so its
  // mtime is when supervision was owed. Without this number a supervisor that
  // armed the watch at once and one that armed it after an operator
  // reprimand leave identical evidence.
  const launch = observePath(root, delegationPath(runId, invocationId, root))
  const launchedAt =
    launch.mtime_ms === null
      ? null
      : new Date(Math.floor(launch.mtime_ms)).toISOString()
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
    first_marked_at: firstMarkedAt,
    mark_delay_seconds: delaySeconds,
    late: delaySeconds !== null && delaySeconds > DELEGATION_WATCH_LATE_SECONDS,
    marked_at: markedAt,
    watch_record_path: watchRecordPath(root, runId, invocationId),
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

/** The three conditions that make an observation terminal. */
export function isTerminalObservation(observation: WatchObservation): boolean {
  return (
    observation.output_present &&
    observation.output_parses &&
    observation.output_matches_invocation &&
    !observation.output_is_scaffold
  )
}

/**
 * Seconds between the launch and the output the watch is about to call
 * terminal, or null when neither time is readable. The delegation artifact is
 * written immediately before the launch, so its mtime is the launch time the
 * foreground-return attestation already uses.
 */
export function launchToOutputSeconds(
  root: string,
  runId: string,
  invocationId: string,
): number | null {
  const launch = observePath(root, delegationPath(runId, invocationId, root))
  const output = observePath(
    root,
    resolveRunLayout(root, runId).output(invocationId).relative,
  )

  if (launch.mtime_ms === null || output.mtime_ms === null) {
    return null
  }

  return (output.mtime_ms - launch.mtime_ms) / 1000
}

/**
 * The terminal verdict for one observation, or null when the worker has not
 * produced a finished output yet.
 *
 * Both the pre-loop check and every wake run this. Run 63310 genre-label
 * showed why: the early-output guard sat only before the timer, so a draft
 * that appeared after the loop started still terminated the watch.
 */
export function terminalStateForObservation(
  observation: WatchObservation,
  sinceLaunchSeconds: number | null,
  cadenceSeconds: number,
  agentState?: WatchAgentState,
): 'completed' | 'unverified' | null {
  if (!isTerminalObservation(observation)) {
    return null
  }

  if (agentState === 'completed') {
    return 'completed'
  }

  if (agentState === 'running') {
    return 'unverified'
  }

  // An output written within one cadence of the launch is a draft far more
  // often than a finished stage, and files cannot tell the two apart.
  return sinceLaunchSeconds !== null && sinceLaunchSeconds < cadenceSeconds
    ? 'unverified'
    : 'completed'
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
 * wall-clock times. The launch time defaults to the delegation artifact's
 * modification time, because the supervisor persists that artifact
 * immediately before the launch, and falls back to the invocation record.
 */
export function recordForegroundReturn(
  root: string,
  runId: string,
  options: ForegroundReturnOptions = {},
): ForegroundReturnRecord {
  const invocation = resolveWatchedInvocation(root, runId, options.invocationId)
  const invocationId = invocation.invocation_id
  const returnedMs = Date.now()
  let launchedMs: number
  let launchedAtSource: ForegroundReturnRecord['launched_at_source']

  if (options.launchedAt !== undefined) {
    launchedMs = parseIsoTime(options.launchedAt, '--launched-at')
    launchedAtSource = 'supervisor'
  } else {
    const delegationArtifact = observePath(
      root,
      delegationPath(runId, invocationId, root),
    )

    // File times carry sub-millisecond precision; `Date.now()` does not, so a
    // fractional mtime taken in the same millisecond would read as later.
    if (delegationArtifact.exists && delegationArtifact.mtime_ms !== null) {
      launchedMs = Math.floor(delegationArtifact.mtime_ms)
      launchedAtSource = 'delegation_artifact'
    } else {
      const invocationRecord = observePath(
        root,
        resolveRunLayout(root, runId).invocation(invocationId, '.json')
          .relative,
      )

      launchedMs = Math.floor(invocationRecord.mtime_ms ?? returnedMs)
      launchedAtSource = 'invocation_record'
    }
  }

  invariant(
    launchedMs <= returnedMs,
    `The launch time ${new Date(launchedMs).toISOString()} is after the ` +
      `return time ${new Date(returnedMs).toISOString()}.`,
    { code: 'INVALID_ARGUMENT' },
  )

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

  const record: ForegroundReturnRecord = {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: 'foreground',
    launched_at: new Date(launchedMs).toISOString(),
    launched_at_source: launchedAtSource,
    returned_at: new Date(returnedMs).toISOString(),
    elapsed_seconds: (returnedMs - launchedMs) / 1000,
    observation,
    watch_record_path: watchRecordPath(root, runId, invocationId),
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
  const recordRelative = watchRecordPath(root, runId, invocationId)
  const recordAbsolute = resolveInside(root, recordRelative)
  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
  const backgroundMarker = options.markBackground
    ? markDelegationBackground(root, runId, invocationId)
    : null

  const append = (entry: WatchRecordEntry): void => {
    appendJsonLine(recordAbsolute, entry)
  }
  const finish = (
    state: WatchTerminalState,
    armings: number,
    wakes: number,
  ): WatchResult => {
    const endedMs = Date.now()

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
  const initial = observeInvocation(root, invocation)

  const initialState = terminalStateForObservation(
    initial,
    launchToOutputSeconds(root, runId, invocationId),
    cadenceSeconds,
    options.agentState,
  )

  if (initialState !== null) {
    const state = initialState

    if (state === 'completed') {
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
        terminal_basis:
          options.agentState === 'completed'
            ? 'agent_state'
            : 'output_plausible',
        changed: true,
        unchanged_wakes: 0,
        terminal_state: 'completed',
      })

      return finish('completed', 0, 0)
    }

    if (options.agentState === undefined) {
      append({
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: initial.observed_at,
        cadence_seconds: cadenceSeconds,
        wake: 0,
        observation: initial,
        changed: true,
        unchanged_wakes: 0,
        terminal_state: 'unverified',
      })

      return finish('unverified', 0, 0)
    }
  }

  let previousFingerprint = initial.fingerprint
  let unchangedWakes = 0
  let armings = 0
  let wakes = 0

  for (;;) {
    armings += 1
    const armedAt = Date.now()

    append({
      schema_version: 1,
      event: 'armed',
      run_id: runId,
      invocation_id: invocationId,
      recorded_at: new Date(armedAt).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: wakes + 1,
      wake_due_at: new Date(armedAt + cadenceSeconds * 1000).toISOString(),
    })

    await sleep(cadenceSeconds * 1000)

    wakes += 1
    const observation = observeInvocation(root, invocation)
    const changed = observation.fingerprint !== previousFingerprint

    previousFingerprint = observation.fingerprint
    unchangedWakes = changed ? 0 : unchangedWakes + 1

    let terminal: WatchTerminalState | undefined

    // `running` describes what the supervisor saw when it started the watch,
    // not a standing verdict: it suppresses the pre-loop short-circuit, and a
    // later wake that finds a finished output still completes normally.
    const decided = terminalStateForObservation(
      observation,
      launchToOutputSeconds(root, runId, invocationId),
      cadenceSeconds,
      options.agentState === 'completed' ? 'completed' : undefined,
    )

    if (decided !== null) {
      terminal = decided
    } else if (unchangedWakes >= stallWakes) {
      // A worker that scaffolded its output and then died leaves the same
      // still files as one that is thinking. The harness cannot tell those
      // apart, so it reports what it knows and sends the supervisor to the
      // agent rather than calling a working worker stalled — unless the
      // supervisor already looked and said the agent is running, which is the
      // answer the stall check was asking for.
      if (observation.output_is_scaffold) {
        if (options.agentState !== 'running') {
          terminal = 'unverified'
        }
      } else {
        terminal = 'stalled'
      }
    } else if (Date.now() - startedMs >= timeoutSeconds * 1000) {
      terminal = 'timed_out'
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
      ...(terminal === 'completed'
        ? {
            terminal_basis: (options.agentState === 'completed'
              ? 'agent_state'
              : 'output_plausible') as 'agent_state' | 'output_plausible',
          }
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
  const suffix = entry.terminal_state ? ` -> ${entry.terminal_state}` : ''

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
    output_present_at_return: record?.observation.output_present ?? null,
  }
}

/**
 * Decide whether the harness saw the delegation reach its terminal state.
 * A completed watch or a foreground-return attestation satisfies
 * `DELEGATE-001`; an external-executor stage is exempt because `pan delegate`
 * writes its delegation evidence itself.
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
  // hand-supplied output for an external-executor stage has no such record
  // and is as unobserved as any other.
  const executionRecord = options.externalExecutor
    ? loadDelegationExecutionRecord(root, runId, invocationId)
    : null
  const executionRecordMatches =
    executionRecord !== null &&
    executionRecord.run_id === runId &&
    executionRecord.invocation_id === invocationId
  const source: DelegationObservationSource | null = executionRecordMatches
    ? 'external_executor'
    : watch.terminal_state === 'completed'
      ? 'watch_completed'
      : foregroundReturn.output_present_at_return === true
        ? 'foreground_return'
        : null

  return {
    observed: source !== null,
    source,
    watch,
    foreground_return: foregroundReturn,
    execution_record_path: options.externalExecutor
      ? delegationExecutionPath(runId, invocationId, root)
      : null,
    execution_record_present: executionRecord !== null,
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
        `the output was already present when the watch began, and it landed ` +
        `too soon after the launch to be a finished worker's output. The ` +
        `harness reads files, not agents, so it cannot tell that output from ` +
        `a draft the worker is still rewriting`
      : observation.watch.record_present
        ? `the watch record ${observation.watch.record_path} ends without a ` +
          `completed wake (${observation.watch.wakes} wakes, last state ` +
          `${observation.watch.terminal_state ?? 'none'})`
        : `no watch record exists at ${observation.watch.record_path}`
  const attestationDetail =
    observation.foreground_return.record_present &&
    observation.foreground_return.output_present_at_return !== true
      ? `the attestation at ${observation.foreground_return.record_path} ` +
        `recorded no output present at return and does not count`
      : `no attestation exists at ${observation.foreground_return.record_path}`
  const external =
    observation.execution_record_path !== null &&
    !observation.execution_record_present
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
        `it finished. The window is measured from the launch to the output, ` +
        `not from now, so an unchanged re-run returns unverified again.`
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
  'The active invocation or standalone governance card.',
  'This operating card.',
  'The run snapshots.',
  'The policies resolved for the active context.',
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
