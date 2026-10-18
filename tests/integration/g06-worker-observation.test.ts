import assert from 'node:assert/strict'
import {
  appendFileSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  appendBlockingReceipt,
  readBlockingReceipts,
} from '../../src/lib/watch/blocking.js'
import {
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index/hooks.js'
import { watchAttach } from '../../src/lib/watch/attach.js'
import {
  recordInvocationLaunch,
  readLaunchRecord,
} from '../../src/lib/watch/launch.js'
import { workerLifetime } from '../../src/lib/watch/lifetime.js'
import {
  watchRecordPath,
  foregroundReturnRecordPath,
} from '../../src/lib/watch/paths.js'
import {
  summarizeDelegationWatch,
  summarizeDelegationObservation,
  readWatchRecord,
} from '../../src/lib/watch/record.js'
import {
  resolveShellRecord,
  watchProcess,
} from '../../src/lib/watch/process.js'
import { delegationLivePaths } from '../../src/lib/executors/delegation-live.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { createTestTempDirectory } from '../helpers.js'
import {
  watchedAgentActivity,
  watchedAgentStopped,
} from '../../src/lib/watch/observe.js'
import {
  multiplexedTargets,
  writeTargetOutputPastCadence,
} from './watch-helpers.js'
import { readFileSync } from 'node:fs'
import type { Invocation } from '../../src/lib/types.js'
import { watchCommand } from '../../src/cli/watch.js'
import { delegateInvocation } from '../../src/lib/engine/delegate.js'
import { watchInvocation } from '../../src/lib/watch.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { validatePanInvocation } from '../../src/lib/pan-command-grammar.js'

const run = 'g06-run'
const invocation = '00_implement-1_g06'
const iso = (seconds: number) =>
  new Date(1700000000000 + seconds * 1000).toISOString()
function fixture() {
  const root = createTestTempDirectory('g06-observation-')
  const ledger = watchRecordPath(root, run, invocation)
  mkdirSync(path.dirname(path.join(root, ledger)), { recursive: true })
  recordInvocationLaunch(root, run, invocation, {
    launchedAt: iso(0),
    defaultLaunchedAtMs: Date.parse(iso(0)),
    defaultSource: 'watch_arm',
    launchMode: 'foreground',
    workerHandle: 'copilot:one',
  })
  return { root, ledger }
}

test('receipt coverage ignores output changes and excludes gaps', () => {
  const { root, ledger } = fixture()
  const foreground = foregroundReturnRecordPath(root, run, invocation)
  const receipt = {
    schema_version: 1,
    run_id: run,
    invocation_id: invocation,
    launch_mode: 'foreground',
    launched_at: iso(0),
    returned_at: iso(100),
    observation: { output_present: true },
  }
  writeFileSync(path.join(root, foreground), JSON.stringify(receipt))
  const output = resolveRunLayout(root, run).output(invocation).relative
  mkdirSync(path.dirname(path.join(root, output)), { recursive: true })
  writeFileSync(path.join(root, output), '{}')
  assert.equal(workerLifetime(root, run, invocation).seconds, 100)
  const before = summarizeDelegationWatch(root, run, invocation)
  utimesSync(path.join(root, output), new Date(), new Date())
  appendFileSync(path.join(root, output), '\n')
  const after = summarizeDelegationWatch(root, run, invocation)
  assert.equal(after.lifetime_seconds, before.lifetime_seconds)
  assert.equal(after.coverage_ratio, before.coverage_ratio)

  // An invocation mismatch cannot grant foreground coverage.
  writeFileSync(
    path.join(root, foreground),
    JSON.stringify({ ...receipt, run_id: 'other' }),
  )
  const entry = {
    schema_version: 1,
    run_id: run,
    invocation_id: invocation,
    cadence_seconds: 60,
    watcher_pid: process.pid,
    watcher_process_identity: 'fixture-start',
    watch_session_id: 'one',
  }
  writeFileSync(
    path.join(root, ledger),
    [
      { ...entry, event: 'session_started', recorded_at: iso(0) },
      { ...entry, event: 'wake', wake: 1, recorded_at: iso(100) },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n',
  )
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).await_status,
    'unknown',
  )
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).coverage_ratio,
    null,
  )
  assert.equal(workerLifetime(root, run, invocation).seconds, null)
  assert.equal(readWatchRecord(root, 'other', invocation).length, 0)
  const live = {
    schema_version: 1,
    executor: 'copilot',
    run_id: run,
    invocation_id: invocation,
    role: 'stage',
    attempt: 1,
    launch_id: 'one',
    relay_pid: process.pid,
    relay_start_identity: 'fixture-start',
    child_pid: process.pid,
    child_start_identity: 'fixture-start',
    launched_at: iso(0),
    child_ended_at: iso(100),
    ended_at: iso(120),
    heartbeat_at: iso(120),
    sequence: 1,
    stream_sequences: { stdout: 0, stderr: 0 },
    truncated: false,
  }
  writeFileSync(
    delegationLivePaths(root, {
      run_id: run,
      invocation_id: invocation,
      role: 'stage',
      attempt: 1,
      launch_id: 'one',
    }).record,
    JSON.stringify(live),
  )
  writeFileSync(path.join(root, foreground), JSON.stringify(receipt))
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).coverage_ratio,
    1,
  )
  writeFileSync(
    path.join(root, foreground),
    JSON.stringify({ ...receipt, run_id: 'other' }),
  )
  for (const watchSession of ['one', 'two']) {
    const identity = 'fixture-start'
    if (watchSession === 'two') {
      appendFileSync(
        path.join(root, ledger),
        [
          {
            ...entry,
            watch_session_id: 'two',
            event: 'session_started',
            recorded_at: iso(50),
          },
          {
            ...entry,
            watch_session_id: 'two',
            event: 'wake',
            wake: 1,
            recorded_at: iso(150),
          },
        ]
          .map((value) => JSON.stringify(value))
          .join('\n') + '\n',
      )
    }
    appendBlockingReceipt(path.join(root, ledger), {
      schema_version: 1,
      ledger,
      watch_session_id: watchSession,
      watcher_pid: process.pid,
      watcher_process_identity: identity,
      parent_pid: process.pid,
      parent_process_identity: identity,
      started_at: iso(watchSession === 'one' ? 0 : 50),
      ended_at: iso(150),
      result: 'attach_completed',
    })
  }
  appendFileSync(
    path.join(root, ledger),
    JSON.stringify({
      ...entry,
      event: 'gap',
      recorded_at: iso(80),
      gap: {
        from: iso(60),
        to: iso(80),
        seconds: 20,
        overdue_seconds: 0,
        reason: 'sibling_handoff',
        source: 'session_end',
        key: 'gap',
      },
    }) + '\n',
  )
  const covered = summarizeDelegationWatch(root, run, invocation)
  assert.equal(covered.lifetime_seconds, 100)
  assert.equal(covered.covered_seconds, 80)
  assert.equal(covered.coverage_ratio, 0.8)
  assert.equal(covered.await_status, 'observed')
  // A valid foreground span must not restore a disclosed gap.
  writeFileSync(path.join(root, foreground), JSON.stringify(receipt))
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).covered_seconds,
    80,
  )
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).coverage_ratio,
    0.8,
  )
  utimesSync(path.join(root, output), new Date(), new Date())
  assert.equal(
    summarizeDelegationWatch(root, run, invocation).coverage_ratio,
    0.8,
  )
  appendFileSync(
    path.join(root, ledger),
    JSON.stringify({
      ...entry,
      event: 'gap',
      recorded_at: iso(100),
      gap: {
        from: iso(0),
        to: iso(100),
        seconds: 100,
        overdue_seconds: 40,
        reason: 'sibling_handoff',
        source: 'session_end',
      },
    }) + '\n',
  )
  const fullyDisclosed = summarizeDelegationWatch(root, run, invocation)
  assert.equal(fullyDisclosed.covered_seconds, 0)
  assert.equal(fullyDisclosed.coverage_ratio, 0)
})

test('pinned absent native worker cannot borrow a completed sibling across restart', () => {
  const { root, targets } = multiplexedTargets(1)
  const target = targets[0]!
  const contract = JSON.parse(
    readFileSync(
      target.layout.invocation(target.invocationId, '.json').absolute,
      'utf8',
    ),
  ) as Invocation
  recordInvocationLaunch(root, target.runId, target.invocationId, {
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
    workerHandle: 'pinned-A',
  })
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'completed-B',
    task_text: `Read runtime/logs/workflows/${target.runId}/agent/invocations/${target.invocationId}.json`,
  })
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: 'completed-B',
    status: 'completed',
  })
  for (let restart = 0; restart < 2; restart += 1) {
    assert.equal(watchedAgentActivity(root, contract, Date.now(), 60), null)
    assert.equal(watchedAgentStopped(root, contract), false)
  }
})

for (const invalid of [
  'clock',
  'background',
  'future',
  'implausible',
] as const) {
  test(`foreground ${invalid} receipt cannot grant any public observation`, () => {
    const { root } = fixture()
    const receipt = {
      schema_version: 1,
      run_id: run,
      invocation_id: invocation,
      launch_mode: 'foreground',
      launched_at: invalid === 'clock' ? iso(1) : iso(0),
      returned_at:
        invalid === 'future'
          ? new Date(Date.now() + 60000).toISOString()
          : iso(100),
      elapsed_implausible: invalid === 'implausible',
      observation: { output_present: true },
    }
    if (invalid === 'background') {
      recordInvocationLaunch(root, run, invocation, {
        defaultLaunchedAtMs: Date.now(),
        defaultSource: 'watch_arm',
        launchMode: 'background',
      })
    }
    writeFileSync(
      path.join(root, foregroundReturnRecordPath(root, run, invocation)),
      JSON.stringify(receipt),
    )
    const auditPath = path.join(
      root,
      delegationExecutionPath(run, invocation, root),
    )
    mkdirSync(path.dirname(auditPath), { recursive: true })
    writeFileSync(
      auditPath,
      JSON.stringify({
        schema_version: 1,
        run_id: run,
        invocation_id: invocation,
        executor: 'claude-code',
      }),
    )
    assert.equal(workerLifetime(root, run, invocation).seconds, null)
    const summary = summarizeDelegationObservation(root, run, invocation)
    assert.equal(summary.watch.coverage_ratio, null)
    assert.equal(summary.observed, false)
    assert.equal(summary.source, null)
  })
}

test('launch identity and supervisor clock survive restart', () => {
  const { root } = fixture()
  recordInvocationLaunch(root, run, invocation, {
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
    executorLaunchId: 'one',
  })
  assert.throws(
    () =>
      recordInvocationLaunch(root, run, invocation, {
        defaultLaunchedAtMs: Date.now(),
        defaultSource: 'watch_arm',
        workerHandle: 'replacement',
      }),
    /handle/u,
  )
  assert.throws(
    () =>
      recordInvocationLaunch(root, run, invocation, {
        launchedAt: iso(1),
        defaultLaunchedAtMs: Date.now(),
        defaultSource: 'watch_arm',
      }),
    /clock/u,
  )
  assert.equal(
    readLaunchRecord(root, run, invocation)?.worker_handle,
    'copilot:one',
  )
  assert.throws(
    () =>
      recordInvocationLaunch(root, run, invocation, {
        defaultLaunchedAtMs: Date.now(),
        defaultSource: 'watch_arm',
        executorLaunchId: 'replacement',
      }),
    /executor launch identity/u,
  )
})

test('shell rearm pins latest before the alias moves', async (t) => {
  const root = createTestTempDirectory('g06-shell-alias-')
  for (const name of ['one', 'two']) {
    mkdirSync(path.join(root, 'runtime/logs/shell', name), { recursive: true })
    writeFileSync(
      path.join(root, 'runtime/logs/shell', name, 'record.json'),
      JSON.stringify({ pid: process.pid, label: name }),
    )
  }
  const latest = path.join(root, 'runtime/logs/shell/latest')
  symlinkSync('one', latest)
  let now = 0
  const result = await watchProcess(root, {
    pid: process.pid,
    label: 'pin',
    shellRecord: 'latest',
    identityProbe: () => 'original-P1',
    now: () => now,
    cadenceSeconds: 60,
    timeoutSeconds: 60,
    sleep: async () => {
      unlinkSync(latest)
      symlinkSync('two', latest)
      now += 60000
    },
  })
  assert.equal(
    resolveShellRecord(root, 'latest').directory,
    'runtime/logs/shell/two',
  )
  assert.match(result.rearm_command ?? '', /runtime\/logs\/shell\/one/u)
  assert.doesNotMatch(result.rearm_command ?? '', /latest/u)
  const continuation = /--resume-process '([^']+)'/u.exec(
    result.rearm_command ?? '',
  )?.[1]
  assert.ok(continuation, 'rearm must carry a persisted subject identity')
  const shellArgument = /--shell '([^']+)'/u.exec(
    result.rearm_command ?? '',
  )?.[1]
  assert.equal(shellArgument, 'runtime/logs/shell/one')
  let printed = ''
  t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    printed += chunk.toString()
    return true
  })
  t.mock.method(process.stderr, 'write', () => true)
  const args = [
    '--shell',
    shellArgument!,
    '--resume-process',
    continuation,
    '--timeout-seconds',
    '60',
    '--json',
  ]
  const oldExitCode = process.exitCode
  assert.equal(validatePanInvocation(['watch', ...args]).valid, true)
  try {
    await watchCommand({
      root,
      args,
      rawArgs: ['watch', ...args],
      command: 'watch',
      json: true,
      help: '',
      pan: './bin/pan',
    })
    assert.equal(process.exitCode, 4)
  } finally {
    process.exitCode = oldExitCode
  }
  const second = JSON.parse(printed) as { state: string }
  assert.equal(second.state, 'unverified')
  writeFileSync(
    path.join(root, 'runtime/logs/shell/one/record.json'),
    JSON.stringify({ pid: process.pid, started_at: iso(1) }),
  )
  await assert.rejects(
    watchProcess(root, {
      pid: process.pid,
      label: 'one',
      shellRecord: 'runtime/logs/shell/one',
      resumeProcess: continuation,
      now: () => now,
    }),
    /identity/u,
  )
})

test('G06 launch/action trace: unsupported terminal delegation recovers without creating a worker watch', () => {
  const { root, targets } = multiplexedTargets(1)
  const target = targets[0]!
  const actions: string[] = []
  const started = Date.now()
  try {
    delegateInvocation(root, target.runId)
    assert.fail(
      'Native Cursor delegation must reject the unsupported external command.',
    )
  } catch (error) {
    actions.push('inspect_launch_result')
    assert.equal((error as { code: string }).code, 'EXECUTOR_UNSUPPORTED')
    actions.push('recover_with_native_launch')
  }
  assert.deepEqual(actions, [
    'inspect_launch_result',
    'recover_with_native_launch',
  ])
  assert.equal(readLaunchRecord(root, target.runId, target.invocationId), null)
  assert.deepEqual(readWatchRecord(root, target.runId, target.invocationId), [])
  assert.ok(Date.now() - started < 5000)
})

test('G06 launch/action trace: detached transport binds the returned target before observation and unrelated work', async () => {
  const { root, targets } = multiplexedTargets(1)
  const target = targets[0]!
  const shellDirectory = 'runtime/logs/shell/returned-launch'
  mkdirSync(path.join(root, shellDirectory), { recursive: true })
  writeFileSync(
    path.join(root, shellDirectory, 'record.json'),
    JSON.stringify({ pid: process.pid }),
  )
  const returned = { worker: 'returned-worker', shell: shellDirectory }
  const actions = ['inspect_launch_result']
  const shell = resolveShellRecord(root, returned.shell)
  assert.equal(shell.directory, returned.shell)
  recordInvocationLaunch(root, target.runId, target.invocationId, {
    workerHandle: returned.worker,
    launchMode: 'background',
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
  })
  actions.push('bind_returned_worker_and_shell')
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: returned.worker,
    task_text: `Read runtime/logs/workflows/${target.runId}/agent/invocations/${target.invocationId}.json`,
  })
  writeTargetOutputPastCadence(root, target)
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: returned.worker,
    status: 'completed',
  })
  const result = await watchInvocation(root, target.runId, {
    invocationId: target.invocationId,
    workerHandle: returned.worker,
    onSessionStart: () => actions.push('observe_returned_target'),
  })
  actions.push('unrelated_work')
  assert.equal(result.state, 'completed')
  assert.equal(
    readLaunchRecord(root, target.runId, target.invocationId)?.worker_handle,
    returned.worker,
  )
  assert.deepEqual(actions, [
    'inspect_launch_result',
    'bind_returned_worker_and_shell',
    'observe_returned_target',
    'unrelated_work',
  ])
})

test('attach receipts need matching session identity and ignore terminal transport', async () => {
  const { root, ledger } = fixture()
  const identity = 'fixture-start'
  const entry = {
    event: 'session_started',
    watch_session_id: 'one',
    watcher_pid: process.pid,
    watcher_process_identity: identity,
    recorded_at: iso(0),
  }
  writeFileSync(path.join(root, ledger), JSON.stringify(entry) + '\n')
  let now = Date.parse(iso(0))
  const result = await watchAttach(root, {
    ledgers: [ledger],
    identityProbe: () => identity,
    now: () => now,
    timeoutSeconds: 60,
    sleep: async () => {
      now += 1000
      appendFileSync(
        path.join(root, ledger),
        JSON.stringify({
          ...entry,
          event: 'wake',
          wake: 1,
          recorded_at: iso(1),
          terminal_state: 'completed',
        }) + '\n',
      )
    },
  })
  assert.equal(result.state, 'attach_completed')
  assert.equal(readBlockingReceipts(path.join(root, ledger)).length, 1)
  assert.throws(
    () =>
      appendBlockingReceipt(path.join(root, ledger), {
        schema_version: 1,
        ledger,
        watch_session_id: 'one',
        watcher_pid: process.pid,
        watcher_process_identity: identity,
        parent_pid: process.pid,
        parent_process_identity: identity,
        started_at: iso(3),
        ended_at: iso(2),
        result: 'completed',
      }),
    /Invalid/u,
  )
})

test('attach never follows a replacement session in the same ledger', async () => {
  const { root, ledger } = fixture()
  const entry = {
    event: 'session_started',
    watch_session_id: 'original',
    watcher_pid: process.pid,
    watcher_process_identity: 'fixture-start',
    recorded_at: iso(0),
  }
  writeFileSync(path.join(root, ledger), JSON.stringify(entry) + '\n')
  let now = Date.parse(iso(0))
  const result = await watchAttach(root, {
    ledgers: [ledger],
    identityProbe: () => 'fixture-start',
    now: () => now,
    sleep: async () => {
      now += 1000
      writeFileSync(
        path.join(root, ledger),
        JSON.stringify({
          ...entry,
          watch_session_id: 'replacement',
          terminal_state: 'completed',
        }) + '\n',
      )
    },
  })
  assert.equal(result.state, 'orphaned')
  assert.equal(
    readBlockingReceipts(path.join(root, ledger))[0]?.watch_session_id,
    'original',
  )
})

test('native stop clocks need the pinned run and invocation, without a foreground receipt', () => {
  const root = createTestTempDirectory('g06-native-stop-')
  recordInvocationLaunch(root, run, invocation, {
    launchedAt: iso(0),
    defaultLaunchedAtMs: Date.parse(iso(0)),
    defaultSource: 'watch_arm',
    workerHandle: 'native-worker',
  })
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'native-worker',
    task_text: `Read runtime/logs/workflows/${run}/agent/invocations/${invocation}.json`,
  })
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: 'native-worker',
    status: 'completed',
  })
  assert.equal(workerLifetime(root, run, invocation).basis, 'agent_stop')
  assert.ok(workerLifetime(root, run, invocation).seconds! > 0)
  assert.equal(workerLifetime(root, 'other', invocation).seconds, null)
})

test('malformed foreground evidence stays explicitly unknown', () => {
  const { root } = fixture()
  writeFileSync(
    path.join(root, foregroundReturnRecordPath(root, run, invocation)),
    '{',
  )
  const lifetime = workerLifetime(root, run, invocation)
  assert.equal(lifetime.seconds, null)
  assert.match(lifetime.diagnostics.join(' '), /Malformed/u)
})
