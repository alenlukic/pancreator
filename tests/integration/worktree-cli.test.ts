import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture, writeJson } from '../helpers.js'

import {
  CLI,
  commitFile,
  createWorktree,
  git,
  runCli,
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
  assert.equal(alpha.branch, 'worktree/alpha')
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
  assert.equal(listedAlpha.branch, 'worktree/alpha')
  assert.equal(listedAlpha.created_from, mainHead)
  assert.equal(listedAlpha.description, 'Primary feature work')
  assert.equal(typeof listedAlpha.created_at, 'string')
  assert.equal(listedAlpha.current_commit, alphaCommit)
  assert.equal(listedAlpha.dirty, false)
  assert.equal(listedAlpha.registered, true)

  const initialized = runCli<{
    run_id: string
    workspace_root: string
  }>(root, ['init', '--request', 'request.md', '--worktree', 'alpha'])
  const state = JSON.parse(
    readFileSync(
      resolveRunLayout(root, initialized.run_id).state.absolute,
      'utf8',
    ),
  ) as { workspace_root: string }

  assert.equal(initialized.workspace_root, alpha.path)
  assert.equal(state.workspace_root, alpha.path)
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), mainHead)
  assert.equal(
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    mainStatus,
  )
})

test('init --worktree creates a missing worktree and setup commands prepare it', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: {
      setup: [`node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"`],
    },
  })

  const initialized = runCli<{
    run_id: string
    workspace_root: string
  }>(root, ['init', '--request', 'request.md', '--worktree', 'fresh'])

  assert.equal(initialized.workspace_root, 'worktrees/operator/fresh')
  assert.equal(
    existsSync(path.join(root, initialized.workspace_root, 'setup-ran.txt')),
    true,
  )

  const listed = runCli<{
    worktrees: Array<{ name: string; branch: string }>
  }>(root, ['worktree', 'list'])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['fresh'],
  )

  const conflicting = spawnSync(
    process.execPath,
    [
      CLI,
      'init',
      '--request',
      'request.md',
      '--worktree',
      'fresh',
      '--workspace',
      '.',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /cannot be used together/u)
})

test('worktree remove refuses dirty files unless force is explicit and keeps the branch', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'removable')
  const worktreePath = path.join(root, worktree.path)

  writeFileSync(path.join(worktreePath, 'dirty.txt'), 'uncommitted\n')

  const refused = spawnSync(
    process.execPath,
    [CLI, 'worktree', 'remove', 'removable', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    },
  )

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WORKTREE_DIRTY/u)
  assert.equal(existsSync(worktreePath), true)

  const removed = runCli<{
    status: 'removed'
    worktree: { removed_worktree: boolean; kept_branch: string }
  }>(root, ['worktree', 'remove', 'removable', '--force'])

  assert.equal(removed.worktree.removed_worktree, true)
  assert.equal(removed.worktree.kept_branch, 'worktree/removable')
  assert.equal(existsSync(worktreePath), false)
  assert.doesNotThrow(() =>
    git(root, ['show-ref', '--verify', 'refs/heads/worktree/removable']),
  )

  const stale = createWorktree(root, 'stale')

  rmSync(path.join(root, stale.path), { recursive: true, force: true })

  const pruned = runCli<{
    worktree: { removed_worktree: boolean; pruned_index_entry: boolean }
  }>(root, ['worktree', 'remove', 'stale'])

  assert.equal(pruned.worktree.removed_worktree, false)
  assert.equal(pruned.worktree.pruned_index_entry, true)

  const listed = runCli<{ worktrees: unknown[] }>(root, ['worktree', 'list'])

  assert.deepEqual(listed.worktrees, [])
  assert.equal(
    git(root, ['worktree', 'list', '--porcelain']).includes(
      path.join(root, stale.path),
    ),
    false,
  )
})
test('repository-check --worktree creates the worktree and runs inside it', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: {
        probes: [],
        commands: ['node -e "process.stdout.write(process.cwd())"'],
      },
    },
  })

  const result = runCli<{
    status: string
    workspace_root: string
    results: Array<{ kind: string; stdout: string }>
  }>(root, ['repository-check', 'fast', '--worktree', 'checks'])

  assert.equal(result.status, 'passed')
  assert.equal(path.basename(result.workspace_root), 'checks')
  assert.equal(
    result.results.find((entry) => entry.kind === 'command')?.stdout,
    path.resolve(result.workspace_root),
  )

  const listed = runCli<{
    worktrees: Array<{ name: string }>
  }>(root, ['worktree', 'list'])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['checks'],
  )

  const conflicting = spawnSync(
    process.execPath,
    [
      CLI,
      'repository-check',
      'fast',
      '--worktree',
      'checks',
      '--workspace',
      '.',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /cannot be used together/u)
})

test('technologies detect --worktree creates the worktree and scans inside it', () => {
  const root = createFixture()
  const baseline = runCli<{ languages: Array<{ id: string }> }>(root, [
    'technologies',
    'detect',
  ])

  assert.equal(
    baseline.languages.some((language) => language.id === 'python'),
    false,
  )

  const detection = runCli<{
    languages: Array<{ id: string; evidence: string[] }>
  }>(root, ['technologies', 'detect', '--worktree', 'tech'])
  const listed = runCli<{ worktrees: Array<{ name: string }> }>(root, [
    'worktree',
    'list',
  ])

  // The shared option created the missing worktree before detection ran.
  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['tech'],
  )

  writeFileSync(
    path.join(root, 'worktrees/operator/tech', 'requirements.txt'),
    'requests\n',
  )

  const targeted = runCli<{
    languages: Array<{ id: string; evidence: string[] }>
  }>(root, ['technologies', 'detect', '--worktree', 'tech'])

  assert.equal(
    detection.languages.some((language) => language.id === 'python'),
    false,
  )
  assert.deepEqual(
    targeted.languages.find((language) => language.id === 'python'),
    { id: 'python', evidence: ['requirements.txt'] },
  )
})

test('doctor --worktree points workspace diagnostics at the worktree', () => {
  const root = createFixture()

  // Doctor scans tests/ during repository validation, and the fixture does
  // not create that directory. This test asserts workspace targeting only,
  // not fixture validation health.
  mkdirSync(path.join(root, 'tests'), { recursive: true })

  const result = spawnSync(
    process.execPath,
    [CLI, 'doctor', '--worktree', 'diagnose', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )
  const doctor = JSON.parse(result.stdout) as {
    workspace: { root: string; worktree: string | null }
    git: { available_repository: boolean }
    repository_check_environment: { profiles_without_probes: string[] }
  }

  assert.equal(doctor.workspace.worktree, 'diagnose')
  assert.equal(doctor.workspace.root, 'worktrees/operator/diagnose')
  assert.equal(doctor.git.available_repository, true)
  assert.ok(
    doctor.repository_check_environment.profiles_without_probes.includes(
      'static',
    ),
  )

  const listed = runCli<{ worktrees: Array<{ name: string }> }>(root, [
    'worktree',
    'list',
  ])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['diagnose'],
  )
})

test('worktree resolve creates the worktree once and resolves it afterward', () => {
  const root = createFixture()
  const mainHead = git(root, ['rev-parse', 'HEAD']).trim()

  const resolved = runCli<{
    status: string
    created: boolean
    worktree: { name: string; path: string; branch: string }
  }>(root, ['worktree', 'resolve', 'utility', '--description', 'Utility work'])

  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.created, true)
  assert.equal(resolved.worktree.path, 'worktrees/operator/utility')
  assert.equal(resolved.worktree.branch, 'worktree/utility')
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

  const listed = runCli<{ worktrees: Array<{ name: string }> }>(root, [
    'worktree',
    'list',
  ])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['utility'],
  )
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), mainHead)

  const invalid = spawnSync(
    process.execPath,
    [CLI, 'worktree', 'resolve', 'Bad_Name', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /INVALID_WORKTREE_NAME/u)
})

test('commands without a selectable workspace reject the shared option', () => {
  const root = createFixture()
  const rejectedInvocations = [
    ['list'],
    ['worktree', 'list'],
    ['repository-check', 'validate'],
    ['governance', 'audit-directives'],
  ]

  for (const invocation of rejectedInvocations) {
    const refused = spawnSync(
      process.execPath,
      [CLI, ...invocation, '--worktree', 'nope', '--json'],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    )

    assert.notEqual(refused.status, 0, invocation.join(' '))
    assert.match(refused.stderr, /WORKTREE_OPTION_UNSUPPORTED/u)
    assert.match(refused.stderr, /technologies detect/u)
  }

  const validateRefused = spawnSync(
    process.execPath,
    [CLI, 'repository-check', 'validate', '--worktree', 'nope', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.match(validateRefused.stderr, /'pan repository-check validate'/u)

  // The rejection fires before resolution, so no worktree was created.
  const listed = runCli<{ worktrees: unknown[] }>(root, ['worktree', 'list'])

  assert.deepEqual(listed.worktrees, [])
})
