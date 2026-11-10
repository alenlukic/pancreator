import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import { isRecord } from '../../src/lib/io.js'
import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist/src/cli.js')

test('happy_path: canonical reminder CLI smoke supports stable reads and visible stale recovery', () => {
  const root = createFixture()
  const args = [
    'governance',
    'reminder',
    '--host',
    'vscode',
    '--provider',
    'openai',
    '--session',
    'vscode-openai-smoke',
    '--role',
    'pair',
  ]
  const run = (extra: string[] = []) =>
    spawnSync(process.execPath, [CLI, ...args, ...extra], {
      cwd: root,
      env: { ...process.env, PANCREATOR_ROOT: root },
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    })
  const first = run()

  assert.equal(first.status, 0, first.stderr)
  const reminder: unknown = JSON.parse(first.stdout)
  assert.ok(isRecord(reminder))
  assert.equal(reminder.schema_version, 1)
  assert.equal(typeof reminder.identity, 'string')
  assert.equal(typeof reminder.content, 'string')
  assert.equal(typeof reminder.deferred_content, 'string')
  assert.ok(isRecord(reminder.scope))
  assert.equal(reminder.scope.host, 'vscode')
  assert.equal(reminder.scope.provider, 'openai')
  assert.equal(reminder.scope.session, 'vscode-openai-smoke')
  assert.equal(reminder.scope.role, 'pair')
  assert.equal(run().stdout, first.stdout)

  const expected = run(['--expect', String(reminder.identity)])
  assert.equal(expected.status, 0, expected.stderr)
  assert.equal(expected.stdout, first.stdout)

  const stale = run(['--expect', '0'.repeat(64)])
  assert.equal(stale.status, 1)
  assert.match(stale.stdout + stale.stderr, /STALE_CANONICAL_REMINDER/u)
  assert.equal(run().stdout, first.stdout)
})
