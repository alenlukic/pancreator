import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { acquireLandingMutex } from '../../src/lib/landing-mutex.js'
import { landRelease } from '../../src/lib/release-landing.js'
import { createTestTempDirectory } from '../temp.js'
import {
  advanceTip,
  git,
  landingFixture,
  makeCandidate,
  readLandingLog,
} from './release-landing-helpers.js'

test('two consecutive callers serialize and an unexpired holder is never stolen', () => {
  const root = createTestTempDirectory('mutex-concurrency-')
  mkdirSync(path.join(root, 'runtime/release'), { recursive: true })
  const first = acquireLandingMutex(
    root,
    { worktree: 'first', command: 'pan release land' },
    { waitSeconds: 0 },
  )
  assert.throws(
    () =>
      acquireLandingMutex(
        root,
        { worktree: 'second', command: 'pan release land' },
        { waitSeconds: 0 },
      ),
    { code: 'LANDING_MUTEX_TIMEOUT' },
  )
  first.release()
  const second = acquireLandingMutex(
    root,
    { worktree: 'second', command: 'pan release land' },
    { waitSeconds: 0 },
  )
  second.release()
})

test('a candidate behind pan-dev integrates metadata changes before allocating', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'behind-tip',
    '### Fixed\n\n- Refuse an unverified integration.',
  )
  const head = git(workspace, ['rev-parse', 'HEAD'])
  advanceTip(root)
  const tip = git(root, ['rev-parse', 'pan-dev'])
  const result = landRelease(root, { worktree: 'behind-tip', bump: 'patch' })
  assert.equal(result.status, 'landed')
  assert.notEqual(result.tip_after, head)
  assert.equal(result.tip_before, tip)
  assert.equal(git(workspace, ['rev-parse', 'HEAD']), result.tip_after)
  assert.equal(git(root, ['rev-parse', 'pan-dev']), result.tip_after)
  for (const ancestor of [head, tip]) {
    assert.equal(git(workspace, ['merge-base', ancestor, 'HEAD']), ancestor)
  }
  const steps = readLandingLog(root).map((entry) => entry.step)
  assert.ok(steps.indexOf('integrate') >= 0)
  assert.ok(steps.indexOf('allocate') > steps.indexOf('integrate'))
})

test('a dirty landing target is refused before allocation', () => {
  const root = landingFixture()
  makeCandidate(
    root,
    'dirty-target',
    '### Fixed\n\n- Refuse a dirty landing target.',
  )
  const target = path.join(root, 'target-checkout')
  git(root, ['worktree', 'add', '-q', target, 'pan-dev'])
  writeFileSync(
    path.join(target, 'src/dirty.ts'),
    'export const dirty = true\n',
  )
  assert.throws(
    () => landRelease(root, { worktree: 'dirty-target', bump: 'patch' }),
    { code: 'LANDING_TARGET_DIRTY' },
  )
  assert.equal(
    readLandingLog(root).some((entry) => entry.step === 'allocate'),
    false,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/release/landing.lock')),
    false,
  )
})
