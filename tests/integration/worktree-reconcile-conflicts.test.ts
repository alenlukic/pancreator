import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { reconcileWorktrees } from '../../src/lib/worktrees.js'

import {
  CLI,
  TWO_SOURCES,
  git,
  worktreeCheckpoint,
} from './worktree-helpers.js'

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

test('worktree reconcile stops on conflict and writes a resolution request', () => {
  const { root } = worktreeCheckpoint('target-conflict')

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
