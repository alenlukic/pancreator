import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  MAX_CAPTURE_BYTES,
  runRepositoryCheck,
  runRepositoryCheckStreaming,
} from '../../src/lib/repository-checks.js'
import { makeInstallation, writeChecks } from './repository-checks-helpers.js'

/**
 * A profile command that backgrounds a grandchild ticking `file` until it is
 * killed. The `& wait` shape puts the ticker outside the shell the runner
 * spawns, so only a process-group kill reaches it.
 *
 * The ticker is a shell loop rather than a Node process: these tests time the
 * kill out after a few hundred milliseconds, and a Node interpreter under
 * suite load can take longer than that to reach its first tick, which left
 * the caller asserting against a heartbeat that had never started. The loop
 * writes its first tick within milliseconds and stops itself after 30 s, so a
 * kill that fails to land still cannot outlive the suite.
 */
function heartbeatCommand(file: string): string {
  return (
    `sh -c 'n=0; while [ $n -lt 1500 ]; do printf x >> "${file}"; ` +
    `n=$((n+1)); sleep 0.02; done' & wait`
  )
}

/** Ticks the heartbeat grandchild has written so far. */
function heartbeatCount(file: string): number {
  return existsSync(file) ? readFileSync(file, 'utf8').length : 0
}

test('streaming repository checks emit subprocess output before returning the result', async () => {
  const { root } = makeInstallation()
  const stdout: string[] = []
  const starts: string[] = []

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: [],
      commands: [
        "node -e \"process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 25)\"",
      ],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'fast', {
    on_start: (kind, command) => starts.push(`${kind}:${command}`),
    on_stdout: (chunk) => stdout.push(chunk),
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.timeout_ms, 5_000)
  assert.equal(starts.length, 1)
  assert.equal(starts[0]?.startsWith('command:'), true)
  assert.match(stdout.join(''), /first\nsecond/u)
})

test('a streaming timeout ends the whole process tree, not only the shell', async () => {
  // `npm test` fans out into run-built, run-tests, and node. Killing the
  // shell alone left that tree running and holding the pipes, so the gate
  // returned only when the suite finished on its own, 130 s late in the field.
  const { root } = makeInstallation()
  const heartbeat = path.join(root, 'streaming-timeout-heartbeat.txt')

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [heartbeatCommand(heartbeat)],
    },
  })

  // The profile floor is 1 s; the stage-requested bound has no floor, and the
  // contract is the kill, not the wait.
  const result = await runRepositoryCheckStreaming(root, 'fast', {
    timeout_ms: 250,
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)

  const ticks = heartbeatCount(heartbeat)

  assert.ok(ticks > 0, 'the heartbeat grandchild never started')
  await delay(500)
  assert.equal(heartbeatCount(heartbeat), ticks)
})

test('a concurrent profile runs its commands together and records each one', async () => {
  // The heaviest profile's commands are independent, so running them one
  // after another charges the operator the sum of their durations. Each must
  // still keep its own exit code and captured output, in declared order.
  const { root } = makeInstallation()
  const delayMs = 900
  const stdout: string[] = []

  // TP-10: each command brackets its own delay in a shared log. An elapsed
  // ceiling would measure the scheduling of a suite that runs its own tests
  // concurrently; the recorded order measures these three commands.
  const bracketLog = path.join(root, 'brackets.txt')
  const bracketed = (body: string) =>
    `node -e "const fs=require('fs');const log='${bracketLog}';` +
    `fs.appendFileSync(log,'start\\n');` +
    `setTimeout(() => { ${body}; fs.appendFileSync(log,'end\\n') }, ${delayMs})"`

  writeChecks(root, {
    full: {
      timeout_ms: 20_000,
      concurrent: true,
      probes: [],
      commands: [
        bracketed("process.stdout.write('alpha\\n')"),
        bracketed("process.stderr.write('beta\\n'); process.exitCode = 2"),
        bracketed("process.stdout.write('gamma\\n')"),
      ],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'full', {
    on_stdout: (chunk) => stdout.push(chunk),
  })
  const brackets = readFileSync(bracketLog, 'utf8').split('\n').filter(Boolean)

  // One command failed, so the profile failed, but every command ran.
  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.results.map((item) => item.passed),
    [true, false, true],
  )
  assert.match(result.results[0]?.stdout ?? '', /alpha/u)
  assert.equal(result.results[1]?.exit_code, 2)
  assert.match(result.results[1]?.stderr ?? '', /beta/u)
  assert.match(result.results[2]?.stdout ?? '', /gamma/u)
  assert.match(stdout.join(''), /alpha/u)

  // Every command started before the first one finished.
  assert.deepEqual(
    brackets.slice(0, 3),
    ['start', 'start', 'start'],
    brackets.join(','),
  )
  assert.equal(brackets.length, 6)
})

test('a concurrent profile ends every unfinished command at the shared deadline', async () => {
  // A shared deadline is the whole budget, not a budget per command. Without
  // the group kill the runner returns while orphans keep running.
  const { root } = makeInstallation()
  // Each slow command backgrounds a grandchild that ticks a heartbeat file.
  // A returning runner is not proof the tree died: only a heartbeat that
  // stops ticking distinguishes a killed process group from an orphan the
  // runner merely stopped waiting for.
  const firstBeat = path.join(root, 'runtime', 'beat-1.txt')
  const secondBeat = path.join(root, 'runtime', 'beat-2.txt')
  const heartbeats = [firstBeat, secondBeat]

  writeChecks(root, {
    full: {
      concurrent: true,
      probes: [],
      commands: [
        'echo quick',
        heartbeatCommand(firstBeat),
        heartbeatCommand(secondBeat),
      ],
    },
  })

  const startedAt = Date.now()
  const result = await runRepositoryCheckStreaming(root, 'full', {
    timeout_ms: 400,
  })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.equal(result.results[2]?.timed_out, true)
  assert.ok(
    elapsed < 10_000,
    `the profile returned after ${elapsed}ms; an orphan kept it waiting`,
  )

  const ticks = heartbeats.map(heartbeatCount)

  await delay(500)

  for (const [index, file] of heartbeats.entries()) {
    const before = ticks[index] ?? 0

    assert.ok(
      before > 0,
      `command ${index + 1} never started, so its heartbeat proves nothing`,
    )
    assert.equal(
      heartbeatCount(file),
      before,
      `a descendant of command ${index + 1} outlived the shared deadline`,
    )
  }
})

test('a synchronous timeout ends the whole process tree, not only the shell', async () => {
  // The gate path runs commands synchronously. With piped output the call
  // returned only when the orphaned grandchildren closed the pipes: 916 s
  // against a 600 s bound in the field. Output now goes to files and the
  // child's process group is killed, so the bound is the bound.
  const { root } = makeInstallation()
  const heartbeat = path.join(root, 'synchronous-timeout-heartbeat.txt')

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [`echo early; ${heartbeatCommand(heartbeat)}`],
    },
  })

  const startedAt = Date.now()
  // Give the loaded test runner time to start the shell and heartbeat before
  // exercising the timeout path. The timeout remains the behavior under test.
  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 2000 })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)
  assert.match(result.results[0]?.stdout ?? '', /early/u)
  // The heartbeat below proves the tree died; this bound proves the other
  // half of the field defect, that the call came back near its deadline
  // instead of waiting on a pipe an orphan still held. It is a generous hang
  // guard, not the kill proof, exactly as its streaming sibling keeps it.
  assert.ok(
    elapsed < 10_000,
    `the gate returned after ${elapsed}ms; the orphaned tree kept it waiting`,
  )

  const ticks = heartbeatCount(heartbeat)

  assert.ok(ticks > 0, 'the heartbeat grandchild never started')
  await delay(500)
  assert.equal(heartbeatCount(heartbeat), ticks)
})

test('a synchronous capture past the byte cap is truncated at the cap with the marker', () => {
  const { root } = makeInstallation()
  const marker = '\n[output truncated by Pancreator]\n'
  const excess = MAX_CAPTURE_BYTES + 1024 * 1024

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [`node -e "process.stdout.write(Buffer.alloc(${excess}, 97))"`],
    },
  })

  const result = runRepositoryCheck(root, 'fast')
  const stdout = result.results[0]?.stdout ?? ''

  assert.equal(result.status, 'passed')
  assert.ok(stdout.endsWith(marker))
  assert.equal(
    Buffer.byteLength(stdout),
    MAX_CAPTURE_BYTES + Buffer.byteLength(marker),
  )
  assert.equal(result.results[0]?.stderr, '')
})

test('stage-requested timeout replaces the profile default', () => {
  const { root } = makeInstallation()

  // The floor for timeout_ms is 1000 ms, so the command sleeps just past it.
  writeChecks(root, {
    fast: {
      timeout_ms: 1_000,
      probes: [],
      commands: ['node -e "setTimeout(() => process.exit(0), 1300)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 5_000 })

  assert.equal(result.status, 'passed')
  assert.equal(result.timeout_ms, 5_000)
  assert.equal(result.results[0]?.timed_out, false)

  const direct = runRepositoryCheck(root, 'fast')

  assert.equal(direct.status, 'failed')
  assert.equal(direct.timeout_ms, 1_000)
  assert.equal(direct.results[0]?.timed_out, true)
})

test('stage-requested timeout bounds the entire synchronous profile', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
      commands: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 2_000 })

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 2_000)
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.ok(result.total_duration_ms < 2_750)
})

test('stage-requested timeout bounds the entire streaming profile', async () => {
  const { root } = makeInstallation()
  const starts: string[] = []

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
      commands: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'fast', {
    timeout_ms: 2_000,
    on_start: (kind, command) => starts.push(`${kind}:${command}`),
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 2_000)
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.equal(starts.length, 2)
  assert.ok(result.total_duration_ms < 2_750)
})
