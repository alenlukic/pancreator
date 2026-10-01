/** `pan watch --attach`: rejoin a detached watch session through its ledger. */

import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readText, resolveInside } from '../io.js'

import {
  ATTACH_POLL_MS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_BLOCK_BOUND_MS,
  WATCH_EXIT_CODES,
  WATCH_PARENT_BACKSTOP_SECONDS,
  WATCH_TIMEOUT_BELOW_CADENCE,
  type WatchStallCause,
} from './types.js'
import { processRunning, processStartIdentity } from './process-evidence.js'
import { defaultSleep } from './session.js'
import type { AgentLiveness } from './liveness.js'
import { agentLiveness } from './liveness.js'
import type { AgentActivity } from '../agent-index/activity.js'

/** Exit code the CLI returns when an attach session is orphaned. */
export const WATCH_ATTACH_EXIT_ORPHANED = 5

/** Exit code when the parent backstop returns control to the starting agent. */
export const WATCH_ATTACH_EXIT_WAKE = 7

export const WATCH_ATTACH_NO_SESSION = 'WATCH_ATTACH_NO_SESSION'

const FOLLOWED_VERDICT_EXIT_CODES: Record<string, number> = {
  ...WATCH_EXIT_CODES,
  exited: 0,
  elapsed: 0,
  failed: 1,
  unregistered: 6,
}

export type AttachTerminalState =
  | 'attach_completed'
  | 'attach_timed_out'
  | 'attach_wake'
  | 'orphaned'

export interface AttachLatestWake {
  wake: number
  recorded_at: string
  terminal_state?: string
  completion_hold?: string
  stall_cause?: WatchStallCause
  liveness?: AgentLiveness
}

export interface AttachSessionEntry {
  ledger: string
  state: AttachTerminalState | null
  session_terminal_state?: string
  latest_wake?: AttachLatestWake
}

export interface WatchAttachOptions {
  ledgers: string[]
  timeoutSeconds?: number
  cadenceSeconds?: number
  cadenceAuthority?: string
  untilTerminal?: boolean
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
  backstop_seconds: number
  block_bound_ms: number
  cadence_authority?: string
  exit_code: number
  reattach_command: string
}

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

function inspectLedger(absolutePath: string): {
  watcherPid: number | null
  watcherIdentity: string | null
  terminalState: string | null
  latestWake: AttachLatestWake | null
} {
  const entries = readLedgerEntries(absolutePath)

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

  let lastSessionIdx = -1

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.event === 'session_started') {
      lastSessionIdx = i
      break
    }
  }

  let terminalState: string | null = null
  let latestWake: AttachLatestWake | null = null

  for (let i = lastSessionIdx + 1; i < entries.length; i += 1) {
    const entry = entries[i]

    if (entry === undefined) {
      continue
    }

    if (entry.event === 'wake' && typeof entry.wake === 'number') {
      const observation = isRecord(entry.observation)
        ? (entry.observation as { agent_activity?: AgentActivity })
        : undefined
      const activity = observation?.agent_activity ?? null

      latestWake = {
        wake: entry.wake,
        recorded_at:
          typeof entry.recorded_at === 'string'
            ? entry.recorded_at
            : new Date(0).toISOString(),
        ...(typeof entry.terminal_state === 'string'
          ? { terminal_state: entry.terminal_state }
          : {}),
        ...(typeof entry.completion_hold === 'string'
          ? { completion_hold: entry.completion_hold }
          : {}),
        ...(typeof entry.stall_cause === 'string'
          ? { stall_cause: entry.stall_cause as WatchStallCause }
          : {}),
        liveness: agentLiveness(activity),
      }

      if (typeof entry.terminal_state === 'string') {
        terminalState = entry.terminal_state
      }
    }
  }

  return { watcherPid, watcherIdentity, terminalState, latestWake }
}

export async function watchAttach(
  root: string,
  options: WatchAttachOptions,
): Promise<WatchAttachResult> {
  invariant(
    options.ledgers.length > 0,
    '--attach requires at least one ledger.',
    { code: 'INVALID_ARGUMENT' },
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
  const backstopMs = WATCH_PARENT_BACKSTOP_SECONDS * 1000
  const pollMs = Math.min(ATTACH_POLL_MS, Math.round(cadenceSeconds * 1000))

  const sessions: AttachSessionEntry[] = options.ledgers.map((ledger) => ({
    ledger,
    state: null,
  }))

  const reattachCommand = `./bin/pan watch --attach ${options.ledgers.join(',')}`

  const lastIdentityCheckMs = new Map<string, number>()

  for (;;) {
    let allDone = true

    for (const session of sessions) {
      if (session.state !== null) {
        continue
      }

      const abs = resolveInside(root, session.ledger)

      if (!fileExists(abs)) {
        session.state = 'orphaned'
        continue
      }

      const { watcherPid, watcherIdentity, terminalState, latestWake } =
        inspectLedger(abs)

      session.latest_wake = latestWake ?? undefined

      if (terminalState !== null) {
        session.state = 'attach_completed'
        session.session_terminal_state = terminalState
        continue
      }

      if (watcherPid !== null) {
        const alive = processRunning(watcherPid)
        const nowMs = now()
        const lastCheckMs = lastIdentityCheckMs.get(session.ledger)
        const identityDue =
          lastCheckMs === undefined ||
          nowMs - lastCheckMs >= Math.round(cadenceSeconds * 1000)
        const identityNow =
          alive && identityDue ? processStartIdentity(watcherPid) : null
        const identityMatch =
          alive &&
          (watcherIdentity === null ||
            identityNow === null ||
            identityNow === watcherIdentity)

        if (identityDue) {
          lastIdentityCheckMs.set(session.ledger, nowMs)
        }

        if (!alive || !identityMatch) {
          session.state = 'orphaned'
          continue
        }
      }

      allDone = false
    }

    if (allDone) {
      break
    }

    const elapsedMs = now() - startedMs

    if (
      !options.untilTerminal &&
      elapsedMs >= backstopMs &&
      sessions.some((session) => session.state === null)
    ) {
      for (const session of sessions) {
        if (session.state === null) {
          session.state = 'attach_wake'
        }
      }

      break
    }

    if (elapsedMs >= timeoutMs) {
      for (const session of sessions) {
        if (session.state === null) {
          session.state = 'attach_timed_out'
        }
      }

      break
    }

    await sleep(pollMs)
  }

  let overallState: AttachTerminalState = 'attach_completed'

  for (const session of sessions) {
    if (session.state === 'orphaned') {
      overallState = 'orphaned'
      break
    }

    if (session.state === 'attach_timed_out') {
      overallState = 'attach_timed_out'
    } else if (session.state === 'attach_wake') {
      overallState = 'attach_wake'
    }
  }

  const endedMs = now()
  const exitCode =
    overallState === 'orphaned'
      ? WATCH_ATTACH_EXIT_ORPHANED
      : overallState === 'attach_timed_out'
        ? WATCH_EXIT_CODES.timed_out
        : overallState === 'attach_wake'
          ? WATCH_ATTACH_EXIT_WAKE
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
    backstop_seconds: WATCH_PARENT_BACKSTOP_SECONDS,
    block_bound_ms: WATCH_BLOCK_BOUND_MS,
    ...(options.cadenceAuthority
      ? { cadence_authority: options.cadenceAuthority }
      : {}),
    exit_code: exitCode,
    reattach_command: reattachCommand,
  }
}
