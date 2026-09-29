/**
 * Run-scoped watches read the hook-fed agent index (AC-005).
 *
 * The agent index is fed with synthetic hook payloads; see
 * tests/unit/agent-index.test.ts for why.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index.js'
import {
  watchInvocation,
  watchInvocations,
  type WatchRecordEntry,
} from '../../src/lib/watch.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  multiplexedTargets,
  preparedRun,
} from './watch-helpers.js'

function registerWorker(
  root: string,
  runId: string,
  invocationId: string,
  agentId = 'worker-001',
): string {
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    parent_conversation_id: 'supervisor-session',
    task_text: `Read runtime/logs/workflows/${runId}/agent/invocations/${invocationId}.md first.`,
  })

  return agentId
}

function stopWorker(
  root: string,
  agentId: string,
  status: 'completed' | 'error' | 'aborted',
  withTranscript: boolean,
): void {
  const transcript = path.join(root, 'runtime', 'logs', `${agentId}.jsonl`)

  if (withTranscript) {
    writeFileSync(transcript, '{"role":"assistant"}\n')
  }

  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: agentId,
    status,
    agent_transcript_path: transcript,
  })
}

function lastWake(root: string, recordPath: string): WatchRecordEntry {
  const entries = readFileSync(path.join(root, recordPath), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as WatchRecordEntry)
    .filter((entry) => entry.event === 'wake')

  return entries.at(-1) as WatchRecordEntry
}

test('AC-005: a completed agent stop with the output present completes on agent_state', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  const agent = registerWorker(root, state.run_id, invocationId)
  stopWorker(root, agent, 'completed', true)

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })
  const wake = lastWake(root, result.record_path)

  assert.equal(result.state, 'completed')
  assert.equal(wake.terminal_basis, 'agent_state')
  assert.equal(wake.observation?.agent_activity?.agent_id, agent)
})

for (const [status, fill, reason] of [
  ['error', true, 'agent_stopped_error'],
  ['aborted', true, 'agent_stopped_aborted'],
  ['completed', false, 'agent_stopped_without_output'],
] as const) {
  test(`AC-005: an agent stop with status ${status} ${fill ? 'and' : 'but no'} output ends unverified (${reason})`, async () => {
    const { root, state, invocationId } = preparedRun()

    if (fill) {
      fillPreparedOutput(root, state)
    }

    const agent = registerWorker(root, state.run_id, invocationId)
    const result = await watchInvocation(root, state.run_id, {
      cadenceSeconds: CADENCE_SECONDS,
      ...fakeClock(),
      sleep: async () => {
        stopWorker(root, agent, status, true)
      },
    })

    assert.equal(result.state, 'unverified')
    assert.equal(lastWake(root, result.record_path).unverified_reason, reason)
  })
}

test('AC-005: the launch record handle resolves the watched agent', async () => {
  const { root, state } = preparedRun()
  fillPreparedOutput(root, state)
  // Registered without a task text, so only the handle can find it.
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'handle-only-agent',
  })
  stopWorker(root, 'handle-only-agent', 'error', true)

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    workerHandle: 'handle-only-agent',
    ...fakeClock(),
  })

  assert.equal(result.state, 'unverified')
  assert.equal(
    lastWake(root, result.record_path).unverified_reason,
    'agent_stopped_error',
  )
})

test('AC-005: an open agent call keeps a quiet worker from a stall verdict', async () => {
  const { root, state, invocationId } = preparedRun()
  const agent = registerWorker(root, state.run_id, invocationId)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Task',
    tool_use_id: 'tu-nested',
  })

  const quiet = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 3,
    timeoutSeconds: CADENCE_SECONDS * 6,
    ...fakeClock(),
  })

  assert.equal(quiet.state, 'timed_out', 'the open call suppressed the stall')

  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: agent,
    status: 'aborted',
  })
})

test('AC-005: a worker with no agent activity still stalls', async () => {
  const { root, state } = preparedRun()

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 3,
    timeoutSeconds: CADENCE_SECONDS * 6,
    ...fakeClock(),
  })

  assert.equal(result.state, 'stalled')
})

test('AC-005: a multiplexed wait ends unverified when one target agent stops with an error', async () => {
  const { root, targets } = multiplexedTargets(2)
  const [first, second] = targets

  assert.ok(first && second)
  registerWorker(root, first.runId, first.invocationId, 'multi-a')
  registerWorker(root, second.runId, second.invocationId, 'multi-b')
  stopWorker(root, 'multi-b', 'error', true)

  const result = await watchInvocations(
    root,
    targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      cadenceSeconds: CADENCE_SECONDS,
      untilTerminal: true,
      ...fakeClock(),
    },
  )

  assert.equal(result.state, 'unverified')
  assert.deepEqual(
    result.stalled.map((item) => item.invocation_id),
    [second.invocationId],
  )
})
