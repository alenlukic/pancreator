import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { listWorktrees, reconcileWorktrees } from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'

import {
  CLI,
  commitFile,
  createWorktree,
  git,
  runCli,
  worktreeCheckpoint,
} from './worktree-helpers.js'

const TWO_SOURCES = ['source-one', 'source-two']

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
  const { root, mainHead } = worktreeCheckpoint('two-sources')

  git(root, ['branch', 'integration', mainHead])

  const result = reconcileWorktrees(
    root,
    { into_branch: 'integration' },
    TWO_SOURCES,
  )

  assert.equal(result.status, 'merged')
  assert.equal(result.target, 'integration')
  assert.equal(result.target_branch, 'integration')
  assert.deepEqual(result.merged_sources, TWO_SOURCES)

  const targetEntry = listWorktrees(root).find(
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
  const { root, mainBranch } = worktreeCheckpoint('two-sources')

  const result = reconcileWorktrees(
    root,
    { into_branch: mainBranch },
    TWO_SOURCES,
  )

  assert.equal(result.status, 'merged')
  assert.equal(result.target, mainBranch)
  assert.equal(result.target_branch, mainBranch)
  assert.equal(result.target_kind, 'checkout')
  assert.equal(result.target_path, '.')
  assert.deepEqual(result.merged_sources, TWO_SOURCES)

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

  // git creates no worktree for a branch a checkout already holds.
  assert.equal(
    listWorktrees(root).some((entry) => entry.branch === mainBranch),
    false,
  )
})

test('worktree reconcile refuses a dirty checkout that holds the target branch', () => {
  const { root, mainBranch, mainHead } = worktreeCheckpoint('two-sources')

  writeFileSync(path.join(root, 'uncommitted.txt'), 'operator work\n')

  assert.throws(
    () => reconcileWorktrees(root, { into_branch: mainBranch }, TWO_SOURCES),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'WORKTREE_DIRTY' &&
      /holds branch/u.test(error.message),
  )
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), mainHead)
  assert.equal(
    readFileSync(path.join(root, 'uncommitted.txt'), 'utf8'),
    'operator work\n',
  )
})

test('a held-checkout conflict aborts only the conflicted merge', () => {
  const { root, mainBranch, mainHead: preHead } = worktreeCheckpoint('conflict')

  const result = reconcileWorktrees(
    root,
    { into_branch: mainBranch },
    TWO_SOURCES,
  )

  assert.equal(result.status, 'conflict')
  assert.equal(result.target_kind, 'checkout')
  assert.equal(result.merge_aborted, true)
  assert.deepEqual(result.merged_sources, ['source-one'])
  assert.equal(result.conflicted_source, 'source-two')
  assert.deepEqual(result.conflicted_paths, ['shared.txt'])

  // The checkout retains the completed merge and aborts only the conflict.
  assert.notEqual(git(root, ['rev-parse', 'HEAD']).trim(), preHead)
  assert.equal(git(root, ['status', '--porcelain=v1']), '')
  assert.equal(readFileSync(path.join(root, 'shared.txt'), 'utf8'), 'target\n')
  assert.equal(readFileSync(path.join(root, 'one.txt'), 'utf8'), 'one\n')

  assert.ok(result.conflict_request)

  const request = readFileSync(path.join(root, result.conflict_request), 'utf8')

  assert.match(request, /aborted/u)
  assert.match(request, /--into <worktree>/u)
})

test('branch reconcile validates sources before creating its target worktree', () => {
  const { root, mainHead, worktrees } = worktreeCheckpoint('two-sources')

  git(root, ['branch', 'integration', mainHead])

  assert.throws(
    () =>
      reconcileWorktrees(root, { into_branch: 'integration' }, [
        'source-one',
        'missing-source',
      ]),
    (error: unknown) =>
      error instanceof PanError && error.code === 'WORKTREE_NOT_FOUND',
  )
  assert.equal(
    listWorktrees(root).some((entry) => entry.branch === 'integration'),
    false,
  )

  writeFileSync(
    path.join(root, worktrees['source-one'].path, 'dirty.txt'),
    'dirty\n',
  )

  assert.throws(
    () => reconcileWorktrees(root, { into_branch: 'integration' }, TWO_SOURCES),
    (error: unknown) =>
      error instanceof PanError && error.code === 'WORKTREE_DIRTY',
  )
  assert.equal(
    listWorktrees(root).some((entry) => entry.branch === 'integration'),
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
