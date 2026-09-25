import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('pan spend validates the reporting window before credential lookup', () => {
  const root = createFixture()
  const result = spawnSync(
    process.execPath,
    [CLI, 'spend', '--days', '0', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CURSOR_ADMIN_API_KEY: '',
        CURSOR_SESSION_TOKEN: '',
      },
    },
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INVALID_ARGUMENT/u)
  assert.match(result.stderr, /--days MUST be an integer from 1 to 365/u)
  assert.doesNotMatch(result.stderr, /CURSOR_ADMIN_API_KEY_MISSING/u)
})

test('pan spend reports a missing usage credential without starting a request', () => {
  const root = createFixture()
  const result = spawnSync(
    process.execPath,
    [CLI, 'spend', '--days', '14', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CURSOR_ADMIN_API_KEY: '',
        CURSOR_SESSION_TOKEN: '',
      },
    },
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CURSOR_USAGE_CREDENTIAL_MISSING/u)
  assert.doesNotMatch(result.stderr, /Authorization|Basic/u)
})
