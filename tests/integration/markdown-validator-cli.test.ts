import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveDefaultRepoRoot } from '../../src/lib/validators/markdown-validator.js'
import { createTestTempDirectory } from '../temp.js'

const VALIDATOR_ENTRY = fileURLToPath(
  new URL('../../src/lib/validators/markdown-validator.js', import.meta.url),
)
const VALIDATOR_WRAPPER = path.join(
  process.cwd(),
  'bin',
  'validate-chat-markdown',
)

/** A fresh Git repository and a nested subdirectory inside it, both as real paths. */
function createRepositoryWithSubdirectory(): {
  repoRoot: string
  subdirectory: string
} {
  const repoRoot = realpathSync(
    createTestTempDirectory('markdown-validator-repo-'),
  )
  const init = spawnSync('git', ['init', '--quiet'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })

  assert.equal(init.status, 0, init.stderr)

  const subdirectory = path.join(repoRoot, 'nested', 'deeper')
  mkdirSync(subdirectory, { recursive: true })

  return { repoRoot, subdirectory }
}

function runValidatorEntry(
  cwd: string,
  markdown: string,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [VALIDATOR_ENTRY], {
    cwd,
    input: markdown,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  })
}

test('resolveDefaultRepoRoot returns the Git top level of a subdirectory', () => {
  const { repoRoot, subdirectory } = createRepositoryWithSubdirectory()

  assert.equal(realpathSync(resolveDefaultRepoRoot(subdirectory)), repoRoot)
})

test('resolveDefaultRepoRoot falls back to the given directory outside any Git repository', () => {
  const outside = realpathSync(
    createTestTempDirectory('markdown-validator-outside-'),
  )

  assert.equal(resolveDefaultRepoRoot(outside), outside)
})

test('the validator entry reads standard input and defaults the repository root to the Git top level of its working directory', () => {
  const { repoRoot, subdirectory } = createRepositoryWithSubdirectory()
  const target = path.join(repoRoot, 'docs', 'file.md')

  const passing = runValidatorEntry(subdirectory, `[docs/file.md](${target})\n`)

  assert.equal(passing.status, 0, passing.stderr)
  assert.match(passing.stdout, /passed/u)

  const failing = runValidatorEntry(subdirectory, `[${target}](${target})\n`)

  assert.equal(failing.status, 1)
  assert.match(failing.stderr, /file_link\.display/u)
})

test('bin/validate-chat-markdown keeps the caller directory for the default root and a relative input file', () => {
  const { repoRoot, subdirectory } = createRepositoryWithSubdirectory()
  const target = path.join(repoRoot, 'docs', 'file.md')
  const runWrapper = (args: string[], input: string) =>
    spawnSync(VALIDATOR_WRAPPER, args, {
      cwd: subdirectory,
      input,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    })

  const passing = runWrapper([], `[docs/file.md](${target})\n`)

  assert.equal(passing.status, 0, passing.stderr)

  const failing = runWrapper([], `[${target}](${target})\n`)

  assert.equal(failing.status, 1)
  assert.match(failing.stderr, /file_link\.display/u)

  writeFileSync(path.join(subdirectory, 'note.md'), `[${target}](${target})\n`)
  const fromFile = runWrapper(['note.md'], '')

  assert.equal(fromFile.status, 1, fromFile.stderr)
  assert.match(fromFile.stderr, /file_link\.display/u)
})
