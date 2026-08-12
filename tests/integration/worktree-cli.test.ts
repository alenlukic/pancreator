import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture, writeJson } from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface CreatedWorktree {
  status: 'created'
  worktree: {
    name: string
    path: string
    branch: string
    created_from: string
    description: string
    created_at: string
  }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

function runCli<T>(root: string, args: string[]): T {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    }),
  ) as T
}

function createWorktree(
  root: string,
  name: string,
  options: string[] = [],
): CreatedWorktree['worktree'] {
  return runCli<CreatedWorktree>(root, ['worktree', 'create', name, ...options])
    .worktree
}

function commitFile(
  worktreePath: string,
  filename: string,
  content: string,
): string {
  writeFileSync(path.join(worktreePath, filename), content)
  git(worktreePath, ['add', filename])
  git(worktreePath, ['commit', '-qm', `add ${filename}`])

  return git(worktreePath, ['rev-parse', 'HEAD']).trim()
}

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
  assert.equal(alpha.branch, 'pan-wt/alpha')
  assert.equal(alpha.path, 'runtime/worktrees/operator/alpha')
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
  assert.equal(listedAlpha.branch, 'pan-wt/alpha')
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
      path.join(
        root,
        'runtime',
        'logs',
        'workflows',
        initialized.run_id,
        'state.json',
      ),
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

  writeJson(path.join(root, 'config.local.json'), {
    worktrees: {
      setup: [`node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"`],
    },
  })

  const initialized = runCli<{
    run_id: string
    workspace_root: string
  }>(root, ['init', '--request', 'request.md', '--worktree', 'fresh'])

  assert.equal(initialized.workspace_root, 'runtime/worktrees/operator/fresh')
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
  assert.equal(removed.worktree.kept_branch, 'pan-wt/removable')
  assert.equal(existsSync(worktreePath), false)
  assert.doesNotThrow(() =>
    git(root, ['show-ref', '--verify', 'refs/heads/pan-wt/removable']),
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
  assert.equal(result.target_branch, 'pan-wt/target')
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
    path.join(root, 'runtime/worktrees/operator/tech', 'requirements.txt'),
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
  }

  assert.equal(doctor.workspace.worktree, 'diagnose')
  assert.equal(doctor.workspace.root, 'runtime/worktrees/operator/diagnose')
  assert.equal(doctor.git.available_repository, true)

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
  assert.equal(resolved.worktree.path, 'runtime/worktrees/operator/utility')
  assert.equal(resolved.worktree.branch, 'pan-wt/utility')
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
