import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { readAgentActivity } from '../../src/lib/agent-index/activity.js'
import {
  handlePreToolUse,
  handleSubagentStart,
} from '../../src/lib/agent-index/hooks.js'
import { createTestTempDirectory } from '../temp.js'

function shellDirName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z-linktest`
  )
}

test('links an open shell call by conversation id', () => {
  const root = createTestTempDirectory('shell-link-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const agentId = 'worker-conv'
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agentId,
    conversation_id: 'parent',
    parent_conversation_id: 'parent',
    task: 'Read runtime/logs/workflows/run/agent/invocations/01_implement-1_x.md first.',
  })

  const recordStarted = new Date(Date.now() - 1_000)
  const shellDir = path.join(
    root,
    'runtime/logs/shell',
    shellDirName(new Date()),
  )
  mkdirSync(shellDir, { recursive: true })
  writeFileSync(
    path.join(shellDir, 'record.json'),
    `${JSON.stringify({
      schema_version: 1,
      label: 'bash',
      command: ['bash', '-c', 'sleep 60'],
      started_at: recordStarted.toISOString(),
      ended_at: null,
      pid: 100,
      wrapper_pid: 99,
      cursor_conversation_id: agentId,
      parent_record: null,
      wrapper_process_identity: 'Mon Oct  1 11:59:50 2026',
      heartbeat_seconds: 30,
    })}\n`,
  )
  writeFileSync(
    path.join(shellDir, 'heartbeat.json'),
    `${JSON.stringify({ log_bytes: 1, recent_lines: ['start'] })}\n`,
  )

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: agentId,
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'sleep 60' },
  })

  const activity = readAgentActivity(root, agentId, Date.now(), 60)
  assert.ok(activity?.open_call)
  assert.equal(activity.open_call.shell_link, 'conversation_id')
  assert.ok(activity.open_call.shell_heartbeat)
})
