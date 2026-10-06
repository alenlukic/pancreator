import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const ADAPTER = path.join(process.cwd(), 'bin', 'pan-hook-adapter')

function runStop(root: string, payload: Record<string, unknown>): string {
  const result = spawnSync(
    ADAPTER,
    ['stop', 'pan-hook-platform-guidance', 'stop'],
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, PANCREATOR_ROOT: root },
    },
  )

  assert.equal(result.status, 0, result.stderr)

  return result.stdout.trim()
}

test('the VS Code Stop hook blocks while a session command runs, once', () => {
  const root = createTestTempDirectory('platform-guidance-hook-')
  const record = path.join(root, 'runtime/logs/shell/20261005T0000Z-npm-ab12')

  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'pancreator-v2-prototype' }),
  )
  mkdirSync(record, { recursive: true })
  writeFileSync(
    path.join(record, 'record.json'),
    JSON.stringify({
      label: 'npm',
      ended_at: null,
      host: 'vscode',
      host_session_id: 'session-1',
    }),
  )
  writeFileSync(path.join(record, 'heartbeat.json'), '{}')

  const blocked = JSON.parse(
    runStop(root, {
      hook_event_name: 'Stop',
      session_id: 'session-1',
      stop_hook_active: false,
    }),
  ) as { decision: string; reason: string }

  assert.equal(blocked.decision, 'block')
  assert.match(
    blocked.reason,
    /watch --shell runtime\/logs\/shell\/20261005T0000Z-npm-ab12/u,
  )
  assert.equal(
    runStop(root, {
      hook_event_name: 'Stop',
      session_id: 'session-1',
      stop_hook_active: true,
    }),
    '',
  )
})
