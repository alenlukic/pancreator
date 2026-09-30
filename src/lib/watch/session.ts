/** Watch sessions: ownership lock, interruption closure, and gap recovery. */

import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PanError, isNodeError } from '../errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  processIsAlive,
  readJson,
  resolveInside,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'

import {
  WATCH_TARGET_BUSY,
  type WatchGap,
  type WatchRecordEntry,
} from './types.js'
import { watchLockPath, watchRecordPath } from './paths.js'
import { processStartIdentity } from './process-evidence.js'
import { readWatchRecord } from './record.js'

/**
 * Resolves after the given number of milliseconds on a real timer. Watches use
 * it unless a test injects its own sleep.
 */
export const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

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

/**
 * Whether any invocation of the run holds a watch lock with a live owner. The
 * evidence directory is scanned rather than the recorded workers, because a
 * watch can be armed before its worker handle is recorded.
 */
export function runHasLiveWatch(root: string, runId: string): boolean {
  const evidenceDir = resolveRunLayout(root, runId).evidence('.')
  let names: string[]

  try {
    names = readdirSync(evidenceDir.absolute)
  } catch {
    return false
  }

  return names
    .filter((name) => name.endsWith('-watch.lock'))
    .some((name) => {
      const record = readWatchLock(path.join(evidenceDir.absolute, name))

      return record !== null && watchLockOwnerAlive(record)
    })
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
  paths: { lock: string; record: string } = {
    lock: watchLockPath(root, runId, invocationId),
    record: watchRecordPath(root, runId, invocationId),
  },
): WatchLockAcquisition {
  const absolute = resolveInside(root, paths.lock)
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
        const recordPath = paths.record
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
    const recordPath = paths.record
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
