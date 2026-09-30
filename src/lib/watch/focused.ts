/** The focused watch: one invocation of one run on the fixed cadence. */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import { appendJsonLine, resolveInside } from '../io.js'

import {
  type AgentStateEvidenceReference,
  type AgentStopReason,
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_EVIDENCE_INVALID,
  WATCH_TIMEOUT_BELOW_CADENCE,
  type WatchGap,
  type WatchObservation,
  type WatchOptions,
  type WatchRecordEntry,
  type WatchResult,
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
import {
  loadAgentStateEvidence,
  processStartIdentity,
} from './process-evidence.js'
import { stallEvidenceFrom } from './record.js'
import { snapshotBlockedOutput } from './blocked-snapshot.js'
import {
  completionEvidenceForObservation,
  outputSignature,
  shellSingleQuote,
} from './completion.js'
import {
  acquireWatchLock,
  appendSessionGap,
  defaultSleep,
  detectSessionGap,
  installInterruptionHandlers,
} from './session.js'

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
      const observation = observeInvocation(root, invocation, cadenceSeconds)

      snapshotBlockedOutput(root, runId, invocationId)

      return observation
    }
    const finish = (
      state: WatchTerminalState,
      armings: number,
      wakes: number,
      lastObservation?: WatchObservation,
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
        ...(state === 'stalled' ||
        state === 'unverified' ||
        state === 'timed_out'
          ? {
              stall_evidence: stallEvidenceFrom(
                lastObservation?.agent_activity,
                endedMs,
              ),
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
    const initialStop = agentStopVerdict(initial)

    if (initialStop) {
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
        ...(initialStop.terminal === 'completed'
          ? { terminal_basis: initialStop.basis }
          : { unverified_reason: initialStop.reason }),
        changed: true,
        unchanged_wakes: 0,
        terminal_state: initialStop.terminal,
      })

      return finish(initialStop.terminal, 0, 0, initial)
    }

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
      unchangedWakes =
        changed ||
        scaffoldOrderAdvisory ||
        observation.agent_activity?.stall_suppressed === true
          ? 0
          : unchangedWakes + 1

      let terminal: WatchTerminalState | undefined
      let terminalBasis: WatchRecordEntry['terminal_basis']
      let hold: WeakCompletionReason | undefined
      let unverifiedReason: AgentStopReason | undefined
      const evidence = completionEvidenceForObservation(
        observation,
        launchToOutputSeconds(root, runId, invocationId),
        cadenceSeconds,
        agentState,
        agentStateEvidence,
      )
      const stopVerdict = agentStopVerdict(observation)

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
        ...(unverifiedReason ? { unverified_reason: unverifiedReason } : {}),
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
        return finish(terminal, armings, wakes, observation)
      }
    }
  } finally {
    disposeInterruptionHandlers()
    lock.release()
  }
}
