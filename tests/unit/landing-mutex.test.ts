import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  acquireLandingMutex,
  type LandingLockRecord,
} from '../../src/lib/landing-mutex.js'
import { createTestTempDirectory } from '../temp.js'

function makeRoot(): string {
  const root = createTestTempDirectory('landing-mutex-')

  mkdirSync(path.join(root, 'runtime', 'release'), { recursive: true })

  return root
}

function lockPath(root: string): string {
  return path.join(root, 'runtime', 'release', 'landing.lock')
}

function logPath(root: string): string {
  return path.join(root, 'runtime', 'release', 'landing.jsonl')
}

function readLog(root: string): Array<Record<string, unknown>> {
  const lp = logPath(root)

  if (!existsSync(lp)) {
    return []
  }

  return readFileSync(lp, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('acquire and release removes the lock and appends log events', () => {
  const root = makeRoot()
  const handle = acquireLandingMutex(
    root,
    { worktree: 'my-worktree', command: 'pan release land' },
    { waitSeconds: 5 },
  )

  assert.ok(existsSync(lockPath(root)), 'lock file exists after acquire')

  const record = JSON.parse(
    readFileSync(lockPath(root), 'utf8'),
  ) as LandingLockRecord

  assert.equal(record.schema_version, 1)
  assert.equal(record.worktree, 'my-worktree')
  assert.equal(record.command, 'pan release land')
  assert.equal(record.pid, process.pid)
  assert.ok(typeof record.token === 'string' && record.token.length > 0)

  handle.release()

  assert.ok(!existsSync(lockPath(root)), 'lock file removed after release')

  const events = readLog(root)
  const acquired = events.find((e) => e.event === 'acquired')
  const released = events.find((e) => e.event === 'released')

  assert.ok(acquired, 'acquired event logged')
  assert.equal(acquired.token, record.token)
  assert.ok(released, 'released event logged')
  assert.equal(released.token, record.token)
})

test('release is idempotent: calling it twice does not throw', () => {
  const root = makeRoot()
  const handle = acquireLandingMutex(
    root,
    { worktree: 'idempotent-test', command: 'pan release land' },
    { waitSeconds: 5 },
  )

  handle.release()
  // Second release should not throw.
  assert.doesNotThrow(() => handle.release())
})

test('release does not remove the lock when the token does not match', () => {
  const root = makeRoot()
  const handle = acquireLandingMutex(
    root,
    { worktree: 'token-guard', command: 'pan release land' },
    { waitSeconds: 5 },
  )

  // Overwrite the lock with a different token to simulate a foreign holder.
  const impostor: LandingLockRecord = {
    schema_version: 1,
    token: 'impostor-token',
    pid: process.pid,
    process_identity: null,
    worktree: 'foreign-worktree',
    command: 'pan release land',
    run_id: null,
    started_at: new Date().toISOString(),
    host: 'other-host',
  }

  writeFileSync(lockPath(root), `${JSON.stringify(impostor, null, 2)}\n`)

  // Releasing our handle should NOT remove the impostor's lock.
  handle.release()

  assert.ok(
    existsSync(lockPath(root)),
    'lock file still exists: token mismatch prevented removal',
  )
})

test('stale reclaim: dead pid causes rename and re-acquire', () => {
  const root = makeRoot()

  // pid=0 is never a valid user process; processIsAlive(0) returns false.
  const staleLock: LandingLockRecord = {
    schema_version: 1,
    token: 'stale-token',
    pid: 0,
    process_identity: 'some-identity',
    worktree: 'stale-worktree',
    command: 'pan release land',
    run_id: null,
    started_at: new Date().toISOString(),
    host: 'stale-host',
  }

  writeFileSync(lockPath(root), `${JSON.stringify(staleLock, null, 2)}\n`)

  const handle = acquireLandingMutex(
    root,
    { worktree: 'reclaimer', command: 'pan release land' },
    { waitSeconds: 5 },
  )

  assert.ok(existsSync(lockPath(root)), 'new lock acquired after stale reclaim')

  const newRecord = JSON.parse(
    readFileSync(lockPath(root), 'utf8'),
  ) as LandingLockRecord

  assert.equal(newRecord.worktree, 'reclaimer', 'new holder is the reclaimer')

  const events = readLog(root)
  const reclaimed = events.find((e) => e.event === 'reclaimed')

  assert.ok(reclaimed, 'reclaimed event logged')
  assert.ok(
    typeof reclaimed.stale_path === 'string' &&
      reclaimed.stale_path.includes(
        path.join('runtime', 'release', 'stale-locks', 'landing.lock.stale-'),
      ),
    'stale path recorded under stale-locks',
  )
  assert.ok(existsSync(reclaimed.stale_path), 'stale lock moved aside')

  handle.release()
})

test('stale reclaim: a live pid whose process identity changed is reclaimed', () => {
  const root = makeRoot()

  // The pid is running (this process) but its recorded start identity is not
  // this process's, so the recorded holder is a dead process whose pid was
  // reused.
  const reusedPid: LandingLockRecord = {
    schema_version: 1,
    token: 'reused-pid-token',
    pid: process.pid,
    process_identity: 'identity-of-a-process-that-exited',
    worktree: 'reused-pid-holder',
    command: 'pan release land',
    run_id: null,
    started_at: new Date().toISOString(),
    host: 'host',
  }

  writeFileSync(lockPath(root), `${JSON.stringify(reusedPid, null, 2)}\n`)

  const handle = acquireLandingMutex(
    root,
    { worktree: 'reclaimer', command: 'pan release land' },
    { waitSeconds: 5 },
  )
  const holder = JSON.parse(
    readFileSync(lockPath(root), 'utf8'),
  ) as LandingLockRecord
  const reclaimed = readLog(root).find((e) => e.event === 'reclaimed')

  assert.equal(holder.worktree, 'reclaimer')
  assert.equal(
    (reclaimed?.dead_holder as { token?: string } | undefined)?.token,
    'reused-pid-token',
  )

  handle.release()
})

test('a live pid whose recorded process identity is null is not reclaimed', () => {
  const root = makeRoot()
  const unconfirmable: LandingLockRecord = {
    schema_version: 1,
    token: 'unconfirmable-token',
    pid: process.pid,
    process_identity: null,
    worktree: 'unconfirmable-holder',
    command: 'pan release land',
    run_id: null,
    started_at: new Date().toISOString(),
    host: 'host',
  }

  writeFileSync(lockPath(root), `${JSON.stringify(unconfirmable, null, 2)}\n`)

  assert.throws(
    () =>
      acquireLandingMutex(
        root,
        { worktree: 'reclaimer', command: 'pan release land' },
        { waitSeconds: 0 },
      ),
    (error: unknown) =>
      (error as { code?: string }).code === 'LANDING_MUTEX_TIMEOUT',
  )
  assert.equal(
    readLog(root).some((e) => e.event === 'reclaimed'),
    false,
  )
})

test('timeout error carries LANDING_MUTEX_TIMEOUT and the holder fields, and logs a timeout event', () => {
  const root = makeRoot()

  // Hold the lock via acquireLandingMutex so the real process identity is
  // stored. The second acquire will see the lock as live (same pid + identity)
  // and wait until the zero-second timeout fires.
  const live = acquireLandingMutex(
    root,
    { worktree: 'live-holder', command: 'pan release land' },
    { waitSeconds: 30 },
  )
  const holder = JSON.parse(
    readFileSync(lockPath(root), 'utf8'),
  ) as LandingLockRecord

  assert.throws(
    () =>
      acquireLandingMutex(
        root,
        { worktree: 'waiter', command: 'pan release land' },
        { waitSeconds: 0 },
      ),
    (error: unknown) => {
      const failure = error as {
        code?: string
        details?: { holder?: Record<string, unknown> }
      }

      assert.equal(failure.code, 'LANDING_MUTEX_TIMEOUT')
      assert.deepEqual(failure.details?.holder, {
        pid: process.pid,
        worktree: 'live-holder',
        command: 'pan release land',
        started_at: holder.started_at,
      })
      return true
    },
  )

  const timeout = readLog(root).find((e) => e.event === 'timeout')

  assert.equal(
    (timeout?.holder as { worktree?: string } | undefined)?.worktree,
    'live-holder',
  )

  live.release()
})

test('a waiter reports the holder on the configured cadence before it times out', () => {
  const root = makeRoot()
  const live = acquireLandingMutex(
    root,
    { worktree: 'cadence-holder', command: 'pan release land' },
    { waitSeconds: 30 },
  )
  const waits: Array<{ worktree: string; elapsed: number }> = []
  const stderr: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)

  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write

  try {
    assert.throws(
      () =>
        acquireLandingMutex(
          root,
          { worktree: 'cadence-waiter', command: 'pan release land' },
          {
            waitSeconds: 2,
            reportEverySeconds: 1,
            onWait: (holder, elapsedSeconds) => {
              waits.push({ worktree: holder.worktree, elapsed: elapsedSeconds })
            },
          },
        ),
      (error: unknown) =>
        (error as { code?: string }).code === 'LANDING_MUTEX_TIMEOUT',
    )
  } finally {
    process.stderr.write = originalWrite
    live.release()
  }

  const reports = readLog(root).filter((e) => e.event === 'wait_report')

  assert.ok(reports.length >= 1, 'at least one wait_report event')
  assert.equal(reports[0]?.holder_pid, process.pid)
  assert.equal(reports[0]?.holder_worktree, 'cadence-holder')
  assert.equal(reports[0]?.holder_command, 'pan release land')
  assert.equal(typeof reports[0]?.holder_started_at, 'string')
  assert.equal(typeof reports[0]?.elapsed_seconds, 'number')
  assert.equal(waits.length, reports.length)
  assert.equal(waits[0]?.worktree, 'cadence-holder')

  const report = stderr.find((line) => line.includes('waiting for landing'))

  assert.ok(report, 'a stderr wait report was written')
  assert.match(report, new RegExp(`pid ${process.pid}`, 'u'))
  assert.match(report, /cadence-holder/u)
  assert.match(report, /s elapsed/u)
})
