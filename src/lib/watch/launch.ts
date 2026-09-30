/**
 * Launch records: the launch clock of a worker invocation and its background
 * marker.
 */

import { PanError, invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'

import {
  DELEGATION_WATCH_LATE_SECONDS,
  type LaunchTimeSource,
} from './types.js'
import { backgroundMarkerPath, watchRecordPath } from './paths.js'
import { PLATFORM_ACTION_CATEGORY } from './redline.js'

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
export function launchedMsFromRecord(
  record: LaunchRecord | null,
): number | null {
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
