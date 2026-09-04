import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory, testTempRoot } from '../temp.js'

const ROOT = process.cwd()
const TEMP_MODULE = path.join(ROOT, 'dist', 'tests', 'temp.js')

// Runs a child that allocates one fixture through the helper and reports
// where it landed, so the parent can observe the child's exit-time cleanup.
function allocateInChild(env: NodeJS.ProcessEnv): string {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createTestTempDirectory } from ${JSON.stringify(TEMP_MODULE)}; process.stdout.write(createTestTempDirectory('probe-'))`,
    ],
    { cwd: ROOT, encoding: 'utf8', env },
  )

  assert.equal(result.status, 0, result.stderr)

  return result.stdout
}

test('fixtures allocate under the runner directory when one is provided', () => {
  const runDirectory = createTestTempDirectory('fake-run-')
  const fixture = allocateInChild({
    ...process.env,
    PANCREATOR_TEST_TMP: runDirectory,
  })

  assert.equal(path.dirname(fixture), runDirectory)
  // The runner owns the run directory's lifetime, so the child leaves it.
  assert.equal(existsSync(fixture), true)
})

test('a file run outside the runner falls back to a per-process directory it removes on exit', () => {
  const env = { ...process.env }

  delete env.PANCREATOR_TEST_TMP

  const fixture = allocateInChild(env)
  const parent = path.dirname(fixture)

  assert.equal(path.dirname(parent), testTempRoot())
  assert.match(path.basename(parent), /^proc-/u)
  assert.equal(path.relative(ROOT, parent).startsWith('..'), false)
  assert.equal(existsSync(parent), false)
  assert.equal(
    readFileSync(path.join(testTempRoot(), 'package.json'), 'utf8'),
    '{}\n',
  )
})
