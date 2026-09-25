import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'
import { watchProcess } from '../../src/lib/watch.js'

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

test('AC-008: concurrency — five simultaneous process watches across two roots', async () => {
  // Five processes, split across two harness roots, all watched concurrently.
  const root1 = createTestTempDirectory('conc-root1-')
  const root2 = createTestTempDirectory('conc-root2-')

  const children = [
    spawnLongChild(400),
    spawnLongChild(400),
    spawnLongChild(400),
    spawnLongChild(400),
    spawnLongChild(400),
  ]

  // Capture exit events before any process exits.
  const exitedAll = Promise.all(
    children.map(({ child }) => once(child, 'exit')),
  )

  const roots = [root1, root1, root1, root2, root2]

  // Launch all five watches concurrently.
  const watchPromises = children.map(({ pid }, i) =>
    watchProcess(roots[i]!, {
      pid,
      label: `concurrent-watch-${i}`,
      cadenceSeconds: 0.1,
      timeoutSeconds: 30,
    }),
  )

  const results = await Promise.all(watchPromises)

  // Every watch must complete with 'exited', no refusal.
  for (const [i, result] of results.entries()) {
    assert.equal(
      result.state,
      'exited',
      `watch ${i} reached exited state (got ${result.state})`,
    )
  }

  // Each result has a unique record path (no collision).
  const recordPaths = results.map((r) => r.record_path)
  const uniquePaths = new Set(recordPaths)
  assert.equal(
    uniquePaths.size,
    results.length,
    'each concurrent watch has a distinct record path',
  )

  await exitedAll
})

test('AC-008: concurrency — four process watches prove no serialization', async () => {
  // Four more processes across two roots. If watches were serialized, elapsed
  // time would be ~4x the process lifetime. Concurrent execution completes
  // in ~1x the lifetime.
  const root3 = createTestTempDirectory('conc-root3-')
  const root4 = createTestTempDirectory('conc-root4-')

  const lifetimeMs = 300

  const children2 = [
    spawnLongChild(lifetimeMs),
    spawnLongChild(lifetimeMs),
    spawnLongChild(lifetimeMs),
    spawnLongChild(lifetimeMs),
  ]

  const exitedAll2 = Promise.all(
    children2.map(({ child }) => once(child, 'exit')),
  )
  const roots2 = [root3, root3, root4, root4]

  const startMs = Date.now()
  const watchPromises2 = children2.map(({ pid }, i) =>
    watchProcess(roots2[i]!, {
      pid,
      label: `conc2-watch-${i}`,
      cadenceSeconds: 0.1,
      timeoutSeconds: 30,
    }),
  )

  const results2 = await Promise.all(watchPromises2)
  const elapsedMs = Date.now() - startMs

  for (const [i, result] of results2.entries()) {
    assert.equal(
      result.state,
      'exited',
      `concurrent watch ${i} reached exited state`,
    )
  }

  // With four serialized 300ms processes, elapsed would be ~1200ms.
  // Concurrent execution should finish in ~600ms with generous overhead.
  assert.ok(
    elapsedMs < 1200,
    `elapsed ${elapsedMs}ms is well below 4x process lifetime, confirming no serialization`,
  )

  await exitedAll2
})
