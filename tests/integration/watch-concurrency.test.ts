import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { Invocation } from '../../src/lib/types.js'
import {
  readWatchRecord,
  watchInvocation,
  watchProcess,
} from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'
import { CADENCE_SECONDS, multiplexedTargets } from './watch-helpers.js'

/** A ledger's own session interval: session start and terminal wake times. */
interface SessionInterval {
  started: number
  ended: number
}

/**
 * Assert that every pair of sessions overlapped: each session started before
 * every other session reached its verdict. Serialized watches cannot satisfy
 * this, whatever the host scheduling, because one would start only after
 * another ended.
 */
function assertPairwiseOverlap(intervals: SessionInterval[]): void {
  for (const [i, own] of intervals.entries()) {
    for (const [j, other] of intervals.entries()) {
      if (i !== j) {
        assert.ok(
          own.started < other.ended,
          `session ${i} started before session ${j} reached its verdict`,
        )
      }
    }
  }
}

function genericInterval(root: string, recordPath: string): SessionInterval {
  const entries = readFileSync(path.join(root, recordPath), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const started = entries.find((entry) => entry.event === 'session_started')
  const ended = entries.find(
    (entry) =>
      entry.event === 'wake' && typeof entry.terminal_state === 'string',
  )

  assert.ok(started && ended, `${recordPath} records a session and a verdict`)

  return {
    started: Date.parse(String(started.recorded_at)),
    ended: Date.parse(String(ended.recorded_at)),
  }
}

/**
 * Spawn a child process that lives for approximately `lifetimeMs` milliseconds.
 */
function spawnLongChild(lifetimeMs: number): {
  pid: number
  child: ReturnType<typeof spawn>
} {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const t = setInterval(() => {}, 50); setTimeout(() => { clearInterval(t); process.exit(0); }, ${lifetimeMs})`,
    ],
    { stdio: 'ignore' },
  )

  assert.ok(child.pid, 'child process spawned')
  return { pid: child.pid, child }
}

test('AC-008: five simultaneous process watches across two roots overlap', async () => {
  const root1 = createTestTempDirectory('conc-root1-')
  const root2 = createTestTempDirectory('conc-root2-')
  const children = Array.from({ length: 5 }, () => spawnLongChild(400))
  const exitedAll = Promise.all(
    children.map(({ child }) => once(child, 'exit')),
  )
  const roots = [root1, root1, root1, root2, root2]

  const results = await Promise.all(
    children.map(({ pid }, i) =>
      watchProcess(roots[i]!, {
        pid,
        label: `concurrent-watch-${i}`,
        cadenceSeconds: 0.1,
        timeoutSeconds: 30,
      }),
    ),
  )

  for (const [i, result] of results.entries()) {
    assert.equal(result.state, 'exited', `watch ${i} reached exited`)
  }

  assert.equal(
    new Set(results.map((result) => `${result.record_path}`)).size,
    results.length,
    'each concurrent watch has a distinct record path',
  )
  assertPairwiseOverlap(
    results.map((result, i) => genericInterval(roots[i]!, result.record_path)),
  )

  await exitedAll
})

test('AC-008: four focused watches on distinct invocations of two runs arm and reach verdicts at once', async () => {
  const { root, targets } = multiplexedTargets(2)
  const watched = targets.flatMap((target) => {
    const sibling = `${target.invocationId}-b`
    const original = JSON.parse(
      readFileSync(
        target.layout.invocation(target.invocationId, '.json').absolute,
        'utf8',
      ),
    ) as Invocation

    writeFileSync(
      target.layout.invocation(sibling, '.json').absolute,
      `${JSON.stringify({
        ...original,
        invocation_id: sibling,
        output: {
          ...original.output,
          path: target.layout.output(sibling).relative,
        },
      })}\n`,
      'utf8',
    )

    return [
      { runId: target.runId, invocationId: target.invocationId },
      { runId: target.runId, invocationId: sibling },
    ]
  })

  assert.equal(new Set(watched.map((item) => item.runId)).size, 2)

  // No output ever lands, so each watch runs to its own short bound. A
  // WATCH_TARGET_BUSY refusal would reject its promise and fail the test.
  const results = await Promise.all(
    watched.map(({ runId, invocationId }) =>
      watchInvocation(root, runId, {
        invocationId,
        cadenceSeconds: CADENCE_SECONDS,
        stallWakes: 100,
        timeoutSeconds: 1,
      }),
    ),
  )

  for (const [i, result] of results.entries()) {
    assert.equal(result.invocation_id, watched[i]!.invocationId)
    assert.equal(result.state, 'timed_out', `focused watch ${i} verdict`)
  }

  assertPairwiseOverlap(
    watched.map(({ runId, invocationId }) => {
      const entries = readWatchRecord(root, runId, invocationId)
      const started = entries.find((entry) => entry.event === 'session_started')
      const ended = entries.find(
        (entry) => entry.event === 'wake' && entry.terminal_state !== undefined,
      )

      assert.ok(
        started && ended,
        `${invocationId} records a session and a verdict`,
      )

      return {
        started: Date.parse(started.recorded_at),
        ended: Date.parse(ended.recorded_at),
      }
    }),
  )
})
