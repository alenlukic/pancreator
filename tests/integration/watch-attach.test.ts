import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { PanError } from '../../src/lib/errors.js'
import {
  acquireWatchLock,
  watchAttach,
  watchLockPath,
  watchProcess,
  watchRecordPath,
  GENERIC_WATCH_RECORD_DIRECTORY,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  WATCH_ATTACH_NO_SESSION,
  WATCH_TARGET_BUSY,
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
        assert.ok(err instanceof PanError, 'throws a PanError')
        assert.equal(err.code, 'PATH_ESCAPE')
        return true
      },
    )
  })

  await t.test(
    'refuses a missing ledger and a ledger with no session_started entry',
    async () => {
      const root = createTestTempDirectory('watch-attach-nosession-')
      mkdirSync(path.join(root, GENERIC_WATCH_RECORD_DIRECTORY), {
        recursive: true,
      })
      const empty = path.posix.join(
        GENERIC_WATCH_RECORD_DIRECTORY,
        'empty.jsonl',
      )
      writeFileSync(
        path.join(root, empty),
        JSON.stringify({ schema_version: 1, event: 'armed', wake: 0 }) + '\n',
      )

      for (const ledger of [
        empty,
        path.posix.join(GENERIC_WATCH_RECORD_DIRECTORY, 'absent.jsonl'),
      ]) {
        await assert.rejects(
          () => watchAttach(root, { ledgers: [ledger], timeoutSeconds: 5 }),
          (err: unknown) =>
            err instanceof PanError && err.code === WATCH_ATTACH_NO_SESSION,
        )
      }
    },
  )

  await t.test(
    "exits with the followed verdict's code and the highest code across sessions",
    async () => {
      const root = createTestTempDirectory('watch-attach-verdict-')
      mkdirSync(path.join(root, GENERIC_WATCH_RECORD_DIRECTORY), {
        recursive: true,
      })
      const ledgerFor = (name: string, terminal: string): string => {
        const relative = path.posix.join(
          GENERIC_WATCH_RECORD_DIRECTORY,
          `${name}.jsonl`,
        )
        const lines = [
          { schema_version: 1, event: 'session_started', wake: 0 },
          {
            schema_version: 1,
            event: 'wake',
            wake: 1,
            terminal_state: terminal,
          },
        ]
        writeFileSync(
          path.join(root, relative),
          lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
        )
        return relative
      }
      const exited = ledgerFor('exited', 'exited')
      const timedOut = ledgerFor('timed-out', 'timed_out')
      const interrupted = ledgerFor('interrupted', 'interrupted')

      for (const [ledgers, expected] of [
        [[exited], 0],
        [[timedOut], 3],
        [[interrupted], 130],
        [[exited, timedOut], 3],
      ] as const) {
        const result = await watchAttach(root, {
          ledgers: [...ledgers],
          timeoutSeconds: 5,
          cadenceSeconds: 0.1,
        })
        assert.equal(result.state, 'attach_completed')
        assert.equal(result.exit_code, expected, ledgers.join(','))
      }
    },
  )

  await t.test(
    'follows a live process watch and returns after its terminal wake',
    async () => {
      const root = createTestTempDirectory('watch-attach-live-')
      const child = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 600)'],
        {
          stdio: 'ignore',
        },
      )
      assert.ok(child.pid)
      const recordPath = path.posix.join(
        GENERIC_WATCH_RECORD_DIRECTORY,
        'live.jsonl',
      )
      const owner = watchProcess(root, {
        pid: child.pid,
        label: 'attach-live-fixture',
        recordPath,
        cadenceSeconds: 0.05,
        timeoutSeconds: 30,
      })

      while (!existsSync(path.join(root, recordPath))) {
        await delay(10)
      }

      const attached = await watchAttach(root, {
        ledgers: [recordPath],
        timeoutSeconds: 30,
        cadenceSeconds: 0.05,
      })
      const ownerResult = await owner
      const terminalWake = readLedger(root, recordPath).find(
        (entry) => entry.terminal_state !== undefined,
      )

      assert.equal(ownerResult.state, 'exited')
      assert.equal(attached.state, 'attach_completed')
      assert.equal(attached.ledgers[0]?.session_terminal_state, 'exited')
      assert.equal(attached.exit_code, 0)
      assert.ok(terminalWake, 'owner recorded a terminal wake')
      assert.ok(
        Date.parse(attached.started_at) < Date.parse(terminalWake.recorded_at),
        'the attach armed before the owner reached its verdict',
      )
      assert.ok(
        Date.parse(attached.ended_at) >= Date.parse(terminalWake.recorded_at),
        'the attach returned only after the terminal wake',
      )
    },
  )

  await t.test(
    'WATCH_TARGET_BUSY names the exact --attach command and ledger',
    () => {
      const root = createTestTempDirectory('watch-attach-busy-')
      const runId = 'run-busy'
      const invocationId = '01_implement-1_busy'
      mkdirSync(
        path.dirname(path.join(root, watchLockPath(root, runId, invocationId))),
        { recursive: true },
      )
      const held = acquireWatchLock(root, runId, invocationId, 'session-one')

      try {
        assert.throws(
          () => acquireWatchLock(root, runId, invocationId, 'session-two'),
          (err: unknown) => {
            assert.ok(err instanceof PanError)
            assert.equal(err.code, WATCH_TARGET_BUSY)
            assert.ok(
              err.message.includes(
                `./bin/pan watch --attach ${watchRecordPath(root, runId, invocationId)}`,
              ),
              err.message,
            )
            return true
          },
        )
      } finally {
        held.release()
      }
    },
  )

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
