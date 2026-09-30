/** The opaque-timer watch for a platform handle the harness cannot inspect. */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import { appendJsonLine } from '../io.js'

import { DEFAULT_WATCH_CADENCE_SECONDS } from './types.js'
import { defaultSleep, installInterruptionHandlers } from './session.js'
import {
  type GenericWatchRecordEntry,
  genericWatchRecordPath,
  type GenericWatchResult,
  type TimerWatchOptions,
} from './process.js'

/**
 * Arm exactly one common-cadence timer for an opaque platform handle and
 * return its wake. The wake records the named subject and the inspection the
 * caller owes; it never satisfies delegation completion, because an opaque
 * handle exposes no machine-readable state the harness could verify.
 */
export async function watchTimer(
  root: string,
  options: TimerWatchOptions,
): Promise<GenericWatchResult> {
  invariant(options.label.trim().length > 0, '--label MUST name the wait.', {
    code: 'INVALID_ARGUMENT',
  })

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const record = genericWatchRecordPath(root, options.label, options.recordPath)
  const sessionId = randomUUID()

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()

  const append = (entry: GenericWatchRecordEntry): void => {
    appendJsonLine(record.absolute, entry)
  }
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    append({
      schema_version: 1,
      event: 'wake',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
  }, options.onInterrupted)

  try {
    append({
      schema_version: 1,
      event: 'session_started',
      subject: options.label,
      label: options.label,
      recorded_at: startedAt,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      watch_session_id: sessionId,
      watcher_pid: process.pid,
    })
    append({
      schema_version: 1,
      event: 'armed',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      wake_due_at: new Date(
        startedMs + Math.round(cadenceSeconds * 1000),
      ).toISOString(),
      watch_session_id: sessionId,
    })

    await sleep(
      Math.max(0, startedMs + Math.round(cadenceSeconds * 1000) - now()),
    )

    const wake: GenericWatchRecordEntry = {
      schema_version: 1,
      event: 'wake',
      subject: options.label,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: 1,
      watch_session_id: sessionId,
      requires_inspection: true,
      terminal_state: 'elapsed',
    }

    append(wake)
    options.onWake?.(wake)

    const endedMs = now()

    return {
      state: 'elapsed',
      label: options.label,
      subject: options.label,
      record_path: record.relative,
      cadence_seconds: cadenceSeconds,
      timeout_seconds: cadenceSeconds,
      wakes: 1,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: (endedMs - startedMs) / 1000,
      exit_status: null,
      watch_session_id: sessionId,
    }
  } finally {
    disposeInterruptionHandlers()
  }
}
