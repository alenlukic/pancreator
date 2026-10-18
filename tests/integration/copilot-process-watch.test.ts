import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getAgentByRunInvocation } from '../../src/lib/agent-index/activity.js'
import {
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index/hooks.js'
import { assertWorkerNotStillActive } from '../../src/lib/engine/submit-checks.js'
import {
  delegationLivePaths,
  type DelegationLiveRecord,
} from '../../src/lib/executors/delegation-live.js'
import type { Invocation, StageDefinition } from '../../src/lib/types.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import {
  readWatchRecord,
  watchAgent,
  watchInvocation,
  watchInvocations,
} from '../../src/lib/watch.js'
import { processStartIdentity } from '../../src/lib/watch/process-evidence.js'
import { formatWakeLine } from '../../src/lib/watch/record.js'
import { watchedAgentActivity } from '../../src/lib/watch/observe.js'
import {
  multiplexedTargets,
  writeTargetOutputPastCadence,
} from './watch-helpers.js'
import { watchAttach } from '../../src/lib/watch/attach.js'
import { readBlockingReceipts } from '../../src/lib/watch/blocking.js'
import { watchRecordPath } from '../../src/lib/watch/paths.js'
import {
  readLaunchRecord,
  recordInvocationLaunch,
} from '../../src/lib/watch/launch.js'

function processFixture(count = 1) {
  const { root, targets } = multiplexedTargets(count)
  const target = targets[0]!
  const invocationPath = target.layout.invocation(
    target.invocationId,
    '.json',
  ).absolute
  const invocation = JSON.parse(
    readFileSync(invocationPath, 'utf8'),
  ) as Invocation
  invocation.stage.persona_executor = 'copilot'
  writeFileSync(invocationPath, JSON.stringify(invocation))
  const wrapper = 'runtime/logs/shell/20261016T000000Z-copilot-watch'
  mkdirSync(path.join(root, wrapper), { recursive: true })
  const start = processStartIdentity(process.pid)
  assert.ok(start)
  let now = Date.now()
  const live: DelegationLiveRecord = {
    schema_version: 1,
    executor: 'copilot',
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    role: 'stage',
    attempt: invocation.attempt,
    launch_id: 'launch-current',
    launched_at: new Date(now).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    relay_pid: process.pid,
    relay_start_identity: start,
    wrapper_record_path: wrapper,
    sequence: 1,
    stream_sequences: { stdout: 1, stderr: 0 },
    truncated: false,
    session_id: 'fixture-session',
  }
  writeFileSync(
    path.join(root, wrapper, 'record.json'),
    JSON.stringify({
      wrapper_pid: process.pid,
      pid: process.pid,
      wrapper_process_identity: start,
      started_at: live.launched_at,
      ended_at: null,
      heartbeat_seconds: 30,
    }),
  )
  const livePath = delegationLivePaths(root, live).record
  const heartbeatPath = path.join(root, wrapper, 'heartbeat.json')
  const refresh = () => {
    live.heartbeat_at = new Date(now).toISOString()
    writeFileSync(livePath, JSON.stringify(live))
    writeFileSync(
      heartbeatPath,
      JSON.stringify({ log_bytes: 0, recent_lines: [] }),
    )
    const time = new Date(now)
    utimesSync(heartbeatPath, time, time)
  }
  refresh()

  const output = () =>
    writeFileSync(
      path.join(root, invocation.output.path),
      JSON.stringify({
        invocation_id: invocation.invocation_id,
        result: 'success',
        data: {
          implementation: { changed_files: [], tests_added: [], notes: [] },
          acceptance_results: [],
        },
      }),
    )
  const audit = (fields: Record<string, unknown> = {}) => {
    live.child_pid = process.pid
    live.child_start_identity = start
    live.child_ended_at = new Date(now).toISOString()
    refresh()
    writeFileSync(
      path.join(
        root,
        delegationExecutionPath(
          invocation.run_id,
          invocation.invocation_id,
          root,
        ),
      ),
      JSON.stringify({
        schema_version: 1,
        run_id: invocation.run_id,
        invocation_id: invocation.invocation_id,
        stage: invocation.stage.slug,
        executor: 'copilot',
        exit_code: 0,
        timed_out: false,
        session_id: 'fixture-session',
        recorded_at: new Date(now).toISOString(),
        ...fields,
      }),
    )
  }

  return {
    root,
    target,
    targets,
    invocation,
    live,
    livePath,
    output,
    audit,
    refresh,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
      refresh()
    },
  }
}

test('G06: silent healthy sibling survives handoff, detached continuation and attach with the same identity', async (t) => {
  const start = 'Sun Oct 18 00:00:00 2026'
  const originalSpawn = childProcess.spawnSync
  // Only this deterministic case supplies OS samples; live QA never does.
  t.mock.method(
    childProcess,
    'spawnSync',
    (
      command: string,
      args: string[],
      options: childProcess.SpawnSyncOptions,
    ) => {
      if (command !== 'ps') return originalSpawn(command, args, options)
      const stdout = args.includes('-A')
        ? `${process.pid} 1 S 0:00.00 ${start}\n`
        : args.includes('stat=')
          ? 'S\n'
          : `${start}\n`
      return {
        pid: process.pid,
        status: 0,
        signal: null,
        stdout,
        stderr: '',
        output: [null, stdout, ''],
      }
    },
  )
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
  const fixture = processFixture(2)
  const moved = fixture.targets[1]!
  handleSubagentStart(fixture.root, {
    event: 'subagentStart',
    subagent_id: 'moved-worker',
    task_text: `Read runtime/logs/workflows/${moved.runId}/agent/invocations/${moved.invocationId}.json`,
  })
  let quietWakes = 0
  const result = await watchInvocations(
    fixture.root,
    fixture.targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      now: fixture.now,
      cadenceSeconds: 60,
      timeoutSeconds: 600,
      untilTerminal: true,
      sleep: async (ms) => {
        await fixture.sleep(ms)
        if (quietWakes === 2) {
          writeTargetOutputPastCadence(fixture.root, moved)
          handleSubagentStop(fixture.root, {
            event: 'subagentStop',
            subagent_id: 'moved-worker',
            status: 'completed',
          })
        }
      },
      onWake: (entry) => {
        if (entry.run_id !== fixture.invocation.run_id) return
        quietWakes += 1
        assert.equal(entry.terminal_state, undefined)
        assert.equal(entry.observation?.agent_activity?.stall_suppressed, true)
        if (quietWakes > 1) assert.equal(entry.changed, false)
      },
    },
  )
  assert.equal(result.state, 'changed')
  assert.deepEqual(
    result.moved.map((item) => item.invocation_id),
    [moved.invocationId],
  )
  assert.ok(quietWakes >= 2)
  const { root, invocation } = fixture
  const ledger = watchRecordPath(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )
  assert.equal(
    readWatchRecord(root, invocation.run_id, invocation.invocation_id).at(-1)
      ?.session_end_reason,
    'sibling_handoff',
  )
  const pinned = readLaunchRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )?.executor_launch_id
  assert.equal(pinned, fixture.live.launch_id)
  await fixture.sleep(74000)
  let resumedWakes = 0
  let release: (() => void) | undefined
  const detached = watchInvocation(root, invocation.run_id, {
    invocationId: invocation.invocation_id,
    now: fixture.now,
    cadenceSeconds: 60,
    timeoutSeconds: 480,
    sleep: async (ms) => {
      await fixture.sleep(ms)
      if (release === undefined)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      if (resumedWakes >= 5) {
        fixture.output()
        fixture.audit()
      }
    },
    onWake: (entry) => {
      resumedWakes += 1
      if (!entry.terminal_state)
        assert.equal(entry.observation?.agent_activity?.stall_suppressed, true)
    },
  })
  const attached = await watchAttach(root, {
    ledgers: [ledger],
    now: fixture.now,
    timeoutSeconds: 600,
    untilTerminal: true,
    sleep: async (ms) => {
      await fixture.sleep(ms)
      release?.()
    },
  })
  assert.equal(attached.state, 'attach_completed')
  assert.equal((await detached).state, 'completed')
  assert.ok(quietWakes + resumedWakes >= 7)
  assert.equal(
    readLaunchRecord(root, invocation.run_id, invocation.invocation_id)
      ?.executor_launch_id,
    pinned,
  )
  const entries = readWatchRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )
  assert.equal(entries.find((entry) => entry.event === 'gap')?.gap?.seconds, 74)
  assert.ok(entries.every((entry) => entry.terminal_state !== 'stalled'))
  assert.ok(readBlockingReceipts(path.join(root, ledger)).length > 0)
})

for (const multiplexed of [false, true]) {
  test(`AC-09: ${multiplexed ? 'multiplexed' : 'focused'} Copilot watch survives seven silent 60-second wakes`, async () => {
    const fixture = processFixture()
    const { root, invocation } = fixture
    const wakes: number[] = []
    const options = {
      cadenceSeconds: 60,
      timeoutSeconds: 480,
      now: fixture.now,
      sleep: async (ms: number) => {
        await fixture.sleep(ms)
        if (wakes.length === 7) {
          fixture.output()
          fixture.audit()
        }
      },
      onWake: (entry: Parameters<typeof formatWakeLine>[0]) => {
        wakes.push(entry.wake)
        if (entry.wake <= 7) {
          assert.equal(entry.terminal_state, undefined)
          assert.equal(
            entry.observation?.agent_activity?.stall_suppressed,
            true,
          )
          assert.match(formatWakeLine(entry), /basis:process/u)
          if (entry.wake > 1) assert.equal(entry.changed, false)
        }
      },
    }
    const result = multiplexed
      ? await watchInvocations(
          root,
          [
            {
              runId: invocation.run_id,
              invocationId: invocation.invocation_id,
            },
          ],
          options,
        )
      : await watchInvocation(root, invocation.run_id, {
          ...options,
          invocationId: invocation.invocation_id,
          workerHandle: 'never-indexed',
        })
    assert.equal(result.state, multiplexed ? 'changed' : 'completed')
    assert.equal(wakes.length, 8)
    const last = readWatchRecord(
      root,
      invocation.run_id,
      invocation.invocation_id,
    ).at(-1)
    assert.equal(last?.terminal_state, 'completed')
    assert.equal(last?.terminal_basis, 'agent_state')
  })
}

test('AC-10: early result and plausible output cannot finish an active Copilot process or permit submission', async (t) => {
  const fixture = processFixture()
  t.mock.method(Date, 'now', fixture.now)
  fixture.output()
  const stage = { persona: 'coder' } as StageDefinition
  assert.throws(
    () =>
      assertWorkerNotStillActive(
        fixture.root,
        fixture.invocation,
        'copilot',
        stage,
      ),
    { code: 'WORKER_STILL_ACTIVE' },
  )
  const result = await watchInvocation(
    fixture.root,
    fixture.invocation.run_id,
    {
      invocationId: fixture.invocation.invocation_id,
      cadenceSeconds: 60,
      timeoutSeconds: 420,
      now: fixture.now,
      sleep: fixture.sleep,
    },
  )
  assert.equal(result.state, 'unverified')
  assert.equal(result.wakes, 7)
  fixture.audit()
  assert.doesNotThrow(() =>
    assertWorkerNotStillActive(
      fixture.root,
      fixture.invocation,
      'copilot',
      stage,
    ),
  )
})

test('AC-10: unrelated unknown agent IDs remain unregistered despite a live Copilot record', async () => {
  const fixture = processFixture()
  const result = await watchAgent(fixture.root, 'unrelated-worker', {
    cadenceSeconds: 60,
    now: fixture.now,
    sleep: fixture.sleep,
  })
  assert.equal(result.state, 'unregistered')
})

test('AC-09: an indexed handle without usable activity still uses process evidence', () => {
  const fixture = processFixture()
  handleSubagentStart(fixture.root, {
    event: 'subagentStart',
    subagent_id: 'empty-index-entry',
    conversation_id: 'parent',
    parent_conversation_id: 'parent',
    task: `Read runtime/logs/workflows/${fixture.invocation.run_id}/agent/invocations/${fixture.invocation.invocation_id}.md first.`,
  })
  assert.equal(
    getAgentByRunInvocation(
      fixture.root,
      fixture.invocation.run_id,
      fixture.invocation.invocation_id,
    )?.agent_id,
    'empty-index-entry',
  )
  const activity = watchedAgentActivity(
    fixture.root,
    fixture.invocation,
    fixture.now(),
    60,
  )
  assert.equal(activity?.liveness?.basis, 'process')
  assert.equal(activity?.stall_suppressed, true)
  fixture.audit()
  assert.equal(
    watchedAgentActivity(fixture.root, fixture.invocation, fixture.now(), 60)
      ?.stop?.source,
    'process',
  )
})

for (const multiplexed of [false, true]) {
  test(`AC-10: ${multiplexed ? 'multiplexed' : 'focused'} ambiguous launches cannot use an older audit to complete or permit submission`, async (t) => {
    const fixture = processFixture()
    t.mock.method(Date, 'now', fixture.now)
    fixture.invocation.created_at = new Date(
      fixture.now() - 60_000,
    ).toISOString()
    writeFileSync(
      fixture.target.layout.invocation(
        fixture.invocation.invocation_id,
        '.json',
      ).absolute,
      JSON.stringify(fixture.invocation),
    )
    const secondLaunch = {
      ...fixture.live,
      launch_id: 'same-time-relaunch',
    }
    writeFileSync(
      delegationLivePaths(fixture.root, secondLaunch).record,
      JSON.stringify(secondLaunch),
    )
    fixture.output()
    fixture.audit({
      recorded_at: new Date(fixture.now() - 40_000).toISOString(),
    })
    const stage = { persona: 'coder' } as StageDefinition
    assert.throws(
      () =>
        assertWorkerNotStillActive(
          fixture.root,
          fixture.invocation,
          'copilot',
          stage,
        ),
      { code: 'WORKER_STILL_ACTIVE' },
    )
    const options = {
      cadenceSeconds: 60,
      timeoutSeconds: 120,
      now: fixture.now,
      sleep: fixture.sleep,
      onWake: (entry: Parameters<typeof formatWakeLine>[0]) => {
        assert.notEqual(entry.terminal_state, 'completed')
        assert.equal(entry.observation?.agent_activity?.stop ?? null, null)
      },
    }
    if (multiplexed) {
      await watchInvocations(
        fixture.root,
        [
          {
            runId: fixture.invocation.run_id,
            invocationId: fixture.invocation.invocation_id,
          },
        ],
        options,
      )
    } else {
      const result = await watchInvocation(
        fixture.root,
        fixture.invocation.run_id,
        { ...options, invocationId: fixture.invocation.invocation_id },
      )
      assert.equal(result.state, 'unverified')
    }
    const last = readWatchRecord(
      fixture.root,
      fixture.invocation.run_id,
      fixture.invocation.invocation_id,
    ).at(-1)
    assert.equal(last?.terminal_state, 'unverified')

    recordInvocationLaunch(
      fixture.root,
      fixture.invocation.run_id,
      fixture.invocation.invocation_id,
      {
        defaultLaunchedAtMs: Date.parse(fixture.live.launched_at),
        defaultSource: 'watch_arm',
        executorLaunchId: fixture.live.launch_id,
        workerHandle: `copilot:${fixture.live.launch_id}`,
      },
    )
    fixture.audit()
    assert.doesNotThrow(() =>
      assertWorkerNotStillActive(
        fixture.root,
        fixture.invocation,
        'copilot',
        stage,
      ),
    )
  })

  for (const [name, fields, expected, reason] of [
    ['exit and result', {}, 'completed', undefined],
    ['nonzero exit', { exit_code: 8 }, 'unverified', 'agent_stopped_error'],
    [
      'timeout',
      { exit_code: null, timed_out: true },
      'unverified',
      'agent_stopped_error',
    ],
    [
      'missing result',
      { session_id: undefined },
      'unverified',
      'agent_stopped_error',
    ],
    ['missing stage output', {}, 'unverified', 'agent_stopped_without_output'],
  ] as const) {
    test(`AC-10: ${multiplexed ? 'multiplexed' : 'focused'} ${name} uses the final audit over a fresh heartbeat`, async () => {
      const fixture = processFixture()
      if (name !== 'missing stage output') fixture.output()
      fixture.audit(fields)
      assert.doesNotThrow(() =>
        assertWorkerNotStillActive(
          fixture.root,
          fixture.invocation,
          'copilot',
          { persona: 'coder' } as StageDefinition,
        ),
      )
      if (multiplexed) {
        await watchInvocations(
          fixture.root,
          [
            {
              runId: fixture.invocation.run_id,
              invocationId: fixture.invocation.invocation_id,
            },
          ],
          { cadenceSeconds: 60, now: fixture.now, sleep: fixture.sleep },
        )
      } else {
        const result = await watchInvocation(
          fixture.root,
          fixture.invocation.run_id,
          {
            invocationId: fixture.invocation.invocation_id,
            cadenceSeconds: 60,
            now: fixture.now,
            sleep: fixture.sleep,
          },
        )
        assert.equal(result.state, expected)
      }
      const last = readWatchRecord(
        fixture.root,
        fixture.invocation.run_id,
        fixture.invocation.invocation_id,
      ).at(-1)
      assert.equal(last?.terminal_state, expected)
      assert.equal(last?.unverified_reason, reason)
      assert.equal(last?.observation?.agent_activity?.stop?.source, 'process')
    })
  }
  for (const fault of ['shell_dead', 'shell_heartbeat_stale'] as const) {
    test(`AC-10: ${multiplexed ? 'multiplexed' : 'focused'} ${fault} requires two matching fault wakes`, async () => {
      const fixture = processFixture()
      const options = {
        cadenceSeconds: 60,
        timeoutSeconds: 600,
        now: fixture.now,
        sleep: async (ms: number) => {
          await fixture.sleep(ms)
          if (fault === 'shell_dead') {
            fixture.live.relay_start_identity = 'reused-pid'
            fixture.refresh()
          } else {
            const heartbeatPath = path.join(
              fixture.root,
              fixture.live.wrapper_record_path!,
              'heartbeat.json',
            )
            const stale = new Date(fixture.now() - 121_000)
            utimesSync(heartbeatPath, stale, stale)
          }
        },
      }
      if (multiplexed) {
        await watchInvocations(
          fixture.root,
          [
            {
              runId: fixture.invocation.run_id,
              invocationId: fixture.invocation.invocation_id,
            },
          ],
          options,
        )
      } else {
        const result = await watchInvocation(
          fixture.root,
          fixture.invocation.run_id,
          {
            ...options,
            invocationId: fixture.invocation.invocation_id,
          },
        )
        assert.equal(result.state, 'stalled')
      }
      const wakes = readWatchRecord(
        fixture.root,
        fixture.invocation.run_id,
        fixture.invocation.invocation_id,
      ).filter((entry) => entry.event === 'wake')
      assert.equal(wakes.length, 2)
      assert.equal(wakes[0]?.terminal_state, undefined)
      assert.equal(wakes[1]?.stall_cause, fault)
      assert.equal(wakes[1]?.terminal_state, 'stalled')
    })
  }
}
