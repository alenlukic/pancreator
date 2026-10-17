import assert from 'node:assert/strict'
import { mkdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { AgentActivity } from '../../src/lib/agent-index/activity.js'
import type { ProcessTable } from '../../src/lib/agent-index/shell-records.js'
import type { TranscriptState } from '../../src/lib/agent-index/transcript.js'
import {
  delegationLivePaths,
  type DelegationLiveRecord,
} from '../../src/lib/executors/delegation-live.js'
import type { Invocation } from '../../src/lib/types.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { executorProcessActivity } from '../../src/lib/watch/executor-process.js'
import {
  agentLiveness,
  deterministicStallCause,
  quietStallApplies,
  workerActivityRefusal,
} from '../../src/lib/watch/liveness.js'
import { createTestTempDirectory } from '../temp.js'

function transcript(turnEnded: boolean): TranscriptState {
  return {
    path: '/tmp/x.jsonl',
    size: 1,
    mtime_ms: 0,
    readable: true,
    turn_ended: turnEnded,
    turn_status: turnEnded ? 'success' : null,
    age_seconds: 0,
    last_record_type: 'turn_ended',
  }
}

function activity(overrides: Partial<AgentActivity> = {}): AgentActivity {
  return {
    agent_id: 'probe',
    aliases: [],
    registered_at: '2026-10-01T00:00:00.000Z',
    last_event_kind: 'call_started',
    last_event_at: '2026-10-01T00:00:00.000Z',
    last_event_age_seconds: 0,
    open_call: null,
    stop: null,
    stall_suppressed: false,
    signature: 'sig',
    transcript: null,
    shell_records: [],
    liveness: agentLiveness(null),
    ...overrides,
  } as AgentActivity
}

test('deterministicStallCause requires the same open call and shell fault on two wakes', () => {
  const open = {
    tool: 'Shell',
    tool_use_id: 'tu-1',
    started_at: '2026-10-01T00:00:00.000Z',
    shell_record_state: 'dead' as const,
    shell_heartbeat: null,
  }
  const first = activity({ open_call: open })
  const second = activity({ open_call: open })

  assert.equal(deterministicStallCause(second, first), 'shell_dead')
  assert.equal(deterministicStallCause(second, null), null)
})

test('quietStallApplies is false when a readable transcript exists', () => {
  assert.equal(
    quietStallApplies(activity({ transcript: transcript(true) })),
    false,
  )
  assert.equal(quietStallApplies(null), true)
})

test('workerActivityRefusal names an open transcript turn', () => {
  const reason = workerActivityRefusal(
    activity({ transcript: transcript(false) }),
  )
  assert.ok(reason?.includes('open transcript turn'))
})

function liveFixture() {
  const root = createTestTempDirectory('copilot-live-liveness-')
  const now = Date.now()
  const invocation = {
    run_id: 'run-live',
    invocation_id: 'inv-live',
    attempt: 2,
    created_at: new Date(now - 60_000).toISOString(),
    stage: { slug: 'implement', persona_executor: 'copilot' },
  } as Invocation
  const wrapper = 'runtime/logs/shell/20261016T000000Z-live'
  const record = {
    wrapper_pid: 101,
    pid: 102,
    wrapper_process_identity: 'wrapper-start',
    started_at: invocation.created_at,
    ended_at: null,
    heartbeat_seconds: 30,
  }
  const live: DelegationLiveRecord = {
    schema_version: 1,
    executor: 'copilot',
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    role: 'stage',
    attempt: 2,
    launch_id: 'current',
    launched_at: new Date(now - 30_000).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    relay_pid: 102,
    relay_start_identity: 'relay-start',
    child_pid: 103,
    child_start_identity: 'child-start',
    wrapper_record_path: wrapper,
    sequence: 0,
    stream_sequences: { stdout: 0, stderr: 0 },
    truncated: false,
  }
  const table: ProcessTable = new Map([
    [
      101,
      { pid: 101, ppid: 1, stat: 'S', time: '0:00', lstart: 'wrapper-start' },
    ],
    [
      102,
      { pid: 102, ppid: 101, stat: 'S', time: '0:00', lstart: 'relay-start' },
    ],
    [
      103,
      { pid: 103, ppid: 102, stat: 'S', time: '0:00', lstart: 'child-start' },
    ],
  ])
  let previousPath: string | undefined
  const save = (heartbeatAge = 0) => {
    const livePath = delegationLivePaths(root, live).record
    if (previousPath && previousPath !== livePath) unlinkSync(previousPath)
    previousPath = livePath
    mkdirSync(path.dirname(livePath), { recursive: true })
    writeFileSync(livePath, JSON.stringify(live))
    mkdirSync(path.join(root, wrapper), { recursive: true })
    writeFileSync(
      path.join(root, wrapper, 'record.json'),
      JSON.stringify(record),
    )
    const heartbeatPath = path.join(root, wrapper, 'heartbeat.json')
    writeFileSync(heartbeatPath, '{}')
    const time = new Date(now - heartbeatAge * 1000)
    utimesSync(heartbeatPath, time, time)
  }
  save()
  return {
    root,
    invocation,
    now,
    live,
    table,
    record,
    save,
    observe: () => executorProcessActivity(root, invocation, now, table),
  }
}

test('AC-10: live process faults retain their cause only for two samples of the same launch', () => {
  for (const [fault, mutate] of [
    ['shell_dead', (f: ReturnType<typeof liveFixture>) => f.table.delete(103)],
    [
      'shell_stopped',
      (f: ReturnType<typeof liveFixture>) => {
        f.table.get(103)!.stat = 'T'
      },
    ],
    [
      'shell_heartbeat_stale',
      (f: ReturnType<typeof liveFixture>) => f.save(121),
    ],
  ] as const) {
    const fixture = liveFixture()
    const healthy = fixture.observe()
    assert.equal(healthy?.stall_suppressed, true)
    mutate(fixture)
    const first = fixture.observe()
    const second = fixture.observe()
    assert.equal(first?.stall_suppressed, false)
    assert.equal(agentLiveness(first).basis, 'process')
    assert.equal(deterministicStallCause(first, healthy), null)
    assert.equal(deterministicStallCause(second, first), fault)
    assert.equal(
      deterministicStallCause(second, {
        ...first!,
        open_call: { ...first!.open_call!, tool_use_id: 'different-launch' },
      }),
      null,
    )
  }
})

test('AC-10: absent identity, process table, or wrapper linkage never establishes live activity', () => {
  for (const mutate of [
    (f: ReturnType<typeof liveFixture>) => {
      f.live.relay_start_identity = null
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.live.child_start_identity = null
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.live.wrapper_record_path = 'runtime/logs/shell/../unrelated'
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.record.wrapper_process_identity = ''
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.table.get(102)!.ppid = 999
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.table.get(103)!.ppid = 999
    },
  ]) {
    const fixture = liveFixture()
    mutate(fixture)
    fixture.save()
    assert.equal(fixture.observe(), null)
  }
  const fixture = liveFixture()
  assert.equal(
    executorProcessActivity(
      fixture.root,
      fixture.invocation,
      fixture.now,
      null,
    ),
    null,
  )
})

test('AC-10: stale attempts, roles, invocations and pre-invocation launches cannot impersonate this worker', () => {
  for (const mutate of [
    (f: ReturnType<typeof liveFixture>) => {
      f.invocation.attempt++
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.invocation.invocation_id = 'different'
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.invocation.run_id = 'different'
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.live.role = 'tester'
    },
    (f: ReturnType<typeof liveFixture>) => {
      f.live.launched_at = new Date(f.now - 120_000).toISOString()
    },
  ]) {
    const fixture = liveFixture()
    mutate(fixture)
    fixture.save()
    assert.equal(fixture.observe(), null)
  }
})

test('AC-10: PID reuse is a dead process fault and relay completion is never a terminal audit', () => {
  const fixture = liveFixture()
  fixture.table.get(102)!.lstart = 'reused-pid'
  const reused = fixture.observe()
  assert.equal(reused?.stall_suppressed, false)
  assert.equal(agentLiveness(reused).shell_fault, 'shell_dead')
  fixture.live.ended_at = new Date(fixture.now).toISOString()
  fixture.live.exit_code = 0
  fixture.save()
  assert.equal(fixture.observe(), null)
})

test('AC-10: a stopped wrapper preserves the deterministic stopped cause', () => {
  const fixture = liveFixture()
  fixture.table.get(101)!.stat = 'T'
  const first = fixture.observe()
  assert.equal(first?.stall_suppressed, false)
  assert.equal(
    deterministicStallCause(fixture.observe(), first),
    'shell_stopped',
  )
})

test('AC-10: an audit older than the latest launch cannot complete a relaunched worker', () => {
  const fixture = liveFixture()
  const auditPath = path.join(
    fixture.root,
    delegationExecutionPath(
      fixture.invocation.run_id,
      fixture.invocation.invocation_id,
      fixture.root,
    ),
  )
  mkdirSync(path.dirname(auditPath), { recursive: true })
  writeFileSync(
    auditPath,
    JSON.stringify({
      schema_version: 1,
      run_id: fixture.invocation.run_id,
      invocation_id: fixture.invocation.invocation_id,
      stage: 'implement',
      executor: 'copilot',
      recorded_at: new Date(fixture.now - 40_000).toISOString(),
      exit_code: 0,
      timed_out: false,
      session_id: 'old-session',
    }),
  )
  assert.equal(fixture.observe()?.stop, null)
  assert.equal(fixture.observe()?.stall_suppressed, true)

  const secondLaunch = { ...fixture.live, launch_id: 'same-time-relaunch' }
  writeFileSync(
    delegationLivePaths(fixture.root, secondLaunch).record,
    JSON.stringify(secondLaunch),
  )
  assert.equal(fixture.observe(), null)

  writeFileSync(
    auditPath,
    JSON.stringify({
      schema_version: 1,
      run_id: fixture.invocation.run_id,
      invocation_id: fixture.invocation.invocation_id,
      stage: 'implement',
      executor: 'copilot',
      recorded_at: new Date(fixture.now).toISOString(),
      exit_code: 0,
      timed_out: false,
      session_id: 'current-session',
    }),
  )
  assert.equal(fixture.observe()?.stop?.status, 'completed')
})

test('AC-10: future relay timestamps never establish live process activity', () => {
  for (const field of ['launched_at', 'heartbeat_at'] as const) {
    const fixture = liveFixture()
    fixture.live[field] = new Date(fixture.now + 60_000).toISOString()
    fixture.save()
    assert.equal(fixture.observe(), null)
  }
})
