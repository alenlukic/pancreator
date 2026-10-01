import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
} from '../../src/lib/agent-index/hooks.js'
import { submitOutput } from '../../src/lib/engine.js'
import {
  readWatchRecord,
  recordInvocationLaunch,
  watchAgent,
  watchInvocation,
  watchInvocations,
  WORKER_STILL_ACTIVE,
} from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  multiplexedTargets,
  preparedRun,
  writeAgentStateEvidence,
  writeTargetOutputPastCadence,
} from './watch-helpers.js'

function taskFor(runId: string, invocationId: string): string {
  return `Read runtime/logs/workflows/${runId}/agent/invocations/${invocationId}.md first.`
}

function registerWorker(
  root: string,
  runId: string,
  invocationId: string,
  agentId = 'worker-001',
): string {
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor(runId, invocationId),
  })
  return agentId
}

test('a non-success turn_ended transcript fails the agent watch', async () => {
  const root = createTestTempDirectory('transcript-error-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parentTranscript = path.join(root, 'parent.jsonl')
  writeFileSync(parentTranscript, '{}\n')
  const agentId = 'child-error'
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor('run-x', '01_implement-1_x'),
    transcript_path: parentTranscript,
  })
  const childDir = path.join(path.dirname(parentTranscript), 'subagents')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(
    path.join(childDir, `${agentId}.jsonl`),
    '{"type":"turn_ended","status":"error"}\n',
  )

  const agentWatch = await watchAgent(root, agentId, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })
  assert.equal(agentWatch.state, 'failed')
})

test('a success turn_ended transcript completes the agent watch on agent_state', async () => {
  const root = createTestTempDirectory('transcript-success-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parentTranscript = path.join(root, 'parent.jsonl')
  writeFileSync(parentTranscript, '{}\n')
  const agentId = 'child-success'
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor('run-x', '01_implement-1_x'),
    transcript_path: parentTranscript,
  })
  const childDir = path.join(path.dirname(parentTranscript), 'subagents')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(
    path.join(childDir, `${agentId}.jsonl`),
    '{"type":"assistant"}\n{"type":"turn_ended","status":"success"}\n',
  )

  const agentWatch = await watchAgent(root, agentId, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })
  assert.equal(agentWatch.state, 'completed')
  const lines = readFileSync(path.join(root, agentWatch.record_path), 'utf8')
    .trim()
    .split('\n')
  const last = JSON.parse(lines[lines.length - 1]) as {
    terminal_state?: string
    terminal_basis?: string
  }
  assert.equal(last.terminal_state, 'completed')
  assert.equal(last.terminal_basis, 'agent_state')
})

test('a non-success turn_ended transcript ends the run watch unverified', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  const parentTranscript = path.join(root, 'parent.jsonl')
  writeFileSync(parentTranscript, '{}\n')
  const agentId = 'child-error-run'
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor(state.run_id, invocationId),
    transcript_path: parentTranscript,
  })
  const childDir = path.join(path.dirname(parentTranscript), 'subagents')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(
    path.join(childDir, `${agentId}.jsonl`),
    '{"type":"turn_ended","status":"error"}\n',
  )

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })
  assert.equal(watched.state, 'unverified')
  const last = readWatchRecord(root, state.run_id, invocationId).at(-1)
  assert.equal(last?.unverified_reason, 'agent_stopped_error')
})

function launchedLongAgo(root: string, runId: string, invocationId: string) {
  recordInvocationLaunch(root, runId, invocationId, {
    launchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
  })
}

test('output plausibility without transcript holds wake 0 as output_unconfirmed', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  launchedLongAgo(root, state.run_id, invocationId)
  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    ...fakeClock(),
  })
  const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
    (entry) => entry.event === 'wake',
  )
  assert.equal(wakes[0]?.completion_hold, 'output_unconfirmed')
  assert.equal(watched.state, 'completed')
  assert.equal(watched.wakes, 1)
})

test('multiplexed watch holds wake 0 as output_unconfirmed without transcript', async () => {
  const { root, targets } = multiplexedTargets(2)
  for (const target of targets) {
    launchedLongAgo(root, target.runId, target.invocationId)
    writeTargetOutputPastCadence(root, target)
  }
  await watchInvocations(
    root,
    targets.map(({ runId, invocationId: id }) => ({ runId, invocationId: id })),
    { cadenceSeconds: CADENCE_SECONDS, ...fakeClock() },
  )
  const wakes = readWatchRecord(
    root,
    targets[0]!.runId,
    targets[0]!.invocationId,
  ).filter((entry) => entry.event === 'wake')
  assert.equal(wakes[0]?.completion_hold, 'output_unconfirmed')
})

test('agent_active never completes on a confirming wake', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  const agent = registerWorker(root, state.run_id, invocationId)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Read',
    tool_use_id: 'tu-read',
    tool_input: { path: 'README.md' },
  })

  const clock = fakeClock()
  let closed = false
  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    timeoutSeconds: CADENCE_SECONDS * 4,
    ...clock,
    sleep: async (ms) => {
      await clock.sleep(ms)
      if (!closed) {
        closed = true
        handlePostToolUse(root, {
          event: 'postToolUse',
          conversation_id: agent,
          tool_name: 'Read',
          tool_use_id: 'tu-read',
        })
      }
    },
  })

  const holds = readWatchRecord(root, state.run_id, invocationId)
    .filter((entry) => entry.event === 'wake')
    .map((entry) => entry.completion_hold)
  assert.ok(holds.includes('agent_active'))
  assert.equal(watched.state, 'completed')
})

test('agent-state completed still completes at once when the worker is quiet', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  registerWorker(root, state.run_id, invocationId)
  const evidencePath = writeAgentStateEvidence(root, state, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
    agentStateEvidence: evidencePath,
    ...fakeClock(),
  })
  assert.equal(watched.state, 'completed')
  assert.equal(watched.wakes, 0)
})

test('an open transcript turn blocks agent-state override', async () => {
  const { root, state, invocationId } = preparedRun()
  fillPreparedOutput(root, state)
  const parentTranscript = path.join(root, 'parent-open.jsonl')
  writeFileSync(parentTranscript, '{}\n')
  const agentId = 'child-open'
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: taskFor(state.run_id, invocationId),
    transcript_path: parentTranscript,
  })
  const childDir = path.join(path.dirname(parentTranscript), 'subagents')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(
    path.join(childDir, `${agentId}.jsonl`),
    '{"type":"user","message":{}}\n',
  )
  const evidencePath = writeAgentStateEvidence(root, state, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    timeoutSeconds: CADENCE_SECONDS * 3,
    agentState: 'completed',
    agentStateEvidence: evidencePath,
    ...fakeClock(),
  })

  const holds = readWatchRecord(root, state.run_id, invocationId)
    .filter((entry) => entry.event === 'wake')
    .map((entry) => entry.completion_hold)
  assert.ok(holds.length > 0)
  assert.ok(holds.every((hold) => hold === 'agent_turn_open'))
  assert.notEqual(watched.state, 'completed')
})

test('deterministic shell_dead stall on the second wake', async () => {
  const { root, state, invocationId } = preparedRun()
  const agent = registerWorker(root, state.run_id, invocationId)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Shell',
    tool_use_id: 'tu-dead',
    tool_input: { command: 'sleep 9' },
  })
  const recordStarted = new Date()
  const stamp = recordStarted
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z')
  const shellDir = path.join(root, `runtime/logs/shell/${stamp}-dead-fixture`)
  mkdirSync(shellDir, { recursive: true })
  writeFileSync(
    path.join(shellDir, 'record.json'),
    `${JSON.stringify({
      schema_version: 1,
      label: 'bash',
      command: ['bash', '-c', 'sleep 9'],
      started_at: recordStarted.toISOString(),
      ended_at: null,
      pid: 100,
      wrapper_pid: 999999999,
      cursor_conversation_id: agent,
      parent_record: null,
      wrapper_process_identity: null,
      heartbeat_seconds: 30,
    })}\n`,
  )
  writeFileSync(
    path.join(shellDir, 'heartbeat.json'),
    `${JSON.stringify({ log_bytes: 1, recent_lines: ['start'] })}\n`,
  )

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallTimeoutSeconds: CADENCE_SECONDS * 2,
    timeoutSeconds: CADENCE_SECONDS * 5,
    ...fakeClock(),
  })
  assert.equal(watched.state, 'stalled')
  const last = readWatchRecord(root, state.run_id, invocationId).at(-1)
  assert.equal(last?.stall_cause, 'shell_dead')
})

test('submit refuses WORKER_STILL_ACTIVE while the worker has an open call', () => {
  const { root, state, invocationId, outputPath } = preparedRun()
  fillPreparedOutput(root, state)
  const agent = registerWorker(root, state.run_id, invocationId)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Read',
    tool_use_id: 'tu-open',
    tool_input: { path: 'README.md' },
  })

  assert.throws(
    () => submitOutput(root, state.run_id, outputPath),
    (error: unknown) => {
      const failure = error as { code?: string }
      assert.equal(failure.code, WORKER_STILL_ACTIVE)
      return true
    },
  )
})
