import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
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
import { recordWorkspaceAttribution } from '../../src/lib/workspace-attribution.js'
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

/** Record one `read-only-input` attribution against the checkout at `root`. */
function attributeReadOnlyInput(root: string, relativePath: string): void {
  recordWorkspaceAttribution(root, {
    workspacePath: root,
    runId: 'run-fixture',
    actingRole: 'operator',
    directive: 'Keep the design source I exported available to every stage.',
    disposition: 'read-only-input',
    paths: [relativePath],
    artifactPath: 'runtime/logs/workflows/run-fixture/evidence/directive-1.md',
  })
}

test('a new worktree receives every recorded read-only input the source holds', () => {
  const root = createFixture()

  writeFileSync(path.join(root, 'design-source.svg'), '<svg>source</svg>\n')
  attributeReadOnlyInput(root, 'design-source.svg')

  const carrying = createWorktreeRecord(root, 'carrying')
  const carriedPath = path.join(root, carrying.path, 'design-source.svg')

  assert.deepEqual(carrying.carried_paths, ['design-source.svg'])
  assert.equal(readFileSync(carriedPath, 'utf8'), '<svg>source</svg>\n')

  // A path no `read-only-input` record names is never carried.
  writeFileSync(path.join(root, 'unrecorded.txt'), 'operator scratch\n')

  const second = createWorktreeRecord(root, 'unrecorded-source')

  assert.deepEqual(second.carried_paths, ['design-source.svg'])
  assert.equal(
    existsSync(path.join(root, second.path, 'unrecorded.txt')),
    false,
  )

  // Placement never overwrites: once the repository tracks the path, the
  // checkout itself supplies it and the copy is skipped, so the new worktree
  // holds the committed content rather than the source checkout's edit.
  commitFile(root, 'design-source.svg', '<svg>committed</svg>\n')
  writeFileSync(path.join(root, 'design-source.svg'), '<svg>edited</svg>\n')

  const third = createWorktreeRecord(root, 'already-holding')

  assert.deepEqual(third.carried_paths, [])
  assert.equal(
    readFileSync(path.join(root, third.path, 'design-source.svg'), 'utf8'),
    '<svg>committed</svg>\n',
  )
})

test('a worktree holding only recorded read-only inputs is removed without --force', () => {
  const { root, worktrees } = worktreeCheckpoint('single')
  const worktreePath = path.join(root, worktrees.alpha.path)

  writeFileSync(
    path.join(worktreePath, 'design-source.svg'),
    '<svg>source</svg>\n',
  )
  attributeReadOnlyInput(root, 'design-source.svg')

  // Git still needs force to discard the file; the harness supplies it from
  // the exemption rather than asking the operator for it.
  const removed = removeWorktree(root, 'alpha')

  assert.equal(removed.removed_worktree, true)
  assert.equal(existsSync(worktreePath), false)
  assert.deepEqual(listWorktrees(root), [])
})

test('a blocking path alongside a recorded input refuses and names only the blocker', () => {
  const { root, worktrees } = worktreeCheckpoint('single')
  const worktreePath = path.join(root, worktrees.alpha.path)

  writeFileSync(path.join(worktreePath, 'design-source.svg'), '<svg/>\n')
  writeFileSync(
    path.join(worktreePath, 'unfinished.ts'),
    'export const a = 1\n',
  )
  attributeReadOnlyInput(root, 'design-source.svg')

  assert.throws(
    () => removeWorktree(root, 'alpha'),
    (error: unknown) => {
      assert.ok(error instanceof PanError)
      assert.equal(error.code, 'WORKTREE_DIRTY')
      assert.match(error.message, /- `unfinished\.ts` — no attribution record/u)
      assert.doesNotMatch(error.message, /design-source\.svg/u)

      return true
    },
  )

  assert.equal(existsSync(worktreePath), true)
  assert.equal(listWorktrees(root).length, 1)
})
test('impacted selection and requirements resolution accept the shared option', () => {
  const root = createFixture()

  // Both surfaces resolve a workspace, so both must pass the option gate.
  // `requirements run` already resolved a worktree and advertised the option
  // in its usage line while the gate refused it.
  for (const invocation of [
    ['tests', 'impacted'],
    ['requirements', 'run'],
  ]) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(invocation[0] as string, [
          ...invocation.slice(1),
          '--worktree',
          'alpha',
        ]),
      invocation.join(' '),
    )
  }

  // A sibling subcommand of each family that selects no workspace still
  // refuses, so the gate widened by exactly the two surfaces.
  for (const invocation of [
    ['tests', 'tune'],
    ['requirements', 'scaffold'],
  ]) {
    assert.throws(
      () =>
        assertWorktreeOptionSupported(invocation[0] as string, [
          ...invocation.slice(1),
          '--worktree',
          'alpha',
        ]),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'WORKTREE_OPTION_UNSUPPORTED',
      invocation.join(' '),
    )
  }

  assert.match(
    execFileSync(process.execPath, [CLI, 'help'], {
      cwd: root,
      encoding: 'utf8',
    }),
    /pan tests impacted \[--worktree <name>\]/u,
  )
})
