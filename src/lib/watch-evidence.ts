/**
 * The evidence-complete watch: `pan watch <run-id> --until-evidence-complete`.
 *
 * A verify stage launches its evidence workers first and its stage worker
 * only after every report is complete. The stage watch completes on the
 * stage output, so it cannot say when the reports are done, and supervisors
 * polled report files with a timer script and launched the verifier by hand
 * minutes later. This watch returns within one cadence of the last report's
 * completion marker and writes a ready marker the supervisor acts on.
 *
 * It keeps its own ledger and lock. The evidence workers and the stage
 * worker share one invocation id, so a completed wake in the stage ledger or
 * a launch recorded at this arming would read as the stage worker's own
 * delegation evidence.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

import { invariant } from './errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import {
  EVIDENCE_REPORT_COMPLETE_MARKER,
  evidenceWorkerAttempts,
  readEvidenceReportState,
} from './render/delivery-prompt.js'
import { loadState, operationMutexPath, persist } from './state.js'
import type { Invocation } from './types.js'
import { observeInvocation } from './watch/observe.js'
import {
  evidenceReadyPath,
  evidenceWatchLockPath,
  evidenceWatchRecordPath,
  resolveWatchedInvocation,
} from './watch/paths.js'
import { processStartIdentity } from './watch/process-evidence.js'
import {
  acquireWatchLock,
  installInterruptionHandlers,
} from './watch/session.js'
import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_TIMEOUT_BELOW_CADENCE,
  type EvidenceRoleObservation,
  type WatchRecordEntry,
  type WatchTerminalState,
} from './watch/types.js'

export const WATCH_NO_EVIDENCE_WORKERS = 'WATCH_NO_EVIDENCE_WORKERS'

/** Wait for the run mutex this long before giving up the audit event. */
const READY_EVENT_MUTEX_WAIT_MS = 250

export interface EvidenceReadiness {
  roles: EvidenceRoleObservation[]
  /** Every declared role's newest report carries the completion marker. */
  all_complete: boolean
}

/** The ready marker the watch writes once every report is complete. */
export interface EvidenceReadyRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  roles: Array<{
    role: string
    attempt: number
    path: string
    /** Modification time of the completed report. */
    completed_at: string
  }>
  recorded_at: string
}

export interface EvidenceWatchOptions {
  invocationId?: string
  cadenceSeconds?: number
  cadenceAuthority?: string
  stallTimeoutSeconds?: number
  /** Test override; ordinary callers configure a duration. */
  stallWakes?: number
  timeoutSeconds?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  onWake?: (entry: WatchRecordEntry) => void
  onInterrupted?: (signal: string) => void
}

export interface EvidenceWatchResult {
  state: WatchTerminalState
  run_id: string
  invocation_id: string
  record_path: string
  /** Harness-relative ready marker; present on `completed` only. */
  ready_path: string | null
  roles: EvidenceRoleObservation[]
  cadence_seconds: number
  stall_timeout_seconds: number
  timeout_seconds: number
  armings: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  watch_session_id: string
  terminal_basis: 'evidence_complete' | null
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

/**
 * The newest declared report of each evidence role, and whether all of them
 * are complete.
 *
 * The newest attempt decides, not the newest non-empty one: a relaunch means
 * the earlier report was not accepted, so its marker proves nothing about the
 * report the stage worker will read. An invocation with no evidence workers
 * is never complete, so the watch cannot pass vacuously.
 */
export function observeEvidenceReports(
  root: string,
  invocation: Pick<Invocation, 'evidence_workers'>,
): EvidenceReadiness {
  const roles = (invocation.evidence_workers ?? []).map(
    (worker): EvidenceRoleObservation => {
      const attempts = evidenceWorkerAttempts(worker)
      const newest = attempts[attempts.length - 1] as (typeof attempts)[number]
      const absolute = resolveInside(root, newest.evidence_path)
      let body = ''

      try {
        body = readFileSync(absolute, 'utf8')
      } catch {
        body = ''
      }

      return {
        role: worker.role,
        attempt: newest.attempt,
        path: newest.evidence_path,
        exists: fileExists(absolute),
        non_empty: body.trim().length > 0,
        complete: readEvidenceReportState(body).complete,
      }
    },
  )

  return {
    roles,
    all_complete: roles.length > 0 && roles.every((role) => role.complete),
  }
}

/** The ready marker for an invocation, or null when none was written. */
export function readEvidenceReady(
  root: string,
  runId: string,
  invocationId: string,
): EvidenceReadyRecord | null {
  const absolute = resolveInside(
    root,
    evidenceReadyPath(root, runId, invocationId),
  )

  if (!fileExists(absolute)) {
    return null
  }

  try {
    const value = readJson(absolute)

    return isRecord(value) &&
      value.schema_version === 1 &&
      value.invocation_id === invocationId &&
      Array.isArray(value.roles)
      ? (value as unknown as EvidenceReadyRecord)
      : null
  } catch {
    return null
  }
}

function completedAt(root: string, relativePath: string): string {
  try {
    return statSync(resolveInside(root, relativePath)).mtime.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Append the `evidence_ready` run event. Losing it never ends the watch: the
 * ready marker is already on disk and is the durable signal.
 */
function recordEvidenceReadyEvent(
  root: string,
  runId: string,
  record: EvidenceReadyRecord,
  readyPath: string,
): void {
  try {
    withOperationMutex(
      operationMutexPath(root, runId),
      () => {
        persist(root, loadState(root, runId), 'evidence_ready', {
          invocation_id: record.invocation_id,
          roles: record.roles.map((role) => role.role),
          ready_path: readyPath,
        })
      },
      { waitForHolderMs: READY_EVENT_MUTEX_WAIT_MS },
    )
  } catch {
    // The marker file carries the signal; the event is an audit line only.
  }
}

/**
 * Block until every evidence report of the invocation is complete, the
 * reports and the workers stop changing for the stall bound, or the watch
 * reaches its bound.
 */
export async function watchEvidenceCompletion(
  root: string,
  runId: string,
  options: EvidenceWatchOptions = {},
): Promise<EvidenceWatchResult> {
  const invocation = resolveWatchedInvocation(root, runId, options.invocationId)
  const invocationId = invocation.invocation_id

  invariant(
    (invocation.evidence_workers ?? []).length > 0,
    `Invocation ${invocationId} declares no evidence workers, so there is ` +
      'no evidence report to wait for. Watch the stage worker with ' +
      `\`pan watch ${runId}\` instead.`,
    { code: WATCH_NO_EVIDENCE_WORKERS },
  )

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const stallTimeoutSeconds =
    options.stallTimeoutSeconds ?? DEFAULT_STALL_TIMEOUT_SECONDS
  const stallWakes =
    options.stallWakes ??
    Math.max(1, Math.ceil(stallTimeoutSeconds / cadenceSeconds))
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ` +
      `${cadenceSeconds}: the watch could not complete a single wake.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const recordPath = evidenceWatchRecordPath(root, runId, invocationId)
  const recordAbsolute = resolveInside(root, recordPath)
  const readyPath = evidenceReadyPath(root, runId, invocationId)
  const sessionId = randomUUID()
  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const lock = acquireWatchLock(root, runId, invocationId, sessionId, {
    lock: evidenceWatchLockPath(root, runId, invocationId),
    record: recordPath,
  })
  const append = (entry: WatchRecordEntry): void => {
    appendJsonLine(recordAbsolute, entry)
  }
  let wakes = 0
  let armings = 0
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    append({
      schema_version: 1,
      event: 'wake',
      run_id: runId,
      invocation_id: invocationId,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: wakes + 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
    lock.release()
  }, options.onInterrupted)

  const finish = (
    state: WatchTerminalState,
    roles: EvidenceRoleObservation[],
  ): EvidenceWatchResult => {
    const endedMs = now()

    return {
      state,
      run_id: runId,
      invocation_id: invocationId,
      record_path: recordPath,
      ready_path: state === 'completed' ? readyPath : null,
      roles,
      cadence_seconds: cadenceSeconds,
      stall_timeout_seconds: stallTimeoutSeconds,
      timeout_seconds: timeoutSeconds,
      armings,
      wakes,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: Math.round((endedMs - startedMs) / 1000),
      watch_session_id: sessionId,
      terminal_basis: state === 'completed' ? 'evidence_complete' : null,
    }
  }

  const complete = (roles: EvidenceRoleObservation[]): EvidenceWatchResult => {
    const record: EvidenceReadyRecord = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocationId,
      roles: roles.map((role) => ({
        role: role.role,
        attempt: role.attempt,
        path: role.path,
        completed_at: completedAt(root, role.path),
      })),
      recorded_at: new Date(now()).toISOString(),
    }

    writeJsonAtomic(resolveInside(root, readyPath), record)
    recordEvidenceReadyEvent(root, runId, record, readyPath)

    return finish('completed', roles)
  }

  try {
    append({
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
    })

    // Reports already complete at arming need no wait at all.
    const initial = observeEvidenceReports(root, invocation)

    if (initial.all_complete) {
      append({
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: 0,
        watch_session_id: sessionId,
        evidence_roles: initial.roles,
        terminal_state: 'completed',
        terminal_basis: 'evidence_complete',
      })

      return complete(initial.roles)
    }

    // Progress is the stage watch's own fingerprint: reports, the run tree,
    // the workspace, and the agent activity of every worker registered for
    // the invocation. A reviewer that reads for minutes before writing its
    // report is still progressing.
    let lastFingerprint = observeInvocation(
      root,
      invocation,
      cadenceSeconds,
    ).fingerprint
    let unchanged = 0
    const deadlineMs = startedMs + timeoutSeconds * 1000

    for (;;) {
      armings += 1
      const wakeDueMs = now() + cadenceSeconds * 1000

      append({
        schema_version: 1,
        event: 'armed',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes + 1,
        watch_session_id: sessionId,
        timeout_seconds: timeoutSeconds,
        wake_due_at: new Date(wakeDueMs).toISOString(),
      })

      await sleep(cadenceSeconds * 1000)
      wakes += 1

      const readiness = observeEvidenceReports(root, invocation)
      const fingerprint = observeInvocation(
        root,
        invocation,
        cadenceSeconds,
      ).fingerprint
      const changed = fingerprint !== lastFingerprint

      unchanged = changed ? 0 : unchanged + 1
      lastFingerprint = fingerprint

      const terminal: WatchTerminalState | null = readiness.all_complete
        ? 'completed'
        : unchanged >= stallWakes
          ? 'stalled'
          : now() >= deadlineMs
            ? 'timed_out'
            : null
      const entry: WatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        run_id: runId,
        invocation_id: invocationId,
        recorded_at: new Date(now()).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        evidence_roles: readiness.roles,
        changed,
        unchanged_wakes: unchanged,
        ...(terminal ? { terminal_state: terminal } : {}),
        ...(terminal === 'completed'
          ? { terminal_basis: 'evidence_complete' as const }
          : {}),
      }

      append(entry)
      options.onWake?.(entry)

      if (terminal === 'completed') {
        return complete(readiness.roles)
      }

      if (terminal) {
        return finish(terminal, readiness.roles)
      }
    }
  } finally {
    disposeInterruptionHandlers()
    lock.release()
  }
}

/** One-line operator text for a finished evidence watch. */
export function formatEvidenceWatchResult(result: EvidenceWatchResult): string {
  const roles = result.roles
    .map(
      (role) =>
        `${role.role}${role.complete ? '' : role.non_empty ? ' (incomplete)' : ' (missing)'}`,
    )
    .join(', ')

  return result.state === 'completed'
    ? `evidence complete: roles ${roles}; marker ${result.ready_path}. ` +
        'Launch the stage worker now.'
    : `evidence watch ${result.state} after ${result.wakes} wake(s): roles ${roles}. ` +
        `Each report must end with ${EVIDENCE_REPORT_COMPLETE_MARKER}. ` +
        'Inspect the evidence workers; relaunch a stopped one with ' +
        '`pan worker record --role <role> --new-attempt`.'
}
