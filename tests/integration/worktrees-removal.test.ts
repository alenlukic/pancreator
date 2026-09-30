import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createWorktree,
  listWorktrees,
  readWorktreeIndex,
  removeWorktree,
  sweepDiscardedWorktreeScratch,
  sweepWorktreeTestScratch,
  writeWorktreeIndex,
} from '../../src/lib/worktrees.js'
import { testScratchRoot } from '../../src/lib/test-scratch.js'
import { createFixture, writeJson } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

// A fixture clones this checkout's .gitignore, so scratch under a worktree is
// ignored and `git worktree remove` already deletes it with the checkout.
// Asserting the end state therefore proves nothing about the sweep. What the
// sweep adds is that the tree leaves the checkout by rename, before Git runs,
// and that the recursive unlink is left to a detached process.
test('the scratch sweep renames a test tree out of a live checkout', () => {
  const root = createFixture()
  const record = createWorktree(root, 'scratch-one')
  const worktreePath = path.join(root, record.path)
  const scratch = path.join(worktreePath, 'runtime', 'tmp', 'tests.noindex')

  mkdirSync(scratch, { recursive: true })
  writeFileSync(path.join(scratch, 'fixture'), 'temporary\n')

  const discarded = sweepWorktreeTestScratch(worktreePath)

  assert.ok(discarded)
  assert.equal(path.dirname(discarded), path.dirname(worktreePath))
  assert.match(path.basename(discarded), /^\..+-tests-\d+-\d+\.noindex$/u)
  // The checkout is still here, so only the rename explains the absence.
  assert.equal(existsSync(worktreePath), true)
  assert.equal(existsSync(scratch), false)
  // Nothing left to hand off reports nothing handed off.
  assert.equal(sweepWorktreeTestScratch(worktreePath), null)
})

// A configured root sits outside every checkout, so Git removal never reaches
// it. The sweep must find it through the worktree's own configuration and
// discard it beside itself, where the rename stays on one volume.
test('the scratch sweep discards a configured external root beside itself', () => {
  const root = createFixture()
  const record = createWorktree(root, 'scratch-external')
  const worktreePath = path.join(root, record.path)
  const base = createTestTempDirectory('pan-scratch-base-')

  writeJson(path.join(worktreePath, 'config_overrides.json'), {
    test_scratch: { root: base },
  })

  const scratch = testScratchRoot(worktreePath)

  assert.equal(path.dirname(scratch), base)
  mkdirSync(scratch, { recursive: true })
  writeFileSync(path.join(scratch, 'fixture'), 'temporary\n')

  const discarded = sweepWorktreeTestScratch(worktreePath)

  assert.ok(discarded)
  assert.equal(path.dirname(discarded), base)
  assert.match(path.basename(discarded), /^\..+-tests-\d+-\d+\.noindex$/u)
  assert.equal(existsSync(scratch), false)
})

test('removing a worktree hands its scratch to a detached remover', () => {
  const root = createFixture()
  const record = createWorktree(root, 'scratch-two')
  const worktreePath = path.join(root, record.path)
  const scratch = path.join(worktreePath, 'runtime', 'tmp', 'tests.noindex')

  mkdirSync(scratch, { recursive: true })
  writeFileSync(path.join(scratch, 'fixture'), 'temporary\n')

  const removed = removeWorktree(root, 'scratch-two')

  assert.equal(removed.removed_worktree, true)
  assert.equal(existsSync(worktreePath), false)
  // Without the sweep the tree would leave with the checkout and the result
  // would name no discard target.
  assert.ok(removed.discarded_test_scratch)
  assert.equal(
    path.dirname(removed.discarded_test_scratch),
    path.dirname(worktreePath),
  )
})

// A remover that dies with its session leaves a tree beside the worktrees
// root that no other cleanup visits, which is how 699 clones once collected.
test('a discarded scratch tree an earlier remover lost is handed off again', () => {
  const root = createFixture()
  const record = createWorktree(root, 'scratch-three')
  const parent = path.dirname(path.join(root, record.path))
  const orphan = path.join(parent, '.gone-tests-999999-1757900000000.noindex')

  mkdirSync(orphan, { recursive: true })
  writeFileSync(path.join(orphan, 'fixture'), 'temporary\n')

  // The sweep starts `rm -rf`, so it must select the trees its own rename
  // produced and nothing else that lives beside a worktree.
  assert.deepEqual(sweepDiscardedWorktreeScratch(parent), [orphan])
})

test('a removal that removes nothing keeps the record for the retry', () => {
  const root = createFixture()
  const record = createWorktree(root, 'unresolved-one')

  execFileSync('git', ['worktree', 'remove', '--force', record.path], {
    cwd: root,
    encoding: 'utf8',
  })
  mkdirSync(path.join(root, record.path), { recursive: true })

  assert.throws(
    () => removeWorktree(root, 'unresolved-one'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_UNRESOLVED',
  )

  assert.equal(readWorktreeIndex(root).worktrees.length, 1)

  rmSync(path.join(root, record.path), { recursive: true })

  const pruned = removeWorktree(root, 'unresolved-one')

  assert.equal(pruned.removed_worktree, false)
  assert.equal(pruned.pruned_index_entry, true)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)
})

test('an unresolvable repository root falls back to the workspace repository', () => {
  const root = createFixture()
  const record = createWorktree(root, 'fallback-one')
  const index = readWorktreeIndex(root)

  writeWorktreeIndex(root, {
    schema_version: 1,
    worktrees: index.worktrees.map((entry) => ({
      ...entry,
      repository_root: path.join(root, 'worktrees', 'operator', 'gone'),
    })),
  })

  const listed = listWorktrees(root)

  assert.equal(listed[0]?.registered, true)
  assert.equal(listed[0]?.orphaned, false)

  execFileSync('git', ['worktree', 'remove', '--force', record.path], {
    cwd: root,
    encoding: 'utf8',
  })

  const orphaned = listWorktrees(root)

  assert.equal(orphaned[0]?.registered, false)
  assert.equal(orphaned[0]?.orphaned, true)
})

test('branch deletion removes a merged branch and refuses an unmerged one', () => {
  const merged = createFixture()
  const mergedRecord = createWorktree(merged, 'merged-one')
  const mergedResult = removeWorktree(merged, 'merged-one', {
    deleteBranch: true,
  })

  assert.equal(mergedResult.deleted_branch, mergedRecord.branch)
  assert.equal(mergedResult.kept_branch, undefined)
  assert.equal(
    execFileSync('git', ['branch', '--list', mergedRecord.branch], {
      cwd: merged,
      encoding: 'utf8',
    }).trim(),
    '',
  )

  const ahead = createFixture()
  const aheadRecord = createWorktree(ahead, 'ahead-one')
  const aheadPath = path.join(ahead, aheadRecord.path)

  writeFileSync(path.join(aheadPath, 'ahead.txt'), 'ahead\n')
  execFileSync('git', ['add', 'ahead.txt'], { cwd: aheadPath })
  execFileSync('git', ['commit', '-qm', 'ahead'], { cwd: aheadPath })

  const aheadResult = removeWorktree(ahead, 'ahead-one', {
    force: true,
    deleteBranch: true,
  })

  assert.equal(aheadResult.kept_branch, aheadRecord.branch)
  assert.match(
    aheadResult.branch_deletion_refused ?? '',
    /is not an ancestor of/u,
  )
  assert.notEqual(
    execFileSync('git', ['branch', '--list', aheadRecord.branch], {
      cwd: ahead,
      encoding: 'utf8',
    }).trim(),
    '',
  )
})
