/**
 * Subagent liveness regression (AC-06, AC-07): hook-fed activity drives watch holds.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
} from '../../src/lib/agent-index/hooks.js'
import { readWatchRecord, watchInvocation } from '../../src/lib/watch.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  preparedRun,
  stillWritingClock,
} from '../integration/watch-helpers.js'

function taskFor(runId: string, invocationId: string): string {
  return `Read runtime/logs/workflows/${runId}/agent/invocations/${invocationId}.md first.`
}

function registerChild(root: string, runId: string, invocationId: string) {
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'child-canonical',
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor(runId, invocationId),
  })
  return 'child-canonical'
}

test('the recorded hook sequence without a stop completes one cadence after activity stops', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  const agent = registerChild(root, state.run_id, invocationId)

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Read',
    tool_use_id: 'tu-read',
    tool_input: { path: 'README.md' },
  })
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: agent,
    tool_name: 'Read',
    tool_use_id: 'tu-read',
  })

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })

  assert.equal(watched.state, 'completed')
  assert.equal(watched.wakes, 1)
})

test('a watch armed while the worker still writes never completes on its first wake', async () => {
  const { root, state } = preparedRun()
  registerChild(root, state.run_id, state.current_invocation!.id)
  fillPreparedOutput(root, state)

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'child-canonical',
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'sleep 1' },
  })

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...stillWritingClock(root, state),
    timeoutSeconds: CADENCE_SECONDS * 3,
  })

  const wakeEntries = readWatchRecord(
    root,
    state.run_id,
    state.current_invocation!.id,
  ).filter((entry) => entry.event === 'wake')
  assert.ok(wakeEntries.length >= 1)
  for (const wake of wakeEntries.slice(0, 2)) {
    assert.ok(
      wake.completion_hold === 'agent_active' ||
        wake.completion_hold === 'output_unconfirmed' ||
        wake.completion_hold === 'agent_turn_open',
      wake.completion_hold ?? 'missing hold',
    )
  }
  assert.notEqual(watched.state, 'completed')
})

test('a turn_ended transcript completes the agent watch on agent_state at wake 0', async () => {
  const { root, state, invocationId } = preparedRun()
  const parentTranscript = path.join(root, 'parent.jsonl')
  writeFileSync(parentTranscript, '{}\n')
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'child-canonical',
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor(state.run_id, invocationId),
    transcript_path: parentTranscript,
  })

  const childDir = path.join(path.dirname(parentTranscript), 'subagents')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(
    path.join(childDir, 'child-canonical.jsonl'),
    '{"type":"turn_ended","status":"success"}\n',
  )

  fillPreparedOutput(root, state)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })

  assert.equal(watched.state, 'completed')
  assert.equal(watched.wakes, 0)
})
