import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  watchAttach,
  watchProcess,
  GENERIC_WATCH_RECORD_DIRECTORY,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  type GenericWatchRecordEntry,
} from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'

/** Read all JSONL entries from a ledger path. */
function readLedger(root: string, relative: string): GenericWatchRecordEntry[] {
  const abs = path.join(root, relative)

  return readFileSync(abs, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as GenericWatchRecordEntry)
}

test('AC-005: one-hour default timeout on DEFAULT_WATCH_TIMEOUT_SECONDS', () => {
  assert.equal(
    DEFAULT_WATCH_TIMEOUT_SECONDS,
    3600,
    'default timeout is exactly 3600 seconds (one hour)',
  )
})

test('AC-007: pan watch --attach', async (t) => {
  await t.test(
    'returns attach_completed immediately when the session is already terminal',
    async () => {
      const root = createTestTempDirectory('watch-attach-done-')
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        stdio: 'ignore',
      })
      assert.ok(child.pid)
      const childExited = once(child, 'exit')
      const exitResult = await watchProcess(root, {
        pid: child.pid,
        label: 'attach-done-fixture',
        cadenceSeconds: 0.05,
        timeoutSeconds: 30,
      })
      assert.equal(exitResult.state, 'exited')
      await childExited

      const result = await watchAttach(root, {
        ledgers: [exitResult.record_path],
        timeoutSeconds: 10,
        cadenceSeconds: 0.1,
      })
      assert.equal(result.state, 'attach_completed')
      assert.equal(result.ledgers.length, 1)
      assert.equal(result.ledgers[0]?.state, 'attach_completed')
    },
  )

  await t.test(
    'returns orphaned when the watcher PID is gone and no terminal entry',
    async () => {
      const root = createTestTempDirectory('watch-attach-orphan-')
      const logsDir = path.join(root, GENERIC_WATCH_RECORD_DIRECTORY)
      mkdirSync(logsDir, { recursive: true })

      // Write a fake ledger with a session_started using a guaranteed-dead PID.
      // PID 999999999 is virtually never alive.
      const fakePid = 999999999
      const ledgerRelative = path.posix.join(
        GENERIC_WATCH_RECORD_DIRECTORY,
        'orphan-test.jsonl',
      )
      const ledgerAbs = path.join(root, ledgerRelative)
      const sessionEntry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'session_started',
        subject: String(fakePid),
        label: 'orphan-fixture',
        recorded_at: new Date().toISOString(),
        cadence_seconds: 0.1,
        wake: 0,
        watch_session_id: 'test-session-999',
        watcher_pid: fakePid,
        timeout_seconds: 10,
      }
      writeFileSync(ledgerAbs, JSON.stringify(sessionEntry) + '\n')

      const result = await watchAttach(root, {
        ledgers: [ledgerRelative],
        timeoutSeconds: 5,
        cadenceSeconds: 0.1,
      })
      // With a dead watcher PID and no terminal entry, we get orphaned.
      assert.equal(result.state, 'orphaned')
      assert.equal(result.ledgers[0]?.state, 'orphaned')
    },
  )

  await t.test('refuses a ledger outside runtime/logs', async () => {
    const root = createTestTempDirectory('watch-attach-escape-')

    await assert.rejects(
      () =>
        watchAttach(root, {
          ledgers: ['../outside-logs.jsonl'],
          timeoutSeconds: 5,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'throws an Error')
        // Either a path-escape error from resolveInside or from our own check.
        assert.ok(err.message.length > 0, `error has a message: ${err.message}`)
        return true
      },
    )
  })

  await t.test(
    'returns attach_timed_out at the bound when session is still active',
    async () => {
      const root = createTestTempDirectory('watch-attach-timeout-')
      const logsDir = path.join(root, GENERIC_WATCH_RECORD_DIRECTORY)
      mkdirSync(logsDir, { recursive: true })

      // Write a fake ledger with session_started pointing at our own PID (we are alive).
      const ledgerRelative = path.posix.join(
        GENERIC_WATCH_RECORD_DIRECTORY,
        'timeout-test.jsonl',
      )
      const ledgerAbs = path.join(root, ledgerRelative)
      const sessionEntry: GenericWatchRecordEntry = {
        schema_version: 1,
        event: 'session_started',
        subject: String(process.pid),
        label: 'timeout-fixture',
        recorded_at: new Date().toISOString(),
        cadence_seconds: 0.1,
        wake: 0,
        watch_session_id: 'test-session-timeout',
        watcher_pid: process.pid,
        timeout_seconds: 600,
      }
      writeFileSync(ledgerAbs, JSON.stringify(sessionEntry) + '\n')

      // Use a very short timeout so the test finishes quickly.
      const result = await watchAttach(root, {
        ledgers: [ledgerRelative],
        timeoutSeconds: 0.2, // 200ms
        cadenceSeconds: 0.1,
      })

      // Our PID is alive and no terminal entry exists, so we hit the timeout.
      assert.equal(result.state, 'attach_timed_out')
      assert.equal(result.ledgers[0]?.state, 'attach_timed_out')
    },
  )

  await t.test('appends nothing to the followed ledger', async () => {
    const root = createTestTempDirectory('watch-attach-noappend-')
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    })
    assert.ok(child.pid)
    const childExited = once(child, 'exit')
    const watchResult = await watchProcess(root, {
      pid: child.pid,
      label: 'noappend-test',
      cadenceSeconds: 0.05,
      timeoutSeconds: 30,
    })
    await childExited

    const entriesBeforeAttach = readLedger(root, watchResult.record_path)

    await watchAttach(root, {
      ledgers: [watchResult.record_path],
      timeoutSeconds: 5,
      cadenceSeconds: 0.1,
    })

    const entriesAfterAttach = readLedger(root, watchResult.record_path)
    assert.equal(
      entriesAfterAttach.length,
      entriesBeforeAttach.length,
      'attach appends nothing to the followed ledger',
    )
  })
})
