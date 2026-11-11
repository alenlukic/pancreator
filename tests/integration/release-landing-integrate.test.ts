import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { gitCommit } from '../../src/lib/git/branches.js'
import { acquireLandingMutex } from '../../src/lib/landing-mutex.js'
import { landRelease } from '../../src/lib/release-landing.js'
import { squashFinalizedRelease } from '../../src/lib/release-landing/steps.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createTestTempDirectory } from '../temp.js'
import {
  advanceTip,
  commitReleasePair,
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
  assert.equal(git(workspace, ['rev-list', '--count', `${tip}..HEAD`]), '2')
  assert.equal(git(workspace, ['rev-parse', 'HEAD~2']), tip)
  assert.equal(
    git(workspace, ['show', 'HEAD~1:src/behind-tip.ts']),
    "export const marker = 'behind-tip'",
  )
  assert.equal(git(workspace, ['cat-file', '-t', head]), 'commit')
  assert.equal(
    git(workspace, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ]),
    'release/index.json',
  )
  const index = JSON.parse(
    git(workspace, ['show', 'HEAD:release/index.json']),
  ) as {
    releases: Array<{ version: string; commit: string }>
  }
  assert.equal(
    index.releases.find((entry) => entry.version === result.version)?.commit,
    result.release_commit,
  )
  for (const commit of ['HEAD', 'HEAD~1']) {
    assert.equal(
      git(workspace, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', commit]),
      'Fixture <fixture@example.com>|Fixture <fixture@example.com>',
    )
    assert.doesNotMatch(
      git(workspace, ['show', '-s', '--format=%B', commit]),
      /co-authored-by:/iu,
    )
  }
  const steps = readLandingLog(root).map((entry) => entry.step)
  assert.ok(steps.indexOf('integrate') >= 0)
  assert.ok(steps.indexOf('allocate') > steps.indexOf('integrate'))
})

test('commits use the configured operator and reject attribution trailers', () => {
  const root = landingFixture()
  const file = path.join(root, 'src', 'identity-test.ts')
  const names = [
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
  ] as const
  const previous = names.map((name) => process.env[name])
  try {
    for (const name of names) process.env[name] = 'other@example.com'
    writeFileSync(file, 'export const identity = true\n')
    git(root, ['add', 'src/identity-test.ts'])
    const commit = gitCommit(root, 'test: add identity fixture')
    assert.equal(
      git(root, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', commit]),
      'Fixture <fixture@example.com>|Fixture <fixture@example.com>',
    )
    writeFileSync(file, 'export const identity = false\n')
    git(root, ['add', 'src/identity-test.ts'])
    assert.throws(
      () =>
        gitCommit(
          root,
          'test: update fixture\n\nCo-authored-by: Someone <someone@example.com>',
        ),
      { code: 'GIT_COMMIT_ATTRIBUTION_FORBIDDEN' },
    )
    assert.equal(git(root, ['rev-parse', 'HEAD']), commit)
  } finally {
    names.forEach((name, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  }
})

test('a commit hook cannot silently add authorship attribution', () => {
  const root = landingFixture()
  const hooks = path.join(root, 'fixture-hooks')
  mkdirSync(hooks)
  git(root, ['config', 'core.hooksPath', hooks])
  const hook = path.join(hooks, 'commit-msg')
  writeFileSync(
    hook,
    '#!/bin/sh\nprintf "\\nCo-authored-by: Other <other@example.com>\\n" >> "$1"\n',
  )
  chmodSync(hook, 0o755)
  writeFileSync(path.join(root, 'src/hook.ts'), 'export const hook = true\n')
  git(root, ['add', 'src/hook.ts'])
  assert.throws(() => gitCommit(root, 'test: add hook fixture'), {
    code: 'GIT_COMMIT_IDENTITY_INVALID',
  })
  assert.match(
    git(root, ['show', '-s', '--format=%B', 'HEAD']),
    /Co-authored-by:/u,
  )
})

test('failed squash preparation restores the original release index', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'squash-recovery',
    '### Fixed\n\n- Preserve the candidate.',
  )
  const tip = git(root, ['rev-parse', 'pan-dev'])
  commitReleasePair(workspace, '99.0.0')
  const oldHead = git(workspace, ['rev-parse', 'HEAD'])
  const oldRelease = git(workspace, ['rev-parse', 'HEAD^'])
  const originalIndex = git(workspace, ['show', 'HEAD:release/index.json'])

  assert.throws(
    () =>
      squashFinalizedRelease(
        workspace,
        tip,
        '99.0.0',
        oldRelease,
        oldHead,
        () => {
          throw new Error('record failure')
        },
      ),
    /record failure/u,
  )
  assert.equal(git(workspace, ['rev-parse', 'HEAD']), oldHead)
  assert.equal(git(workspace, ['status', '--porcelain']), '')
  assert.equal(
    git(workspace, ['show', 'HEAD:release/index.json']),
    originalIndex,
  )
})

test('an existing pair is reused only with the operator identity and no attribution', () => {
  const root = landingFixture()
  const tip = git(root, ['rev-parse', 'pan-dev'])
  const workspace = path.join(root, createWorktree(root, 'existing-pair').path)
  commitReleasePair(workspace, '99.0.0')
  git(workspace, [
    'commit',
    '--amend',
    '--author=Other <other@example.com>',
    '-qm',
    'chore: index release v99.0.0\n\nCo-authored-by: Other <other@example.com>',
  ])
  const oldIndex = git(workspace, ['rev-parse', 'HEAD'])
  const oldRelease = git(workspace, ['rev-parse', 'HEAD^'])
  const pair = squashFinalizedRelease(
    workspace,
    tip,
    '99.0.0',
    oldRelease,
    oldIndex,
    () => {},
  )
  assert.notEqual(pair.indexCommit, oldIndex)
  assert.equal(git(workspace, ['rev-parse', 'HEAD~2']), tip)
  for (const commit of [pair.releaseCommit, pair.indexCommit]) {
    assert.equal(
      git(workspace, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', commit]),
      'Fixture <fixture@example.com>|Fixture <fixture@example.com>',
    )
    assert.doesNotMatch(
      git(workspace, ['show', '-s', '--format=%B', commit]),
      /co-authored-by:/iu,
    )
  }
  assert.deepEqual(
    squashFinalizedRelease(
      workspace,
      tip,
      '99.0.0',
      pair.releaseCommit,
      pair.indexCommit,
      () => {
        throw new Error('must reuse')
      },
    ),
    pair,
  )
})

test('squash preparation preserves a concurrent source edit', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'concurrent-edit',
    '### Fixed\n\n- Preserve source edits.',
  )
  const tip = git(root, ['rev-parse', 'pan-dev'])
  commitReleasePair(workspace, '99.0.0')
  const oldHead = git(workspace, ['rev-parse', 'HEAD'])
  const oldRelease = git(workspace, ['rev-parse', 'HEAD^'])
  const source = path.join(workspace, 'src/concurrent-edit.ts')
  assert.throws(
    () =>
      squashFinalizedRelease(
        workspace,
        tip,
        '99.0.0',
        oldRelease,
        oldHead,
        () => {
          writeFileSync(source, 'export const changed = true\n')
        },
      ),
    { code: 'LANDING_SQUASH_STATE_INVALID' },
  )
  assert.equal(git(workspace, ['rev-parse', 'HEAD']), oldHead)
  assert.equal(git(workspace, ['diff', '--cached', '--name-only']), '')
  assert.equal(
    git(workspace, ['status', '--porcelain']),
    'M src/concurrent-edit.ts',
  )
})

test('retry after a refused fast-forward preserves the squashed pair', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'retry-landing',
    '### Fixed\n\n- Retry release landing.',
  )
  const tip = git(root, ['rev-parse', 'pan-dev'])
  const hooks = path.join(root, 'fixture-hooks')
  mkdirSync(hooks)
  git(root, ['config', 'core.hooksPath', hooks])
  const hook = path.join(hooks, 'reference-transaction')
  writeFileSync(
    hook,
    '#!/bin/sh\nif [ "$1" = prepared ]; then\n  while read old new ref; do\n    if [ "$ref" = refs/heads/pan-dev ]; then exit 1; fi\n  done\nfi\nexit 0\n',
  )
  chmodSync(hook, 0o755)
  assert.throws(
    () => landRelease(root, { worktree: 'retry-landing', bump: 'patch' }),
    { code: 'LANDING_FAST_FORWARD_FAILED' },
  )
  const prepared = git(workspace, ['rev-parse', 'HEAD'])
  assert.equal(git(workspace, ['rev-parse', 'HEAD~2']), tip)
  unlinkSync(hook)
  const result = landRelease(root, { worktree: 'retry-landing', bump: 'patch' })
  assert.equal(result.status, 'landed')
  assert.equal(result.index_commit, prepared)
  assert.equal(result.tip_after, prepared)
  assert.equal(git(workspace, ['rev-list', '--count', `${tip}..HEAD`]), '2')
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
