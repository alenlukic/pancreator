import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

test('bin/openai preserves the caller directory for .env discovery', () => {
  const repositoryRoot = process.cwd()
  const callerRoot = createTestTempDirectory('openai-wrapper-')
  const env = { ...process.env }

  delete env.OPENAI_API_KEY
  writeFileSync(
    path.join(callerRoot, '.env'),
    'OPENAI_API_KEY=sk-wrapper-test\n',
  )

  const result = spawnSync(
    path.join(repositoryRoot, 'bin', 'openai'),
    ['--doctor'],
    {
      cwd: callerRoot,
      env,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  )

  assert.equal(result.status, 0, result.stderr)

  const report = JSON.parse(result.stdout) as {
    key_available?: boolean
    source_path?: string
  }

  assert.equal(report.key_available, true)
  assert.equal(report.source_path, path.join(callerRoot, '.env'))
})
