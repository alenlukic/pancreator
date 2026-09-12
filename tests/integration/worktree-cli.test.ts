import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { assertWorktreeOptionSupported } from '../../src/cli.js'
import { PanError } from '../../src/lib/errors.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  createWorktree as createWorktreeRecord,
  listWorktrees,
  removeWorktree,
} from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'

import {
  CLI,
  commitFile,
  createWorktree,
  git,
  runCli,
  worktreeCheckpoint,
} from './worktree-helpers.js'

test('worktree create, list, source selection, and targeted init preserve the main checkout', () => {
  const root = createFixture()
  const mainHead = git(root, ['rev-parse', 'HEAD']).trim()
  const mainStatus = git(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])

  const alpha = createWorktree(root, 'alpha', [
    '--description',
    'Primary feature work',
  ])
  const alphaPath = path.join(root, alpha.path)

  assert.equal(alpha.created_from, mainHead)
  assert.equal(alpha.branch, 'alpha')
  assert.equal(alpha.path, 'worktrees/operator/alpha')
  assert.equal(alpha.description, 'Primary feature work')
  assert.ok(git(root, ['worktree', 'list', '--porcelain']).includes(alphaPath))

  const dotGit = readFileSync(path.join(alphaPath, '.git'), 'utf8')

  assert.match(dotGit, /\/worktrees\//u)
  assert.equal(existsSync(path.join(alphaPath, '.git', 'objects')), false)

  git(root, ['branch', 'source-branch', mainHead])

  const fromBranch = createWorktree(root, 'from-branch', [
    '--from',
    'source-branch',
  ])
  const fromCommit = createWorktree(root, 'from-commit', ['--from', mainHead])
  const alphaCommit = commitFile(alphaPath, 'alpha.txt', 'alpha\n')
  const fromIndexed = createWorktree(root, 'from-indexed', ['--from', 'alpha'])

  assert.equal(
    git(path.join(root, fromBranch.path), ['rev-parse', 'HEAD']).trim(),
    mainHead,
  )
  assert.equal(
    git(path.join(root, fromCommit.path), ['rev-parse', 'HEAD']).trim(),
    mainHead,
  )
  assert.equal(
    git(path.join(root, fromIndexed.path), ['rev-parse', 'HEAD']).trim(),
    alphaCommit,
  )

  const listed = runCli<{
    status: 'listed'
    worktrees: Array<Record<string, unknown>>
  }>(root, ['worktree', 'list'])
  const listedAlpha = listed.worktrees.find((entry) => entry.name === 'alpha')

  assert.ok(listedAlpha)
  assert.equal(listedAlpha.branch, 'alpha')
  assert.equal(listedAlpha.created_from, mainHead)
  assert.equal(listedAlpha.description, 'Primary feature work')
  assert.equal(typeof listedAlpha.created_at, 'string')
  assert.equal(listedAlpha.current_commit, alphaCommit)
  assert.equal(listedAlpha.dirty, false)
  assert.equal(listedAlpha.registered, true)

  const resolvedExisting = runCli<{
    status: string
    created: boolean
    worktree: { path: string; description: string }
  }>(root, ['worktree', 'resolve', 'alpha'])

  assert.equal(resolvedExisting.status, 'resolved')
  assert.equal(resolvedExisting.created, false)
  assert.equal(resolvedExisting.worktree.path, alpha.path)
  assert.equal(resolvedExisting.worktree.description, 'Primary feature work')

  const resolved = runCli<{
    status: string
    created: boolean
    worktree: { name: string; path: string; branch: string }
  }>(root, ['worktree', 'resolve', 'utility', '--description', 'Utility work'])

  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.created, true)
  assert.equal(resolved.worktree.path, 'worktrees/operator/utility')
  assert.equal(resolved.worktree.branch, 'utility')
  assert.equal(
    existsSync(path.join(root, resolved.worktree.path, '.git')),
    true,
  )

  const again = runCli<{
    created: boolean
    worktree: { path: string; description: string }
  }>(root, ['worktree', 'resolve', 'utility'])

  assert.equal(again.created, false)
  assert.equal(again.worktree.path, resolved.worktree.path)
  assert.equal(again.worktree.description, 'Utility work')

  const listedAfterResolve = runCli<{ worktrees: Array<{ name: string }> }>(
    root,
    ['worktree', 'list'],
  )

  assert.ok(
    listedAfterResolve.worktrees.some((entry) => entry.name === 'utility'),
  )

  const invalid = spawnSync(
    process.execPath,
    [CLI, 'worktree', 'resolve', 'Bad_Name', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /INVALID_WORKTREE_NAME/u)

  const initialized = runCli<{
    run_id: string
    workspace_root: string
  }>(root, ['init', '--request', 'request.md', '--worktree', 'alpha'])
  const state = JSON.parse(
    readFileSync(
      resolveRunLayout(root, initialized.run_id).state.absolute,
      'utf8',
    ),
  ) as {
    workspace_root: string
    managed_worktree: { name: string; path: string; branch: string }
  }

  assert.equal(initialized.workspace_root, alpha.path)
  assert.equal(state.workspace_root, alpha.path)
  assert.deepEqual(state.managed_worktree, {
    name: 'alpha',
    path: alpha.path,
    branch: 'alpha',
  })
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), mainHead)
  assert.equal(
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    mainStatus,
  )

  const mismatched = spawnSync(
    process.execPath,
    [CLI, 'prepare', initialized.run_id, '--worktree', 'utility', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(mismatched.status, 0)
  assert.match(mismatched.stderr, /RUN_WORKTREE_MISMATCH/u)

  git(alphaPath, ['switch', '-c', 'alpha-temporary'])

  spawnSync(process.execPath, [CLI, 'prepare', initialized.run_id, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  })

  assert.equal(git(alphaPath, ['branch', '--show-current']).trim(), 'alpha')
})

test('worktree remove refuses dirty files unless force is explicit and keeps the branch', () => {
  const { root, worktrees } = worktreeCheckpoint('single')
  const worktree = worktrees.alpha
  const worktreePath = path.join(root, worktree.path)

  writeFileSync(path.join(worktreePath, 'dirty.txt'), 'uncommitted\n')

  assert.throws(
    () => removeWorktree(root, 'alpha'),
    (error: unknown) =>
      error instanceof PanError && error.code === 'WORKTREE_DIRTY',
  )
  assert.equal(existsSync(worktreePath), true)

  const removed = removeWorktree(root, 'alpha', { force: true })

  assert.equal(removed.removed_worktree, true)
  assert.equal(removed.kept_branch, 'alpha')
  assert.equal(existsSync(worktreePath), false)
  assert.doesNotThrow(() =>
    git(root, ['show-ref', '--verify', 'refs/heads/alpha']),
  )

  const stale = createWorktreeRecord(root, 'stale')

  rmSync(path.join(root, stale.path), { recursive: true, force: true })

  const pruned = removeWorktree(root, 'stale')

  assert.equal(pruned.removed_worktree, false)
  assert.equal(pruned.pruned_index_entry, true)
  assert.deepEqual(listWorktrees(root), [])
  assert.equal(
    git(root, ['worktree', 'list', '--porcelain']).includes(
      path.join(root, stale.path),
    ),
    false,
  )
})

test('commands without a selectable workspace reject the shared option', () => {
  const root = createFixture()

  for (const invocation of [
    ['list'],
    ['worktree', 'list'],
    ['repository-check', 'validate'],
    ['governance', 'audit-directives'],
  ]) {
    assert.throws(
      () =>
        assertWorktreeOptionSupported(invocation[0] as string, [
          ...invocation.slice(1),
          '--worktree',
          'nope',
        ]),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'WORKTREE_OPTION_UNSUPPORTED' &&
        /technologies detect/u.test(error.message),
      invocation.join(' '),
    )
  }

  assert.throws(
    () =>
      assertWorktreeOptionSupported('repository-check', [
        'validate',
        '--worktree',
        'nope',
      ]),
    /'pan repository-check validate'/u,
  )

  // The rejection fires before resolution, so no worktree was created.
  const listed = runCli<{ worktrees: unknown[] }>(root, ['worktree', 'list'])

  assert.deepEqual(listed.worktrees, [])
})
