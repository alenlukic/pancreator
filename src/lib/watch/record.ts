/**
 * Watch record reading, ledger line formatting, and the delegation
 * observation summaries `pan submit` judges.
 */

import { isShellTool, type AgentActivity } from '../agent-index/activity.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
} from '../io.js'
import {
  delegationExecutionPath,
  loadDelegationExecutionRecord,
} from '../validation.js'

import {
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  DELEGATION_UNOBSERVED,
  DELEGATION_WATCH_LATE_SECONDS,
  type DelegationObservation,
  type DelegationObservationSource,
  type DelegationWatchSummary,
  type ForegroundReturnRecord,
  type ForegroundReturnSummary,
  type WatchRecordEntry,
  type WatchStallEvidence,
} from './types.js'
import {
  backgroundMarkerPath,
  foregroundReturnRecordPath,
  watchRecordPath,
} from './paths.js'
import { isTerminalObservation, observePath } from './observe.js'
import { validForegroundReturn, workerLifetime } from './lifetime.js'
import { readBlockingReceipts } from './blocking.js'
import { readLaunchRecord } from './launch.js'

/**
 * Reads an invocation's foreground-return record. Returns null when the file is
 * missing, unparseable, not schema version 1, names another invocation, or
 * lacks its launch and return times.
 */
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
      value.run_id === runId &&
      value.invocation_id === invocationId &&
      value.launch_mode === 'foreground' &&
      typeof value.launched_at === 'string' &&
      Number.isFinite(Date.parse(value.launched_at)) &&
      typeof value.returned_at === 'string' &&
      Date.parse(value.returned_at) >= Date.parse(value.launched_at) &&
      isRecord(value.observation) &&
      typeof value.observation.output_present === 'boolean'
      ? (value as unknown as ForegroundReturnRecord)
      : null
  } catch {
    return null
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

/**
 * A worker's open call, and its linked `bin/pan-run` heartbeat when the open
 * call is a shell call, as one trailing fragment for a wake line. Empty when
 * there is no activity to report, so output with no agent_activity stays
 * byte-identical to before this existed.
 */
export function formatOpenCallSuffix(
  activity: AgentActivity | undefined | null,
): string {
  const openCall = activity?.open_call

  if (!openCall) {
    return ''
  }

  const startedMs = Date.parse(openCall.started_at)
  const ageSeconds = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
    : null
  const base = ` open:${openCall.tool}${ageSeconds === null ? '' : ` ${ageSeconds}s`}`

  if (!isShellTool(openCall.tool)) {
    return base
  }

  const heartbeat = openCall.shell_heartbeat

  if (!heartbeat) {
    return `${base} [no pan-run heartbeat]`
  }

  const beatAge = Math.floor(heartbeat.age_seconds)
  const label = heartbeat.label ?? 'cmd'
  const pid = heartbeat.pid ?? '?'
  const last = heartbeat.recent_lines.at(-1)

  return (
    `${base} [pan-run ${label} pid=${pid} beat ${beatAge}s ago` +
    (last ? `: ${last}` : '') +
    ']'
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
    suffix +
    (observation?.agent_activity?.liveness?.basis === 'process'
      ? ' basis:process'
      : '') +
    formatOpenCallSuffix(observation?.agent_activity)
  )
}

const EMPTY_STALL_EVIDENCE: WatchStallEvidence = {
  agent_id: null,
  last_event_kind: null,
  last_event_at: null,
  last_event_age_seconds: null,
  open_call: null,
  stall_suppressed: false,
}

export function stallEvidenceFrom(
  activity: AgentActivity | null | undefined,
  nowMs: number,
): WatchStallEvidence {
  if (!activity) {
    return EMPTY_STALL_EVIDENCE
  }

  const openCall = activity.open_call
  const openCallStartedMs = openCall ? Date.parse(openCall.started_at) : NaN
  const openCallAgeSeconds = Number.isFinite(openCallStartedMs)
    ? Math.max(0, (nowMs - openCallStartedMs) / 1000)
    : 0

  return {
    agent_id: activity.agent_id,
    last_event_kind: activity.last_event_kind,
    last_event_at: activity.last_event_at,
    last_event_age_seconds: activity.last_event_age_seconds,
    open_call: openCall
      ? {
          tool: openCall.tool,
          started_at: openCall.started_at,
          age_seconds: openCallAgeSeconds,
          ...(openCall.summary ? { summary: openCall.summary } : {}),
          shell_heartbeat: openCall.shell_heartbeat,
        }
      : null,
    stall_suppressed: activity.stall_suppressed,
  }
}

/**
 * One line naming the evidence behind a `stalled` or `unverified` verdict,
 * so a supervisor cannot act on the verdict without also seeing the open
 * call and linked `bin/pan-run` heartbeat it rests on.
 */
export function formatStallEvidenceLine(
  evidence: WatchStallEvidence | undefined,
): string {
  if (!evidence || evidence.agent_id === null) {
    return 'worker: not in the agent index'
  }

  const openCall = evidence.open_call

  if (!openCall) {
    const age =
      evidence.last_event_age_seconds !== null
        ? `${Math.floor(evidence.last_event_age_seconds)}s ago`
        : 'unknown'

    return `worker: no open call; last event ${evidence.last_event_kind ?? 'none'} ${age}`
  }

  const age = Math.floor(openCall.age_seconds)
  const base = `worker: open ${openCall.tool} since ${openCall.started_at} (${age}s)`

  if (!openCall.shell_heartbeat) {
    return `${base}; no pan-run heartbeat linked`
  }

  const heartbeat = openCall.shell_heartbeat
  const beatAge = Math.floor(heartbeat.age_seconds)
  const label = heartbeat.label ?? 'cmd'
  const pid = heartbeat.pid ?? '?'
  const elapsed = heartbeat.elapsed_seconds ?? '?'
  const last = heartbeat.recent_lines.at(-1)

  return (
    `${base}; pan-run ${label} pid=${pid} record ${heartbeat.record_path}, ` +
    `heartbeat ${beatAge}s ago, ${elapsed}s elapsed` +
    (last ? `; last: ${last}` : '')
  )
}

/**
 * Reads the schema version 1 entries of an invocation's watch ledger in append
 * order, skipping blank or malformed lines. Returns an empty list when the
 * ledger does not exist.
 */
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

        return isRecord(parsed) &&
          parsed.schema_version === 1 &&
          parsed.run_id === runId &&
          parsed.invocation_id === invocationId
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
  receipts: ReturnType<typeof readBlockingReceipts>,
  ledger: string,
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
      const session = group[0]
      for (const receipt of receipts) {
        if (
          receipt.ledger !== ledger ||
          receipt.watch_session_id !== session?.watch_session_id ||
          receipt.watcher_pid !== session.watcher_pid ||
          receipt.watcher_process_identity !== session.watcher_process_identity
        )
          continue
        const start = Math.max(startMs, Date.parse(receipt.started_at))
        const end = Math.min(endMs, Date.parse(receipt.ended_at))
        if (end >= start) spans.push({ startMs: start, endMs: end })
      }
    }
  }

  return spans
}

function subtractDisclosedGaps(
  spans: Array<{ startMs: number; endMs: number }>,
  entries: WatchRecordEntry[],
): Array<{ startMs: number; endMs: number }> {
  let remaining = spans
  for (const entry of entries) {
    if (entry.event !== 'gap' || !entry.gap) continue
    const from = Date.parse(entry.gap.from)
    const to = Date.parse(entry.gap.to)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue
    remaining = remaining.flatMap((span) => {
      if (to <= span.startMs || from >= span.endMs) return [span]
      return [
        ...(from > span.startMs
          ? [{ startMs: span.startMs, endMs: from }]
          : []),
        ...(to < span.endMs ? [{ startMs: to, endMs: span.endMs }] : []),
      ]
    })
  }
  return remaining
}

/** Disjoint intervals covered by the union of all accepted spans. */
function unionWatchSpans(
  spans: Array<{ startMs: number; endMs: number }>,
): Array<{ startMs: number; endMs: number }> {
  const sorted = [...spans].sort((left, right) => left.startMs - right.startMs)
  const union: Array<{ startMs: number; endMs: number }> = []
  let currentStart: number | null = null
  let currentEnd: number | null = null

  for (const span of sorted) {
    if (
      currentStart === null ||
      currentEnd === null ||
      span.startMs > currentEnd
    ) {
      if (currentStart !== null && currentEnd !== null) {
        union.push({ startMs: currentStart, endMs: currentEnd })
      }

      currentStart = span.startMs
      currentEnd = span.endMs
    } else {
      currentEnd = Math.max(currentEnd, span.endMs)
    }
  }

  if (currentStart !== null && currentEnd !== null) {
    union.push({ startMs: currentStart, endMs: currentEnd })
  }

  return union
}

/** Summarize the watch record `pan submit` carries into the stage record. */
export function summarizeDelegationWatch(
  root: string,
  runId: string,
  invocationId: string,
): DelegationWatchSummary {
  // An evidence-complete verdict says the evidence reports are done, never
  // that the stage worker is, so it cannot count as this delegation's watch
  // even when one lands in the stage ledger.
  const entries = readWatchRecord(root, runId, invocationId).filter(
    (entry) => entry.terminal_basis !== 'evidence_complete',
  )
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
  const ledger = watchRecordPath(root, runId, invocationId)
  const receipts = readBlockingReceipts(resolveInside(root, ledger))
  const lifetime = workerLifetime(root, runId, invocationId)
  const foreground = readForegroundReturn(root, runId, invocationId)
  const launch = readLaunchRecord(root, runId, invocationId)
  const spans = watchSessionSpans(entries, receipts, ledger)
  if (validForegroundReturn(launch, foreground)) {
    spans.push({
      startMs: Date.parse(foreground.launched_at),
      endMs: Date.parse(foreground.returned_at),
    })
  }
  const clippedSpans =
    lifetime.started_ms !== null && lifetime.ended_ms !== null
      ? spans
          .map((span) => ({
            startMs: Math.max(span.startMs, lifetime.started_ms!),
            endMs: Math.min(span.endMs, lifetime.ended_ms!),
          }))
          .filter((span) => span.endMs >= span.startMs)
      : spans
  const observedSpans = subtractDisclosedGaps(
    unionWatchSpans(clippedSpans),
    entries,
  )
  const parentObserved = clippedSpans.length > 0
  const coveredSeconds =
    parentObserved && lifetime.started_ms !== null && lifetime.ended_ms !== null
      ? observedSpans.reduce(
          (total, span) => total + span.endMs - span.startMs,
          0,
        ) / 1000
      : null

  // The ratio reads only matching launch and terminal receipts.
  // A missing or unreadable clock is reported as unknown
  // rather than passed off as a numerical result.
  const launchToOutput = lifetime.seconds
  const coverageBasis: DelegationWatchSummary['coverage_basis'] =
    launchToOutput !== null && launchToOutput >= 0 && parentObserved
      ? 'launch_record'
      : entries.length > 0
        ? 'unknown'
        : null
  const coverageRatio =
    coverageBasis === 'launch_record' &&
    launchToOutput !== null &&
    launchToOutput > 0 &&
    coveredSeconds !== null
      ? Math.min(1, coveredSeconds / launchToOutput)
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
    // The entries exclude every evidence-complete wake above.
    terminal_basis:
      terminal?.terminal_basis === 'evidence_complete'
        ? null
        : (terminal?.terminal_basis ?? null),
    cadence_seconds: entries[0]?.cadence_seconds ?? null,
    cadence_exceptions: cadenceExceptions,
    raw_span_seconds: rawSpanSeconds,
    covered_seconds: coveredSeconds,
    coverage_ratio: coverageRatio,
    coverage_basis: coverageBasis,
    await_status: parentObserved
      ? 'observed'
      : entries.length > 0 || marker !== null
        ? 'unknown'
        : null,
    lifetime_seconds: lifetime.seconds,
    lifetime_diagnostics: lifetime.diagnostics,
    unawaited_timer_suspected: false,
  }
}

/**
 * Summarizes an invocation's foreground-return record for delegation evidence:
 * its path, whether it exists, the launch and return times, the elapsed time
 * and its plausibility, and whether the output was present at return. Fields
 * are null when the record is absent.
 */
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
 * foreground-return attestation satisfies the terminal observation gate.
 * Legacy completed ledgers retain that compatibility, with unknown parent
 * await status and coverage unless matching blocking receipts exist.
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
  const foregroundValid = validForegroundReturn(
    readLaunchRecord(root, runId, invocationId),
    readForegroundReturn(root, runId, invocationId),
  )

  // An execution audit proves worker completion, not parent observation.
  const executionRecord = loadDelegationExecutionRecord(
    root,
    runId,
    invocationId,
  )
  const executionRecordMatches =
    executionRecord !== null &&
    executionRecord.run_id === runId &&
    executionRecord.invocation_id === invocationId
  const source: DelegationObservationSource | null =
    executionRecordMatches &&
    (watch.await_status === 'observed' || foregroundValid)
      ? 'external_executor'
      : watch.terminal_state === 'completed'
        ? 'watch_completed'
        : watch.last_wake_observed_final_output
          ? 'watch_observed_final_output'
          : foregroundValid
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
