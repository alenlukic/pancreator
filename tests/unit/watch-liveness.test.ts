import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentActivity } from '../../src/lib/agent-index/activity.js'
import type { TranscriptState } from '../../src/lib/agent-index/transcript.js'
import {
  agentLiveness,
  deterministicStallCause,
  quietStallApplies,
  workerActivityRefusal,
} from '../../src/lib/watch/liveness.js'

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
