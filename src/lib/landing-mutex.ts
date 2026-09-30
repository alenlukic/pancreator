/**
 * Landing mutex: serializes every release landing on `pan-dev` behind one
 * crash-safe lock at `runtime/release/landing.lock`.
 *
 * The lock file holds JSON `{ schema_version, token, pid, process_identity,
 * worktree, command, run_id, started_at, host }` published atomically by
 * hard-linking a fully written candidate file — the same pattern
 * `withOperationMutex` in `src/lib/io.ts` uses.
 *
 * A stale lock is detected when its pid is not running or when
 * `processStartIdentity` no longer matches. Stale locks are renamed to
 * `runtime/release/stale-locks/landing.lock.stale-<iso>` before the next
 * caller acquires. They live apart from the durable ledgers beside the lock so
 * the retention class that ages them out can never reach those ledgers.
 *
 * `release()` removes the lock only when its token matches.
 *
 * The landing is synchronous, so a signal handler could not run before it
 * ends. The mutex installs none: a signal ends the holder at once, and the
 * next caller reclaims the lock because its pid is no longer running.
 *
 * Every acquire, wait report, reclaim, release, and timeout appends one
 * line to `runtime/release/landing.jsonl`.
 */
import { createHash, randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PanError, errorMessage } from './errors.js'
import {
  appendJsonLine,
  isRecord,
  processIsAlive,
  readJson,
  resolveInside,
  withOperationMutex,
} from './io.js'
import { processStartIdentity } from './watch/process-evidence.js'

const LOCK_PATH = path.join('runtime', 'release', 'landing.lock')
const LOG_PATH = path.join('runtime', 'release', 'landing.jsonl')
const RECLAIM_MUTEX_PATH = path.join('runtime', 'release', 'landing.reclaim')
export const STALE_LOCK_DIRECTORY = path.join(
  'runtime',
  'release',
  'stale-locks',
)
const DEFAULT_WAIT_SECONDS = 7200
const DEFAULT_REPORT_EVERY_SECONDS = 60
const POLL_INTERVAL_MS = 1_000

export interface LandingLockRecord {
  schema_version: 1
  token: string
  pid: number
  process_identity: string | null
  worktree: string
  command: string
  run_id: string | null
  started_at: string
  host: string
}

export interface LandingMutexHolder {
  readonly token: string
  readonly lockPath: string
  readonly logPath: string
  release(): void
}

export interface AcquireLandingMutexOptions {
  /** Total seconds to wait before giving up. Defaults to 7200. */
  waitSeconds?: number
  /** Minimum seconds between stderr wait-progress reports. Defaults to 60. */
  reportEverySeconds?: number
  /** Called with each wait report, at most once per `reportEverySeconds`. */
  onWait?: (holder: LandingLockRecord, elapsedSeconds: number) => void
}

function lockPath(root: string): string {
  return resolveInside(root, LOCK_PATH)
}

function logPath(root: string): string {
  return resolveInside(root, LOG_PATH)
}

function ensureDirs(root: string): void {
  mkdirSync(path.dirname(lockPath(root)), { recursive: true })
}

function appendEvent(root: string, event: Record<string, unknown>): void {
  appendJsonLine(logPath(root), {
    timestamp: new Date().toISOString(),
    ...event,
  })
}

function readLockRecord(lockFilePath: string): LandingLockRecord | null {
  try {
    const value = readJson(lockFilePath)

    if (
      !isRecord(value) ||
      typeof value.token !== 'string' ||
      typeof value.pid !== 'number' ||
      typeof value.worktree !== 'string'
    ) {
      return null
    }

    return value as unknown as LandingLockRecord
  } catch {
    return null
  }
}

function isLockStale(record: LandingLockRecord): boolean {
  if (!processIsAlive(record.pid)) {
    return true
  }

  const identity = processStartIdentity(record.pid)

  if (identity === null || record.process_identity === null) {
    // Cannot compare identities; treat as live to avoid false reclaim.
    return false
  }

  return identity !== record.process_identity
}

/**
 * Move a stale lock aside. Reclaimers serialize on a short operation mutex and
 * rename only while the lock still carries the stale token, so a second
 * reclaimer that read the same stale record cannot move the first
 * reclaimer's fresh lock and hold the mutex beside it.
 */
function reclaimStaleLock(
  root: string,
  lockFilePath: string,
  record: LandingLockRecord,
): void {
  const staleDirectory = resolveInside(root, STALE_LOCK_DIRECTORY)
  const isoSafe = new Date().toISOString().replace(/:/gu, '-')
  const stalePath = path.join(
    staleDirectory,
    `landing.lock.stale-${isoSafe}-${record.token.slice(0, 8)}`,
  )

  try {
    withOperationMutex(
      resolveInside(root, RECLAIM_MUTEX_PATH),
      () => {
        if (readLockRecord(lockFilePath)?.token !== record.token) {
          return
        }

        mkdirSync(staleDirectory, { recursive: true })
        renameSync(lockFilePath, stalePath)
        appendEvent(root, {
          event: 'reclaimed',
          dead_holder: {
            pid: record.pid,
            worktree: record.worktree,
            command: record.command,
            started_at: record.started_at,
            token: record.token,
          },
          stale_path: stalePath,
        })
      },
      { waitForHolderMs: 5_000 },
    )
  } catch {
    // Another reclaimer holds the reclaim mutex or the lock already moved;
    // the wait loop re-reads the lock and decides again.
  }
}

/**
 * Acquire the landing mutex for a landing operation.
 *
 * Polls until the lock is free (or reclaimed from a dead holder), then writes
 * a lock file with the caller's identity. The returned handle's `release()`
 * removes the lock only when its token matches (so a late reclaim cannot
 * accidentally release a new holder's lock).
 *
 * @param root  - Harness root.
 * @param holder - Identity fields for the lock record.
 * @param options - Wait configuration.
 */
export function acquireLandingMutex(
  root: string,
  holder: { worktree: string; command: string; runId?: string | null },
  options: AcquireLandingMutexOptions = {},
): LandingMutexHolder {
  ensureDirs(root)

  const waitSeconds = options.waitSeconds ?? DEFAULT_WAIT_SECONDS
  const reportEverySeconds =
    options.reportEverySeconds ?? DEFAULT_REPORT_EVERY_SECONDS
  const deadline = Date.now() + waitSeconds * 1_000

  const token = randomUUID()
  const startedAt = new Date().toISOString()
  const record: LandingLockRecord = {
    schema_version: 1,
    token,
    pid: process.pid,
    process_identity: processStartIdentity(process.pid),
    worktree: holder.worktree,
    command: holder.command,
    run_id: holder.runId ?? null,
    started_at: startedAt,
    host: os.hostname(),
  }

  const lp = lockPath(root)
  const candidatePath = `${lp}.${process.pid}.${createHash('sha256').update(token).digest('hex').slice(0, 12)}.candidate`

  // Write the candidate file fully before hard-linking it.
  writeFileSync(candidatePath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })

  let acquired = false
  let lastReportAt = Date.now()

  const tryAcquire = (): boolean => {
    try {
      linkSync(candidatePath, lp)
      return true
    } catch {
      return false
    }
  }

  // Attempt immediate acquisition.
  acquired = tryAcquire()

  // Wait loop.
  while (!acquired) {
    const existing = readLockRecord(lp)

    if (existing === null) {
      // The lock vanished between the link attempt and the read, or it holds
      // no readable record. Retry, and keep the deadline for the second case.
      acquired = tryAcquire()

      if (!acquired && Date.now() >= deadline) {
        rmSync(candidatePath, { force: true })
        appendEvent(root, {
          event: 'timeout',
          waited_seconds: waitSeconds,
          holder: null,
        })
        throw new PanError(
          `Landing mutex timed out after ${waitSeconds} seconds. The lock at ` +
            `${lp} holds no readable holder record.`,
          { code: 'LANDING_MUTEX_TIMEOUT', details: { holder: null } },
        )
      }

      if (!acquired) {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          POLL_INTERVAL_MS,
        )
      }

      continue
    }

    if (isLockStale(existing)) {
      reclaimStaleLock(root, lp, existing)
      acquired = tryAcquire()

      if (acquired) {
        continue
      }
    }

    if (Date.now() >= deadline) {
      rmSync(candidatePath, { force: true })
      appendEvent(root, {
        event: 'timeout',
        waited_seconds: waitSeconds,
        holder: {
          pid: existing.pid,
          worktree: existing.worktree,
          command: existing.command,
          started_at: existing.started_at,
          token: existing.token,
        },
      })
      throw new PanError(
        `Landing mutex timed out after ${waitSeconds} seconds. ` +
          `Holder pid ${existing.pid} worktree '${existing.worktree}' ` +
          `command '${existing.command}' started at ${existing.started_at}.`,
        {
          code: 'LANDING_MUTEX_TIMEOUT',
          details: {
            holder: {
              pid: existing.pid,
              worktree: existing.worktree,
              command: existing.command,
              started_at: existing.started_at,
            },
          },
        },
      )
    }

    const elapsedSeconds = (Date.now() - Date.parse(startedAt)) / 1_000
    const now = Date.now()

    if (now - lastReportAt >= reportEverySeconds * 1_000) {
      lastReportAt = now
      const msg =
        `pan release land: waiting for landing mutex held by ` +
        `pid ${existing.pid} worktree '${existing.worktree}' ` +
        `command '${existing.command}' started ${existing.started_at} ` +
        `(${Math.round(elapsedSeconds)}s elapsed)`

      process.stderr.write(`${msg}\n`)
      appendEvent(root, {
        event: 'wait_report',
        holder_pid: existing.pid,
        holder_worktree: existing.worktree,
        holder_command: existing.command,
        holder_started_at: existing.started_at,
        elapsed_seconds: Math.round(elapsedSeconds),
      })

      options.onWait?.(existing, elapsedSeconds)
    }

    // Sleep 1 second before next poll.
    const sleepSignal = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(sleepSignal, 0, 0, POLL_INTERVAL_MS)

    // Try after waiting.
    acquired = tryAcquire()
  }

  rmSync(candidatePath, { force: true })

  appendEvent(root, {
    event: 'acquired',
    token,
    pid: process.pid,
    worktree: holder.worktree,
    command: holder.command,
    run_id: holder.runId ?? null,
  })

  let released = false

  const doRelease = (): void => {
    if (released) {
      return
    }

    released = true

    try {
      const current = readLockRecord(lp)

      if (current?.token === token) {
        rmSync(lp, { force: true })
        appendEvent(root, { event: 'released', token })
      }
    } catch (error) {
      appendEvent(root, {
        event: 'release_error',
        token,
        error: errorMessage(error),
      })
    }
  }

  return {
    token,
    lockPath: lp,
    logPath: logPath(root),
    release: doRelease,
  }
}
