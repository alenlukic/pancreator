import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { landingBuildCurrency } from '../../src/lib/release-landing/verification.js'
import { createTestTempDirectory } from '../temp.js'
import { git } from './release-landing-helpers.js'

function commit(cwd: string, message: string): string {
  git(cwd, [
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    message,
  ])

  return git(cwd, ['rev-parse', 'HEAD'])
}

function repository(): { root: string; base: string; tip: string } {
  const root = createTestTempDirectory('landing-build-currency-')

  git(root, ['init', '-q', '-b', 'pan-dev'])

  const base = commit(root, 'base')
  const tip = commit(root, 'tip')

  return { root, base, tip }
}

test('a build that lacks the pan-dev tip is refused with the rerun that fixes it', () => {
  const { root, base, tip } = repository()
  const stale = path.join(root, 'stale')
  const candidate = path.join(root, 'candidate')

  git(root, ['worktree', 'add', '-q', '--detach', stale, base])
  git(root, ['worktree', 'add', '-q', '--detach', candidate, tip])

  const refused = landingBuildCurrency(
    root,
    tip,
    candidate,
    'worktrees/operator/candidate',
    'candidate',
    stale,
  )

  assert.ok(refused)
  assert.equal(refused.executing_head, base)
  assert.equal(refused.candidate_has_tip, true)
  assert.match(refused.reason, /^LANDING_BUILD_BEHIND_TIP: /u)
  assert.match(
    refused.reason,
    /PANCREATOR_EXEC_ROOT=worktrees\/operator\/candidate \.\/bin\/pan release land --worktree candidate/u,
  )
  assert.doesNotMatch(refused.reason, /Merge pan-dev/u)
})

test('a candidate that also lacks the tip is told to merge pan-dev first', () => {
  const { root, base, tip } = repository()
  const stale = path.join(root, 'stale')

  git(root, ['worktree', 'add', '-q', '--detach', stale, base])

  const refused = landingBuildCurrency(
    root,
    tip,
    stale,
    'worktrees/operator/stale',
    'stale',
    stale,
  )

  assert.ok(refused)
  assert.equal(refused.candidate_has_tip, false)
  assert.match(
    refused.reason,
    /Merge pan-dev into it first \(git -C worktrees\/operator\/stale merge pan-dev\)/u,
  )
})

test('a build at or past the tip, or outside this repository, may land', () => {
  const { root, tip } = repository()
  const ahead = path.join(root, 'ahead')

  git(root, ['worktree', 'add', '-q', '-b', 'ahead', ahead, tip])
  commit(ahead, 'candidate change')

  assert.equal(landingBuildCurrency(root, tip, ahead, 'a', 'a', root), null)
  assert.equal(landingBuildCurrency(root, tip, ahead, 'a', 'a', ahead), null)

  const elsewhere = repository().root

  assert.equal(
    landingBuildCurrency(root, tip, ahead, 'a', 'a', elsewhere),
    null,
  )
  assert.equal(landingBuildCurrency(root, tip, ahead, 'a', 'a', null), null)
})
