/**
 * A process that died before the watch armed reports the exit code its
 * `bin/pan-run` record holds (AC-008).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { watchProcess } from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'

test('AC-008: dead-at-arm path returns exited with numeric status when exit record holds integer code', async () => {
  const root = createTestTempDirectory('watch-process-dead-arm-')
  const recordDir = path.join(root, 'runtime', 'logs', 'shell', 'dead-001')
  const dead = spawnSync(process.execPath, ['-e', '0']).pid as number
  const startedAt = new Date(Date.now() - 1_000).toISOString()

  mkdirSync(recordDir, { recursive: true })
  // The field names bin/pan-run writes.
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({
      schema_version: 1,
      label: 'dead',
      command: ['test'],
      pid: dead,
      wrapper_pid: dead,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      exit_code: 42,
      signal: null,
    }),
  )

  const result = await watchProcess(root, {
    pid: dead,
    label: 'dead-arm',
    exitRecordPath: 'runtime/logs/shell/dead-001/record.json',
    cadenceSeconds: 0.1,
    timeoutSeconds: 1,
  })

  assert.equal(result.state, 'exited', `expected exited, got ${result.state}`)
  assert.equal(result.exit_status, 42)
})
