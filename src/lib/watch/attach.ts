/** `pan watch --attach`: rejoin a detached watch session through its ledger. */

import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readText, resolveInside } from '../io.js'

import {
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_EXIT_CODES,
  WATCH_TIMEOUT_BELOW_CADENCE,
} from './types.js'
import { processRunning, processStartIdentity } from './process-evidence.js'
import { defaultSleep } from './session.js'

/** Exit code the CLI returns when an attach session is orphaned. */
export const WATCH_ATTACH_EXIT_ORPHANED = 5

export const WATCH_ATTACH_NO_SESSION = 'WATCH_ATTACH_NO_SESSION'

/** Exit codes of every verdict a followed worker or generic session can record. */
const FOLLOWED_VERDICT_EXIT_CODES: Record<string, number> = {
  ...WATCH_EXIT_CODES,
  exited: 0,
  elapsed: 0,
  failed: 1,
  // 5 is already WATCH_ATTACH_EXIT_ORPHANED.
  unregistered: 6,
}

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
  /** Operator direction behind a non-default cadence, echoed in the result. */
  cadenceAuthority?: string
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
  cadence_seconds: number
  cadence_authority?: string
  /**
   * The CLI exit code: 5 when any session orphaned, 3 when any attach timed
   * out, and otherwise the highest exit code among the followed verdicts, so
   * a single followed session exits with its own verdict's code.
   */
  exit_code: number
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
    invariant(
      readLedgerEntries(abs).some((entry) => entry.event === 'session_started'),
      `--attach ledger ${ledger} records no watch session to follow. Arm a ` +
        `watch with './bin/pan watch' instead.`,
      { code: WATCH_ATTACH_NO_SESSION },
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
        // The ledger vanished after the attach verified its session.
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
  const exitCode =
    overallState === 'orphaned'
      ? WATCH_ATTACH_EXIT_ORPHANED
      : overallState === 'attach_timed_out'
        ? WATCH_EXIT_CODES.timed_out
        : Math.max(
            0,
            ...sessions.map(
              (session) =>
                FOLLOWED_VERDICT_EXIT_CODES[
                  session.session_terminal_state ?? ''
                ] ?? 1,
            ),
          )

  return {
    state: overallState,
    ledgers: sessions,
    started_at: startedAt,
    ended_at: new Date(endedMs).toISOString(),
    elapsed_seconds: (endedMs - startedMs) / 1000,
    timeout_seconds: timeoutSeconds,
    cadence_seconds: cadenceSeconds,
    ...(options.cadenceAuthority
      ? { cadence_authority: options.cadenceAuthority }
      : {}),
    exit_code: exitCode,
  }
}
