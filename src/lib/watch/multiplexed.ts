/** The multiplexed watch: several run invocations under one timer. */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import { appendJsonLine, resolveInside } from '../io.js'

import {
  type AgentStopReason,
  type CompletionEvidence,
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_TIMEOUT_BELOW_CADENCE,
  type WatchGap,
  type WatchObservation,
  type WatchRecordEntry,
  type WatchTerminalState,
  type WeakCompletionReason,
} from './types.js'
import { resolveWatchedInvocation, watchRecordPath } from './paths.js'
import {
  agentStopVerdict,
  launchToOutputSeconds,
  observeInvocation,
  OUTPUT_SCAFFOLD_ORDER_ADVISORY,
} from './observe.js'
import { markDelegationBackground, recordInvocationLaunch } from './launch.js'
import { processStartIdentity } from './process-evidence.js'
import { snapshotBlockedOutput } from './blocked-snapshot.js'
import {
  completionEvidenceForObservation,
  outputSignature,
} from './completion.js'
import {
  acquireWatchLock,
  appendSessionGap,
  defaultSleep,
  detectSessionGap,
  installInterruptionHandlers,
  type WatchLockAcquisition,
} from './session.js'

export interface MultiplexedWatchTarget {
  runId: string
  invocationId: string
}

/**
 * Parses a comma-separated `--targets` value of `<run-id>:<invocation-id>`
 * pairs. Returns null when the option is absent. Throws `INVALID_ARGUMENT` for
 * a malformed pair.
 */
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

      const initial = observeInvocation(root, item.invocation, cadenceSeconds)

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
    const initiallyUnverified: MultiplexedWatchMovement[] = []

    for (const item of watched) {
      const initial = item.initial as WatchObservation
      const evidence = evidenceFor(item, initial)
      const stopVerdict = agentStopVerdict(initial)

      if (evidence.strength === 'none' && stopVerdict === null) {
        continue
      }

      const terminal: WatchTerminalState | undefined =
        stopVerdict?.terminal ??
        (evidence.strength === 'strong' ? 'completed' : undefined)
      const terminalBasis =
        stopVerdict?.terminal === 'completed'
          ? stopVerdict.basis
          : stopVerdict === null && evidence.strength === 'strong'
            ? evidence.basis
            : undefined
      const unverifiedReason =
        stopVerdict?.terminal === 'unverified' ? stopVerdict.reason : undefined
      const hold =
        stopVerdict === null && evidence.strength === 'weak'
          ? evidence.reason
          : undefined

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
        ...(unverifiedReason ? { unverified_reason: unverifiedReason } : {}),
        ...(hold ? { completion_hold: hold } : {}),
        changed: true,
        unchanged_wakes: 0,
        ...(terminal ? { terminal_state: terminal } : {}),
      }

      appendJsonLine(item.recordAbsolute, entry)
      options.onWake?.(entry)

      if (terminal === 'unverified') {
        item.terminalReached = true
        initiallyUnverified.push(movement(item, terminal))
      } else if (terminal) {
        item.terminalReached = true
        initiallyMoved.push(movement(item, terminal))
      }
    }

    if (initiallyMoved.length > 0) {
      endOpenSessions()

      return finish('changed', initiallyMoved, initiallyUnverified, 0)
    }

    if (initiallyUnverified.length > 0) {
      endOpenSessions()

      return finish('unverified', [], initiallyUnverified, 0)
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
        const observation = observeInvocation(
          root,
          item.invocation,
          cadenceSeconds,
        )

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
          changed ||
          scaffoldOrderAdvisory ||
          observation.agent_activity?.stall_suppressed === true
            ? 0
            : item.unchangedWakes + 1

        const evidence = evidenceFor(item, observation)
        const stopVerdict = agentStopVerdict(observation)
        let terminal: WatchTerminalState | undefined
        let terminalBasis: WatchRecordEntry['terminal_basis']
        let hold: WeakCompletionReason | undefined
        let unverifiedReason: AgentStopReason | undefined

        if (stopVerdict?.terminal === 'completed') {
          terminal = 'completed'
          terminalBasis = stopVerdict.basis
        } else if (stopVerdict?.terminal === 'unverified') {
          terminal = 'unverified'
          unverifiedReason = stopVerdict.reason
        } else if (evidence.strength === 'strong') {
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
          ...(unverifiedReason ? { unverified_reason: unverifiedReason } : {}),
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
