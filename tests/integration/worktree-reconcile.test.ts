import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'

import {
  CLI,
  commitFile,
  createWorktree,
  git,
  runCli,
} from './worktree-helpers.js'

test('worktree reconcile merges each source and records the operator invocation', () => {
  const root = createFixture()
  const target = createWorktree(root, 'target')
  const sourceOne = createWorktree(root, 'source-one')
  const sourceTwo = createWorktree(root, 'source-two')

  commitFile(path.join(root, sourceOne.path), 'one.txt', 'one\n')
  commitFile(path.join(root, sourceTwo.path), 'two.txt', 'two\n')

  const result = runCli<{
    status: 'merged'
    target: string
    target_branch: string
    sources: string[]
    merged_sources: string[]
    conflicted_paths: string[]
    evidence_path: string
  }>(root, [
    'worktree',
    'reconcile',
    '--into',
    'target',
    '--source',
    'source-one',
    '--source',
    'source-two',
  ])

  assert.equal(result.target, 'target')
  assert.equal(result.target_branch, 'worktree/target')
  assert.deepEqual(result.sources, ['source-one', 'source-two'])
  assert.deepEqual(result.merged_sources, ['source-one', 'source-two'])
  assert.deepEqual(result.conflicted_paths, [])
  assert.equal(existsSync(path.join(root, target.path, 'one.txt')), true)
  assert.equal(existsSync(path.join(root, target.path, 'two.txt')), true)
  assert.equal(
    Number(
      git(path.join(root, target.path), [
        'rev-list',
        '--count',
        '--merges',
        'HEAD',
      ]).trim(),
    ),
    2,
  )

  const evidence = readFileSync(path.join(root, result.evidence_path), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { outcome: string })

  assert.equal(evidence[0].outcome, 'started')
  assert.equal(evidence[1].outcome, 'merged')
})

test('worktree reconcile merges into an existing branch through a recorded worktree', () => {
  const root = createFixture()
  const mainHead = git(root, ['rev-parse', 'HEAD']).trim()

  git(root, ['branch', 'integration', mainHead])

  const sourceOne = createWorktree(root, 'branch-source-one')
  const sourceTwo = createWorktree(root, 'branch-source-two')

  commitFile(path.join(root, sourceOne.path), 'one.txt', 'one\n')
  commitFile(path.join(root, sourceTwo.path), 'two.txt', 'two\n')

  const result = runCli<{
    status: 'merged'
    target: string
    target_branch: string
    merged_sources: string[]
  }>(root, [
    'worktree',
    'reconcile',
    '--into-branch',
    'integration',
    '--source',
    'branch-source-one',
    '--source',
    'branch-source-two',
  ])

  assert.equal(result.status, 'merged')
  assert.equal(result.target, 'integration')
  assert.equal(result.target_branch, 'integration')
  assert.deepEqual(result.merged_sources, [
    'branch-source-one',
    'branch-source-two',
  ])

  const listed = runCli<{
    worktrees: Array<{ name: string; branch: string }>
  }>(root, ['worktree', 'list'])
  const targetEntry = listed.worktrees.find(
    (entry) => entry.name === 'integration',
  )

  assert.ok(targetEntry)
  assert.equal(targetEntry.branch, 'integration')
  assert.equal(
    git(root, ['ls-tree', '--name-only', 'integration']).includes('one.txt'),
    true,
  )
  assert.equal(
    git(root, ['ls-tree', '--name-only', 'integration']).includes('two.txt'),
    true,
  )
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), mainHead)
})

test('worktree reconcile merges into the branch the main checkout holds', () => {
  const root = createFixture()
  const mainBranch = git(root, ['symbolic-ref', '--short', 'HEAD']).trim()
  const sourceOne = createWorktree(root, 'held-one')
  const sourceTwo = createWorktree(root, 'held-two')

  commitFile(path.join(root, sourceOne.path), 'one.txt', 'one\n')
  commitFile(path.join(root, sourceTwo.path), 'two.txt', 'two\n')

  const result = runCli<{
    status: 'merged'
    target: string
    target_branch: string
    target_kind: string
    target_path: string
    merged_sources: string[]
  }>(root, [
    'worktree',
    'reconcile',
    '--into-branch',
    mainBranch,
    '--source',
    'held-one',
    '--source',
    'held-two',
  ])

  assert.equal(result.status, 'merged')
  assert.equal(result.target, mainBranch)
  assert.equal(result.target_branch, mainBranch)
  assert.equal(result.target_kind, 'checkout')
  assert.equal(result.target_path, '.')
  assert.deepEqual(result.merged_sources, ['held-one', 'held-two'])

  // The main checkout stays on its branch, clean, with the merges applied.
  assert.equal(
    git(root, ['symbolic-ref', '--short', 'HEAD']).trim(),
    mainBranch,
  )
  assert.equal(git(root, ['status', '--porcelain=v1']), '')
  assert.equal(existsSync(path.join(root, 'one.txt')), true)
  assert.equal(existsSync(path.join(root, 'two.txt')), true)
  assert.equal(
    Number(git(root, ['rev-list', '--count', '--merges', 'HEAD']).trim()),
    2,
  )

  // No worktree is materialized for a branch a checkout already holds.
  const listed = runCli<{
    worktrees: Array<{ branch: string }>
  }>(root, ['worktree', 'list'])

  assert.equal(
    listed.worktrees.some((entry) => entry.branch === mainBranch),
    false,
  )
})

test('worktree reconcile refuses a dirty checkout that holds the target branch', () => {
  const root = createFixture()
  const mainBranch = git(root, ['symbolic-ref', '--short', 'HEAD']).trim()
  const sourceOne = createWorktree(root, 'dirty-held-one')
  const sourceTwo = createWorktree(root, 'dirty-held-two')

  commitFile(path.join(root, sourceOne.path), 'one.txt', 'one\n')
  commitFile(path.join(root, sourceTwo.path), 'two.txt', 'two\n')
  writeFileSync(path.join(root, 'uncommitted.txt'), 'operator work\n')

  const preHead = git(root, ['rev-parse', 'HEAD']).trim()
  const refused = spawnSync(
    process.execPath,
    [
      CLI,
      'worktree',
      'reconcile',
      '--into-branch',
      mainBranch,
      '--source',
      'dirty-held-one',
      '--source',
      'dirty-held-two',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WORKTREE_DIRTY/u)
  assert.match(refused.stderr, /holds branch/u)
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), preHead)
  assert.equal(
    readFileSync(path.join(root, 'uncommitted.txt'), 'utf8'),
    'operator work\n',
  )
})

test('a held-checkout conflict aborts only the conflicted merge', () => {
  const root = createFixture()
  const mainBranch = git(root, ['symbolic-ref', '--short', 'HEAD']).trim()
  const sourceOne = createWorktree(root, 'held-conflict-one')
  const sourceTwo = createWorktree(root, 'held-conflict-two')

  commitFile(path.join(root, sourceOne.path), 'one.txt', 'one\n')
  commitFile(path.join(root, sourceTwo.path), 'shared.txt', 'source\n')

  const preHead = commitFile(root, 'shared.txt', 'target\n')
  const conflicted = spawnSync(
    process.execPath,
    [
      CLI,
      'worktree',
      'reconcile',
      '--into-branch',
      mainBranch,
      '--source',
      'held-conflict-one',
      '--source',
      'held-conflict-two',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.equal(conflicted.status, 1)

  const result = JSON.parse(conflicted.stdout) as {
    status: 'conflict'
    target_kind: string
    merge_aborted: boolean
    merged_sources: string[]
    conflicted_source: string
    conflicted_paths: string[]
    conflict_request: string
  }

  assert.equal(result.status, 'conflict')
  assert.equal(result.target_kind, 'checkout')
  assert.equal(result.merge_aborted, true)
  assert.deepEqual(result.merged_sources, ['held-conflict-one'])
  assert.equal(result.conflicted_source, 'held-conflict-two')
  assert.deepEqual(result.conflicted_paths, ['shared.txt'])

  // The checkout retains the completed merge and aborts only the conflict.
  assert.notEqual(git(root, ['rev-parse', 'HEAD']).trim(), preHead)
  assert.equal(git(root, ['status', '--porcelain=v1']), '')
  assert.equal(readFileSync(path.join(root, 'shared.txt'), 'utf8'), 'target\n')
  assert.equal(readFileSync(path.join(root, 'one.txt'), 'utf8'), 'one\n')

  const request = readFileSync(path.join(root, result.conflict_request), 'utf8')

  assert.match(request, /aborted/u)
  assert.match(request, /--into <worktree>/u)
})
test('branch reconcile validates sources before creating its target worktree', () => {
  const root = createFixture()
  const mainHead = git(root, ['rev-parse', 'HEAD']).trim()

  git(root, ['branch', 'integration', mainHead])
  const sourceOne = createWorktree(root, 'source-one')
  createWorktree(root, 'source-two')

  const result = spawnSync(
    process.execPath,
    [
      CLI,
      'worktree',
      'reconcile',
      '--into-branch',
      'integration',
      '--source',
      'source-one',
      '--source',
      'missing-source',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    },
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /WORKTREE_NOT_FOUND/u)

  const listed = runCli<{
    worktrees: Array<{ name: string; branch: string }>
  }>(root, ['worktree', 'list'])

  assert.equal(
    listed.worktrees.some((entry) => entry.branch === 'integration'),
    false,
  )

  writeFileSync(path.join(root, sourceOne.path, 'dirty.txt'), 'dirty\n')

  const dirtyResult = spawnSync(
    process.execPath,
    [
      CLI,
      'worktree',
      'reconcile',
      '--into-branch',
      'integration',
      '--source',
      'source-one',
      '--source',
      'source-two',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    },
  )

  assert.notEqual(dirtyResult.status, 0)
  assert.match(dirtyResult.stderr, /WORKTREE_DIRTY/u)

  const afterDirty = runCli<{
    worktrees: Array<{ name: string; branch: string }>
  }>(root, ['worktree', 'list'])

  assert.equal(
    afterDirty.worktrees.some((entry) => entry.branch === 'integration'),
    false,
  )
})

test('worktree reconcile stops on conflict and writes a resolution request', () => {
  const root = createFixture()
  const target = createWorktree(root, 'conflict-target')
  const sourceOne = createWorktree(root, 'conflict-one')
  const sourceTwo = createWorktree(root, 'conflict-two')
  const targetPath = path.join(root, target.path)

  commitFile(targetPath, 'shared.txt', 'target\n')
  commitFile(path.join(root, sourceOne.path), 'shared.txt', 'source\n')
  commitFile(path.join(root, sourceTwo.path), 'other.txt', 'other\n')

  const conflicted = spawnSync(
    process.execPath,
    [
      CLI,
      'worktree',
      'reconcile',
      '--into',
      'conflict-target',
      '--source',
      'conflict-one',
      '--source',
      'conflict-two',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    },
  )

  assert.equal(conflicted.status, 1)

  const result = JSON.parse(conflicted.stdout) as {
    status: 'conflict'
    merged_sources: string[]
    conflicted_source: string
    conflicted_paths: string[]
    conflict_request: string
    evidence_path: string
  }

  assert.equal(result.status, 'conflict')
  assert.deepEqual(result.merged_sources, [])
  assert.equal(result.conflicted_source, 'conflict-one')
  assert.deepEqual(result.conflicted_paths, ['shared.txt'])
  assert.equal(existsSync(path.join(root, result.conflict_request)), true)

  const request = readFileSync(path.join(root, result.conflict_request), 'utf8')
  const evidence = readFileSync(path.join(root, result.evidence_path), 'utf8')

  assert.match(request, /`shared\.txt`/u)
  assert.match(request, /Not started: conflict-two/u)
  assert.match(evidence, /"outcome":"conflict"/u)
})
