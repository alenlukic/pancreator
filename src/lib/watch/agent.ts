/** Standalone agent watch (US-003, US-004, AC-006). */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import {
  getAgentEntry,
  readAgentActivity,
  type AgentActivity,
} from '../agent-index/activity.js'
import {
  agentIndexHooksStatus,
  type AgentIndexHooksStatus,
} from '../agent-index/hooks-status.js'
import type { AgentEntry } from '../agent-index/store.js'
import { appendJsonLine } from '../io.js'

import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_TIMEOUT_BELOW_CADENCE,
} from './types.js'
import { processStartIdentity } from './process-evidence.js'
import { defaultSleep, installInterruptionHandlers } from './session.js'

export interface WatchAgentOptions {
  /** How long between wakes, in seconds. */
  cadenceSeconds?: number
  /** Trimmed operator direction behind a non-default cadence. */
  cadenceAuthority?: string
  /** Five-minute stall window. */
  stallTimeoutSeconds?: number
  /** One-hour default bound. */
  timeoutSeconds?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onWake?: (info: WatchAgentWakeInfo) => void
  /** Fired once with the `session_started` entry before the first arming. */
  onSessionStart?: (entry: WatchAgentSessionEntry) => void
  /** Test hook replacing the signal re-raise that ends an interrupted watch. */
  onInterrupted?: (signal: string) => void
}

export type AgentWatchVerdict =
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'timed_out'
  | 'interrupted'
  | 'unregistered'

/**
 * The first ledger entry of a standalone agent watch. It carries the watcher
 * pid so `pan watch --attach` can follow the ledger, and the agent's index
 * entry and aliases as the watch found them at arming.
 */
export interface WatchAgentSessionEntry {
  schema_version: 1
  event: 'session_started'
  subject: string
  recorded_at: string
  cadence_seconds: number
  wake: 0
  watch_session_id: string
  watcher_pid: number
  watcher_process_identity: string | null
  timeout_seconds: number
  cadence_authority?: string
  /** The ledger `pan watch --attach` follows, relative to the root. */
  record_path: string
  agent_entry: AgentEntry | null
  aliases: string[]
  /** Whether the projected `.cursor/hooks.json` still wires the agent-index hooks, or null when there is nothing canonical to compare against. */
  hooks_projection: AgentIndexHooksStatus | null
}

export interface WatchAgentWakeInfo {
  schema_version: 1
  event: 'wake'
  subject: string
  recorded_at: string
  wake: number
  cadence_seconds: number
  watch_session_id: string
  /** Null while the index has not registered the agent. */
  agent_activity: AgentActivity | null
  changed: boolean
  unchanged_wakes: number
  terminal_state?: AgentWatchVerdict
  terminal_basis?: 'agent_state'
  interrupted_reason?: string
  /** Recorded again on the `unregistered` verdict so the ledger's last line carries the likely cause. */
  hooks_projection?: AgentIndexHooksStatus | null
}

export interface WatchAgentResult {
  state: AgentWatchVerdict
  agent_id: string
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  watch_session_id: string
  record_path: string
}

/** The path where standalone agent-watch ledgers live. */
function agentWatchLedgerPath(root: string, agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return path.join(root, 'runtime', 'logs', 'watch', `agent-${safe}.jsonl`)
}

/**
 * Standalone agent watch for a subagent launched outside a run.
 *
 * The first ledger entry is `session_started`, so `pan watch --attach` can
 * rejoin the ledger. Each wake reads the agent index afresh, so an agent the
 * index registers after arming is still found. A completed stop completes on
 * the agent's own state, and the wake records whether a transcript was left;
 * an error or aborted stop fails. An open call
 * suppresses the stall verdict, but an open shell call only while its linked
 * `bin/pan-run` heartbeat stays fresh.
 *
 * The CLI exits 0 on completed, 1 on failed, 2 on stall, 3 at the bound, 6 on
 * `unregistered`, and 130 on interruption. `unregistered` covers an agent id
 * the index has never seen: that is not evidence the agent is unchanged, so
 * it never counts toward a stall. The session-start ledger entry and the
 * `unregistered` wake both record whether the projected `.cursor/hooks.json`
 * still wires the agent-index hooks, because a stale projection is the
 * ordinary cause.
 */
export async function watchAgent(
  root: string,
  agentId: string,
  options: WatchAgentOptions = {},
): Promise<WatchAgentResult> {
  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const stallTimeoutSeconds =
    options.stallTimeoutSeconds ?? DEFAULT_STALL_TIMEOUT_SECONDS
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ${cadenceSeconds}.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const sessionId = randomUUID()
  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const recordPath = agentWatchLedgerPath(root, agentId)
  const maxStallWakes = Math.max(
    1,
    Math.ceil(stallTimeoutSeconds / cadenceSeconds),
  )

  mkdirSync(path.dirname(recordPath), { recursive: true })

  const read = (): AgentActivity | null =>
    readAgentActivity(root, agentId, now(), cadenceSeconds)
  let activity = read()
  let wakes = 0
  let unchangedWakes = 0
  // Separate from unchangedWakes: an agent id the index has never seen is
  // not evidence of unchanged state, it is an absence of evidence. Counting
  // it toward the same threshold would make "never registered" and "went
  // quiet" the same verdict, and DELEGATE-001's stall recovery instruction
  // does not apply to the former.
  let unregisteredWakes = 0
  let previousSignature = activity?.signature ?? null
  const hooksProjection = agentIndexHooksStatus(root)

  const subject = (): string => activity?.agent_id ?? agentId
  const finish = (state: AgentWatchVerdict): WatchAgentResult => ({
    state,
    agent_id: subject(),
    wakes,
    started_at: startedAt,
    ended_at: new Date(now()).toISOString(),
    elapsed_seconds: (now() - startedMs) / 1000,
    watch_session_id: sessionId,
    record_path: path.relative(root, recordPath),
  })
  const record = (
    fields: Pick<WatchAgentWakeInfo, 'changed'> &
      Partial<
        Pick<
          WatchAgentWakeInfo,
          | 'terminal_state'
          | 'terminal_basis'
          | 'interrupted_reason'
          | 'hooks_projection'
        >
      >,
  ): WatchAgentWakeInfo => {
    const info: WatchAgentWakeInfo = {
      schema_version: 1,
      event: 'wake',
      subject: subject(),
      recorded_at: new Date(now()).toISOString(),
      wake: wakes,
      cadence_seconds: cadenceSeconds,
      watch_session_id: sessionId,
      agent_activity: activity,
      unchanged_wakes: unchangedWakes,
      ...fields,
    }

    appendJsonLine(recordPath, info)
    options.onWake?.(info)

    return info
  }
  const stopVerdict = (): AgentWatchVerdict | null => {
    const stop = activity?.stop

    if (!stop) {
      return null
    }

    return stop.status === 'completed' ? 'completed' : 'failed'
  }

  const entry = getAgentEntry(root, agentId)
  const session: WatchAgentSessionEntry = {
    schema_version: 1,
    event: 'session_started',
    subject: subject(),
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
    record_path: path.relative(root, recordPath),
    agent_entry: entry,
    aliases: activity?.aliases ?? [],
    hooks_projection: hooksProjection,
  }

  appendJsonLine(recordPath, session)
  options.onSessionStart?.(session)

  const initialStop = stopVerdict()

  if (initialStop) {
    record({
      changed: true,
      terminal_state: initialStop,
      ...(initialStop === 'completed'
        ? { terminal_basis: 'agent_state' as const }
        : {}),
    })

    return finish(initialStop)
  }

  let interrupted = false
  const disposeInterruption = installInterruptionHandlers((signal) => {
    interrupted = true
    record({
      changed: false,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
  }, options.onInterrupted)

  try {
    for (;;) {
      const elapsedMs = now() - startedMs

      await sleep(
        Math.max(
          0,
          Math.min(cadenceSeconds * 1000, timeoutSeconds * 1000 - elapsedMs),
        ),
      )

      if (interrupted) {
        return finish('interrupted')
      }

      wakes += 1
      activity = read()

      const signature = activity?.signature ?? null
      const changed = signature !== previousSignature

      previousSignature = signature

      if (activity === null) {
        unregisteredWakes += 1
      } else {
        unregisteredWakes = 0
        unchangedWakes =
          changed || activity.stall_suppressed === true ? 0 : unchangedWakes + 1
      }

      const verdict: AgentWatchVerdict | null =
        stopVerdict() ??
        (unregisteredWakes >= maxStallWakes
          ? 'unregistered'
          : unchangedWakes >= maxStallWakes
            ? 'stalled'
            : now() - startedMs >= timeoutSeconds * 1000
              ? 'timed_out'
              : null)

      record({
        changed,
        ...(verdict ? { terminal_state: verdict } : {}),
        ...(verdict === 'completed'
          ? { terminal_basis: 'agent_state' as const }
          : {}),
        ...(verdict === 'unregistered'
          ? { hooks_projection: hooksProjection }
          : {}),
      })

      if (verdict) {
        return finish(verdict)
      }
    }
  } finally {
    disposeInterruption()
  }
}
