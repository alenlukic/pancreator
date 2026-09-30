import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { shipHeadMatchesRelease } from '../../src/lib/validation.js'
import { createTestTempDirectory } from '../temp.js'

test('the ship head is the index commit, or a declared bounded repair above it', () => {
  const dir = createTestTempDirectory('ship-head-')
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const commit = (file: string, message: string): string => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), `${message}\n`)
    git('add', file)
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-qm',
      message,
    )

    return git('rev-parse', 'HEAD')
  }

  git('init', '-q')
  commit('VERSION', 'base')

  const indexCommit = commit('release/index.json', 'index')

  assert.equal(shipHeadMatchesRelease(dir, indexCommit, undefined), true)

  const fix = commit('tests/unit/stale.test.ts', 'repair')

  assert.equal(shipHeadMatchesRelease(dir, indexCommit, undefined), false)
  assert.equal(shipHeadMatchesRelease(dir, indexCommit, { commit: fix }), true)
  assert.equal(
    shipHeadMatchesRelease(dir, indexCommit, { commit: indexCommit }),
    false,
  )

  commit('src/lib/x.ts', 'source above the pair')

  assert.equal(
    shipHeadMatchesRelease(dir, indexCommit, {
      commit: git('rev-parse', 'HEAD'),
    }),
    false,
  )
})
