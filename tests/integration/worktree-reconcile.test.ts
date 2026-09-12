import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  createWorktree as createWorktreeRecord,
  listWorktrees,
  reconcileWorktrees,
} from '../../src/lib/worktrees.js'

import { TWO_SOURCES, git, worktreeCheckpoint } from './worktree-helpers.js'

test('worktree reconcile merges each source and records the operator invocation', () => {
  const { root } = worktreeCheckpoint('two-sources')
  const target = createWorktreeRecord(root, 'target')
  const result = reconcileWorktrees(root, { into: 'target' }, TWO_SOURCES)

  assert.equal(result.status, 'merged')
  assert.equal(result.target, 'target')
  assert.equal(result.target_branch, 'target')
  assert.deepEqual(result.sources, TWO_SOURCES)
  assert.deepEqual(result.merged_sources, TWO_SOURCES)
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
