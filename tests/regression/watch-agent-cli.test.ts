/**
 * `pan watch --agent` routes by the positional run id (AC-006): with a run id
 * it names the worker's agent for a run-scoped watch, and without one it is
 * the standalone agent watch. Also covers the stall-evidence line a stalled
 * verdict prints, so a supervisor reading stdout sees the open call and
 * linked `bin/pan-run` heartbeat the verdict rests on without opening a file.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getOpenCall,
  handlePreToolUse,
  handleSubagentStart,
} from '../../src/lib/agent-index.js'
import { CADENCE_SECONDS, preparedRun } from '../integration/watch-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

// Both cases refuse before the watch writes anything, so they run against
// this checkout's own root.
function pan(args: string[]): {
  status: number | null
  body: { error?: string }
} {
  const env = { ...process.env }
  delete env.PANCREATOR_ROOT

  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 20_000,
  })

  return {
    status: result.status,
    body: JSON.parse(result.stderr) as { error?: string },
  }
}

test('AC-006: pan watch <run-id> --agent <name> takes the run-scoped route', () => {
  const result = pan(['watch', 'no-such-run', '--agent', 'pan-coder'])

  assert.equal(result.status, 1)
  assert.equal(result.body.error, 'RUN_NOT_FOUND')
})

test('AC-006: pan watch --agent <id> without a run id is the standalone form', () => {
  const result = pan(['watch', '--agent', 'bg-1', '--invocation', 'x'])

  assert.equal(result.status, 1)
  assert.equal(result.body.error, 'INVALID_ARGUMENT')
})

test('a stalled run-scoped watch prints the open shell call and its linked pan-run heartbeat', () => {
  const { root, state, invocationId } = preparedRun()
  const agent = 'shell-worker-1'

  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agent,
    parent_conversation_id: 'supervisor-session',
    task_text: `Read runtime/logs/workflows/${state.run_id}/agent/invocations/${invocationId}.md first.`,
  })
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agent,
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'npm test' },
  })

  const startedAt = getOpenCall(root, agent)?.timestamp as string
  const stamp = new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const recordDir = path.join(
    root,
    'runtime/logs/shell',
    `${stamp}-npm-cccc3333`,
  )

  mkdirSync(recordDir, { recursive: true })
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({
      started_at: startedAt,
      ended_at: null,
      label: 'npm',
      pid: 4444,
      command: ['npm', 'test'],
    }),
  )

  const heartbeatPath = path.join(recordDir, 'heartbeat.json')

  writeFileSync(
    heartbeatPath,
    JSON.stringify({
      elapsed_seconds: 600,
      log_bytes: 9,
      last_output_at: null,
      recent_lines: ['waiting'],
    }),
  )
  // Far older than two cadences below, so the link is found but does not
  // suppress the stall.
  const staleMs = (Date.now() - 10 * 60_000) / 1000

  utimesSync(heartbeatPath, staleMs, staleMs)

  const env = { ...process.env }

  delete env.PANCREATOR_ROOT

  const result = spawnSync(
    process.execPath,
    [
      CLI,
      'watch',
      state.run_id,
      '--cadence-seconds',
      String(CADENCE_SECONDS),
      '--cadence-directed-by-operator',
      'regression fixture',
      '--stall-wakes',
      '3',
      // The stall itself needs only 3 real wake cycles (well under a second
      // unloaded); this ceiling exists only so the process does not wait
      // forever if it never stalls. A tight ceiling here flaked under the
      // full suite's parallel test load, where a starved wake cycle can run
      // far slower than its cadence — this is a safety bound, not the
      // expected run time, so it costs nothing to leave it generous.
      '--timeout-seconds',
      '60',
    ],
    { cwd: root, encoding: 'utf8', timeout: 90_000 },
  )

  assert.equal(
    result.status,
    2,
    `expected a stall exit; stderr: ${result.stderr}`,
  )
  assert.match(result.stdout, /worker: open Shell since/u)
  assert.match(result.stdout, /pan-run npm pid=4444 record /u)
})
