/** Generic process watch for waits outside a workflow run. */

import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { appendJsonLine, isRecord, resolveInside } from '../io.js'

import {
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_TIMEOUT_BELOW_CADENCE,
} from './types.js'
import { processRunning, processStartIdentity } from './process-evidence.js'
import { shellSingleQuote } from './completion.js'
import { defaultSleep, installInterruptionHandlers } from './session.js'

/**
 * Where a generic watch writes when the caller names no record. The directory
 * lives under the harness runtime tree rather than in any run, because these
 * forms exist for waits outside a workflow.
 */
export const GENERIC_WATCH_RECORD_DIRECTORY = 'runtime/logs/watch'

/** The result states a generic watch can reach. */
export type GenericWatchTerminalState =
  | 'exited'
  | 'elapsed'
  | 'timed_out'
  | 'unverified'
  | 'interrupted'

export interface GenericWatchRecordEntry {
  schema_version: 1
  event: 'session_started' | 'armed' | 'wake'
  /** The process pid, or the opaque handle label for a timer. */
  subject: string
  label: string
  recorded_at: string
  cadence_seconds: number
  wake: number
  watch_session_id: string
  watcher_pid?: number
  timeout_seconds?: number
  wake_due_at?: string
  /** Process liveness observed on this wake, when knowable. */
  process_alive?: boolean
  /** The recorded start identity still matches the live process. */
  process_identity_match?: boolean
  /** Bounded metadata of the watched output file, when one was declared. */
  output?: {
    path: string
    exists: boolean
    size: number | null
    mtime_ms: number | null
    /** Bytes added since the previous wake; null on the first wake or when the file is absent. */
    growth_bytes: number | null
    /** Seconds since the file last grew (now - mtime); null when absent. */
    silent_seconds: number | null
    /** Last non-empty lines, each capped, present only when the file grew (or on the first wake). */
    tail?: string[]
  }
  /**
   * The `bin/pan-run` heartbeat sibling of `--exit-record`, when the exit
   * record path is readable and a heartbeat.json sits beside it.
   */
  heartbeat?: {
    elapsed_seconds: number | null
    log_bytes: number | null
    last_output_at: string | null
    /** Seconds since heartbeat.json was last written. */
    beat_age_seconds: number
  }
  /**
   * A timer wake carries the inspection the caller owes. A generic record
   * never satisfies delegation completion.
   */
  requires_inspection?: boolean
  terminal_state?: GenericWatchTerminalState
  /** Exit status on an `exited` terminal wake of a process watch. */
  exit_status?: 'unknown' | number
  interrupted_reason?: string
}

export interface GenericWatchResult {
  state: GenericWatchTerminalState
  label: string
  subject: string
  record_path: string
  cadence_seconds: number
  timeout_seconds: number
  wakes: number
  started_at: string
  ended_at: string
  elapsed_seconds: number
  /**
   * Exit status of the observed process. `'unknown'` means the process was
   * seen to exit but no authoritative exit record was supplied. A number
   * means the exit record (`--exit-record`) was read and held a numeric
   * `exit_code`. `null` means the process did not exit during the watch.
   */
  exit_status: 'unknown' | number | null
  watch_session_id: string
  /**
   * Exact command to re-arm the same bounded observation. Present only when
   * state is `timed_out`, so an agent can keep waiting without re-entering
   * --process and --label.
   */
  rearm_command?: string
}

const EXIT_RECORD_SETTLE_ATTEMPTS = 10

const EXIT_RECORD_SETTLE_INTERVAL_MS = 200
const WATCH_OUTPUT_TAIL_LINES = 5
const WATCH_OUTPUT_LINE_CHARS = 160
const WATCH_OUTPUT_TAIL_BYTES = 64 * 1024

/** The last non-empty lines of a file, each capped, read from at most the final 64 KiB. */
function readOutputTail(absolute: string, size: number): string[] {
  if (size <= 0) {
    return []
  }

  const length = Math.min(size, WATCH_OUTPUT_TAIL_BYTES)
  const buffer = Buffer.alloc(length)
  let fd: number | null = null

  try {
    fd = openSync(absolute, 'r')
    readSync(fd, buffer, 0, length, size - length)
  } catch {
    return []
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // The file may have been removed between the stat and the read.
      }
    }
  }

  return buffer
    .toString('utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .slice(-WATCH_OUTPUT_TAIL_LINES)
    .map((line) => line.slice(0, WATCH_OUTPUT_LINE_CHARS))
}

/**
 * The `bin/pan-run` heartbeat sitting beside an `--exit-record` path, when
 * both the exit record path and its heartbeat.json sibling are readable.
 */
function readSiblingHeartbeat(
  exitRecordAbsolute: string | null,
  nowMs: number,
): GenericWatchRecordEntry['heartbeat'] {
  if (exitRecordAbsolute === null) {
    return undefined
  }

  const heartbeatPath = path.join(
    path.dirname(exitRecordAbsolute),
    'heartbeat.json',
  )

  try {
    const stats = statSync(heartbeatPath)
    const raw: unknown = JSON.parse(readFileSync(heartbeatPath, 'utf8'))

    if (!isRecord(raw)) {
      return undefined
    }

    return {
      elapsed_seconds:
        typeof raw.elapsed_seconds === 'number' ? raw.elapsed_seconds : null,
      log_bytes: typeof raw.log_bytes === 'number' ? raw.log_bytes : null,
      last_output_at:
        typeof raw.last_output_at === 'string' ? raw.last_output_at : null,
      beat_age_seconds: Math.max(0, (nowMs - stats.mtimeMs) / 1000),
    }
  } catch {
    return undefined
  }
}

export interface ProcessWatchOptions {
  /** The process to observe. */
  pid: number
  /** Operator-readable name for the wait. */
  label: string
  /** Optional file whose bounded metadata each wake records. */
  outputPath?: string
  /** Harness-relative record path; defaults under `runtime/logs/watch/`. */
  recordPath?: string
  /**
   * Harness-relative path, inside `runtime/logs`, to a `pan-run` exit record
   * (`record.json`). When the process has exited and the record holds a
   * numeric `exit_code`, the result's `exit_status` reports that code instead
   * of `'unknown'`.
   */
  exitRecordPath?: string
  cadenceSeconds?: number
  timeoutSeconds?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  /** Injected for tests. Defaults to `processStartIdentity`. */
  identityProbe?: (pid: number) => string | null
  onWake?: (entry: GenericWatchRecordEntry) => void
  onInterrupted?: (signal: string) => void
}

export interface TimerWatchOptions {
  /** Operator-readable name for the wait. */
  label: string
  recordPath?: string
  cadenceSeconds?: number
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  onWake?: (entry: GenericWatchRecordEntry) => void
  onInterrupted?: (signal: string) => void
}

function resolveInsideRuntimeLogs(
  root: string,
  relative: string,
  subject: string,
): string {
  const absolute = resolveInside(root, relative)
  const logsRoot = resolveInside(root, 'runtime/logs')

  invariant(
    absolute === logsRoot || absolute.startsWith(`${logsRoot}${path.sep}`),
    `${subject} MUST stay inside the runtime tree (runtime/logs): ${relative}`,
    { code: 'PATH_ESCAPE' },
  )

  return absolute
}

/**
 * Returns the absolute and root-relative path of a generic watch ledger. A
 * caller-supplied path must stay inside `runtime/logs` or the call throws
 * `PATH_ESCAPE`; otherwise a unique timestamped file named from the sanitized
 * label is chosen under `runtime/logs/watch`.
 */
export function genericWatchRecordPath(
  root: string,
  label: string,
  recordPath: string | undefined,
): { absolute: string; relative: string } {
  if (recordPath !== undefined) {
    return {
      absolute: resolveInsideRuntimeLogs(
        root,
        recordPath,
        'A watch record path',
      ),
      relative: recordPath,
    }
  }

  const safeLabel = label
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const relative = path.posix.join(
    GENERIC_WATCH_RECORD_DIRECTORY,
    `${safeLabel || 'watch'}-${stamp}-${randomUUID().slice(0, 8)}.jsonl`,
  )

  return { absolute: resolveInside(root, relative), relative }
}

/**
 * Watch one process by PID and start identity until it exits, its identity
 * changes, or the bound arrives. Liveness that cannot be observed is
 * `unverified`, never `completed`; an observed exit is reported as an exit,
 * never as a success.
 */
export async function watchProcess(
  root: string,
  options: ProcessWatchOptions,
): Promise<GenericWatchResult> {
  invariant(
    Number.isInteger(options.pid) && options.pid > 0,
    `--process MUST be a positive integer pid, not ${options.pid}.`,
    { code: 'INVALID_ARGUMENT' },
  )
  invariant(options.label.trim().length > 0, '--label MUST name the wait.', {
    code: 'INVALID_ARGUMENT',
  })

  const cadenceSeconds = options.cadenceSeconds ?? DEFAULT_WATCH_CADENCE_SECONDS
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_WATCH_TIMEOUT_SECONDS

  invariant(
    timeoutSeconds >= cadenceSeconds,
    `--timeout-seconds ${timeoutSeconds} is below the resolved cadence ` +
      `${cadenceSeconds}.`,
    { code: WATCH_TIMEOUT_BELOW_CADENCE },
  )

  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  const record = genericWatchRecordPath(root, options.label, options.recordPath)
  const sessionId = randomUUID()

  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const subject = String(options.pid)

  // The identity captured at arm is what a later liveness answer is compared
  // against: a reused PID is an identity change, not the watched process.
  const identityProbe = options.identityProbe ?? processStartIdentity
  const startIdentity = identityProbe(options.pid)
  const aliveAtArm = processRunning(options.pid)

  const outputAbsolute = options.outputPath
    ? resolveInside(root, options.outputPath)
    : null
  const exitRecordAbsolute =
    options.exitRecordPath === undefined
      ? null
      : resolveInsideRuntimeLogs(
          root,
          options.exitRecordPath,
          'An --exit-record path',
        )

  const append = (entry: GenericWatchRecordEntry): void => {
    appendJsonLine(record.absolute, entry)
  }
  let wakes = 0
  const disposeInterruptionHandlers = installInterruptionHandlers((signal) => {
    append({
      schema_version: 1,
      event: 'wake',
      subject,
      label: options.label,
      recorded_at: new Date(now()).toISOString(),
      cadence_seconds: cadenceSeconds,
      wake: wakes + 1,
      watch_session_id: sessionId,
      terminal_state: 'interrupted',
      interrupted_reason: signal,
    })
  }, options.onInterrupted)

  const readExitRecord = (): {
    exitCode: number | null
    wrapperPid: number
  } => {
    try {
      const raw: unknown = JSON.parse(
        readFileSync(exitRecordAbsolute as string, 'utf8'),
      )

      if (isRecord(raw)) {
        return {
          exitCode: Number.isInteger(raw.exit_code)
            ? (raw.exit_code as number)
            : null,
          wrapperPid: Number.isInteger(raw.wrapper_pid)
            ? (raw.wrapper_pid as number)
            : 0,
        }
      }
    } catch {
      // An absent or partly written record reads as no exit code.
    }

    return { exitCode: null, wrapperPid: 0 }
  }

  /**
   * The wrapper writes the exit code after its output drains, so a record
   * without one is re-read briefly while that wrapper is still alive.
   */
  const settleExitStatus = async (): Promise<'unknown' | number> => {
    if (exitRecordAbsolute === null) {
      return 'unknown'
    }

    for (let attempt = 0; ; attempt += 1) {
      const { exitCode, wrapperPid } = readExitRecord()

      if (exitCode !== null) {
        return exitCode
      }

      if (
        attempt >= EXIT_RECORD_SETTLE_ATTEMPTS ||
        wrapperPid <= 0 ||
        !processRunning(wrapperPid)
      ) {
        return 'unknown'
      }

      await sleep(EXIT_RECORD_SETTLE_INTERVAL_MS)
    }
  }

  const finish = (
    state: GenericWatchTerminalState,
    exitStatus: 'unknown' | number | null = null,
  ): GenericWatchResult => {
    const endedMs = now()
    const rearmCommand =
      state === 'timed_out'
        ? [
            `./bin/pan watch --process ${options.pid}`,
            `--label ${shellSingleQuote(options.label)}`,
            ...(options.outputPath
              ? [`--output ${shellSingleQuote(options.outputPath)}`]
              : []),
            ...(options.exitRecordPath
              ? [`--exit-record ${shellSingleQuote(options.exitRecordPath)}`]
              : []),
            `--timeout-seconds ${timeoutSeconds}`,
          ].join(' ')
        : undefined

    return {
      state,
      label: options.label,
      subject,
      record_path: record.relative,
      cadence_seconds: cadenceSeconds,
      timeout_seconds: timeoutSeconds,
      wakes,
      started_at: startedAt,
      ended_at: new Date(endedMs).toISOString(),
      elapsed_seconds: (endedMs - startedMs) / 1000,
      exit_status: exitStatus,
      watch_session_id: sessionId,
      ...(rearmCommand ? { rearm_command: rearmCommand } : {}),
    }
  }

  try {
    append({
      schema_version: 1,
      event: 'session_started',
      subject,
      label: options.label,
      recorded_at: startedAt,
      cadence_seconds: cadenceSeconds,
      wake: 0,
      watch_session_id: sessionId,
      watcher_pid: process.pid,
      timeout_seconds: timeoutSeconds,
    })

    // Tracked across wakes so a wake can report bytes added since the last
    // one, rather than only the size at this instant.
    let lastObservedSize: number | null = null

    const observeOutput = (
      nowMs: number,
    ): GenericWatchRecordEntry['output'] => {
      if (outputAbsolute === null) {
        return undefined
      }

      let stats: { size: number; mtimeMs: number } | null = null

      try {
        const raw = statSync(outputAbsolute)

        stats = { size: raw.size, mtimeMs: raw.mtimeMs }
      } catch {
        stats = null
      }

      if (stats === null) {
        lastObservedSize = null

        return {
          path: options.outputPath as string,
          exists: false,
          size: null,
          mtime_ms: null,
          growth_bytes: null,
          silent_seconds: null,
        }
      }

      const previousSize = lastObservedSize
      // The first wake always counts as "grown": there is nothing earlier to
      // compare against, and its tail is the whole bounded window so far.
      const grown = previousSize === null || stats.size > previousSize
      const growthBytes =
        previousSize === null ? null : Math.max(0, stats.size - previousSize)
      const silentSeconds = Math.max(0, (nowMs - stats.mtimeMs) / 1000)

      lastObservedSize = stats.size

      return {
        path: options.outputPath as string,
        exists: true,
        size: stats.size,
        mtime_ms: stats.mtimeMs,
        growth_bytes: growthBytes,
        silent_seconds: silentSeconds,
        ...(grown ? { tail: readOutputTail(outputAbsolute, stats.size) } : {}),
      }
    }

    if (!aliveAtArm) {
      // The process was already gone when the watch armed. When the caller
      // supplied an exit record, read it: an integer exit code means the
      // process exited cleanly and the caller can rely on the status.
      // Without a readable integer code the observation stays unverified.
      let deadAtArmExitStatus: number | null = null

      if (exitRecordAbsolute !== null) {
        const { exitCode } = readExitRecord()

        if (typeof exitCode === 'number') {
          deadAtArmExitStatus = exitCode
        }
      }

      wakes += 1
      const armWakeMs = now()
      const output = observeOutput(armWakeMs)
      const heartbeat = readSiblingHeartbeat(exitRecordAbsolute, armWakeMs)
      const terminalState: GenericWatchTerminalState =
        deadAtArmExitStatus !== null ? 'exited' : 'unverified'
      const entry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        subject,
        label: options.label,
        recorded_at: new Date(armWakeMs).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        process_alive: false,
        process_identity_match: false,
        ...(output ? { output } : {}),
        ...(heartbeat ? { heartbeat } : {}),
        terminal_state: terminalState,
        ...(deadAtArmExitStatus !== null
          ? { exit_status: deadAtArmExitStatus }
          : {}),
      }

      append(entry)
      options.onWake?.(entry)

      return finish(terminalState, deadAtArmExitStatus)
    }

    const cadenceMs = Math.round(cadenceSeconds * 1000)
    const timeoutMs = Math.round(timeoutSeconds * 1000)
    let dueMs = startedMs + cadenceMs

    for (;;) {
      const armedAt = now()

      if (dueMs < armedAt) {
        dueMs = armedAt + cadenceMs
      }

      append({
        schema_version: 1,
        event: 'armed',
        subject,
        label: options.label,
        recorded_at: new Date(armedAt).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes + 1,
        wake_due_at: new Date(dueMs).toISOString(),
        watch_session_id: sessionId,
        timeout_seconds: timeoutSeconds,
      })

      await sleep(Math.max(0, dueMs - now()))
      dueMs += cadenceMs
      wakes += 1

      const alive = processRunning(options.pid)
      const identityNow = alive ? identityProbe(options.pid) : null
      // A change is only claimed on evidence: both identities known and
      // different. An unavailable answer never convicts a live process.
      const identityChanged =
        alive &&
        startIdentity !== null &&
        identityNow !== null &&
        identityNow !== startIdentity
      const identityMatch = alive ? !identityChanged : false

      const timedOut = now() - startedMs >= timeoutMs

      let terminal: GenericWatchTerminalState | undefined

      if (!alive || identityChanged) {
        terminal = 'exited'
      } else if (timedOut) {
        terminal = 'timed_out'
      }

      const exitStatus =
        terminal === 'exited' ? await settleExitStatus() : undefined
      const wakeMs = now()
      const output = observeOutput(wakeMs)
      const heartbeat = readSiblingHeartbeat(exitRecordAbsolute, wakeMs)
      const entry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'wake',
        subject,
        label: options.label,
        recorded_at: new Date(wakeMs).toISOString(),
        cadence_seconds: cadenceSeconds,
        wake: wakes,
        watch_session_id: sessionId,
        process_alive: alive,
        process_identity_match: identityMatch,
        ...(output ? { output } : {}),
        ...(heartbeat ? { heartbeat } : {}),
        ...(terminal ? { terminal_state: terminal } : {}),
        ...(exitStatus !== undefined ? { exit_status: exitStatus } : {}),
      }

      append(entry)
      options.onWake?.(entry)

      if (terminal) {
        return finish(terminal, exitStatus ?? null)
      }
    }
  } finally {
    disposeInterruptionHandlers()
  }
}

/**
 * Renders one `pan watch --process` wake as the operator-visible lines
 * DELEGATE-001 requires: growth or silence, the tail that justifies it, and
 * the linked `bin/pan-run` heartbeat when one was read.
 */
export function formatProcessWakeLines(entry: GenericWatchRecordEntry): string {
  const header = [
    `[pan watch:${entry.label}] wake ${entry.wake} at ${entry.recorded_at}`,
  ]
  const { output, heartbeat, cadence_seconds: cadenceSeconds } = entry

  // growth_bytes is 0, not null, on a wake with a known previous size that
  // simply did not grow: only a positive delta counts as "growth" here, so a
  // silent wake falls through to the no-new-output branch instead of
  // printing "+0B" forever.
  if (output?.growth_bytes !== undefined && (output.growth_bytes ?? 0) > 0) {
    header.push(`+${output.growth_bytes}B`)
  } else if (
    output?.silent_seconds !== undefined &&
    output.silent_seconds !== null &&
    output.silent_seconds >= 2 * cadenceSeconds
  ) {
    header.push(`no new output for ${Math.floor(output.silent_seconds)}s`)
  }

  if (entry.terminal_state) {
    header.push(`-> ${entry.terminal_state}`)
  }

  const lines = [header.join(' ')]

  if (output?.tail) {
    for (const line of output.tail) {
      lines.push(`  ${line}`)
    }
  }

  if (heartbeat) {
    lines.push(
      `  (pan-run beat ${Math.floor(heartbeat.beat_age_seconds)}s ago, ` +
        `${heartbeat.elapsed_seconds ?? '?'}s elapsed)`,
    )
  }

  return lines.join('\n')
}
