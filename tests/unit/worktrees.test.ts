import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  readProjectConfig,
  worktreesConfig,
} from '../../src/lib/project-config.js'
import {
  createWorktree,
  isWorktreeName,
  readWorktreeIndex,
  reconcileWorktrees,
  resolveWorkspacePathOrWorktree,
  writeWorktreeIndex,
  type WorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'

const MINIMAL_CONFIG = { schema_version: 1 }

/** Bare root for helpers that read only config.json and the worktree index. */
function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-worktrees-'))

  writeJson(path.join(root, 'config.json'), MINIMAL_CONFIG)

  return root
}

test('worktree names use lowercase words with single hyphens', () => {
  assert.equal(isWorktreeName('feature-one'), true)
  assert.equal(isWorktreeName('feature--one'), false)
  assert.equal(isWorktreeName('Feature-one'), false)
  assert.equal(isWorktreeName('63328_Aug-12-1196_5360f379'), false)
})

test('worktree config uses defaults and local overrides', () => {
  const root = createFixture()

  assert.deepEqual(worktreesConfig(root), {
    root: 'worktrees/operator',
    branch_prefix: 'worktree/',
    setup: [],
  })

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: {
      root: 'runtime/operator-worktrees',
      branch_prefix: 'task/',
      setup: ['node -e "process.exit(0)"'],
    },
  })

  assert.deepEqual(worktreesConfig(root), {
    root: 'runtime/operator-worktrees',
    branch_prefix: 'task/',
    setup: ['node -e "process.exit(0)"'],
  })
})

test('project config rejects malformed worktree settings', () => {
  const root = scratchRoot()
  const configPath = path.join(root, 'config.json')
  const config: Record<string, unknown> = MINIMAL_CONFIG

  const rejected: Array<[unknown, RegExp]> = [
    ['runtime/worktrees', /config\.json\.worktrees MUST be an object/u],
    [{ root: '' }, /worktrees\.root MUST be a non-empty repository-relative/u],
    [{ root: 7 }, /worktrees\.root MUST be a non-empty repository-relative/u],
    [
      { root: '/tmp/worktrees' },
      /worktrees\.root MUST be a non-empty repository-relative/u,
    ],
    [
      { root: '../outside' },
      /worktrees\.root MUST be a non-empty repository-relative/u,
    ],
    [
      { branch_prefix: 'not valid' },
      /worktrees\.branch_prefix MUST be a non-empty string without whitespace/u,
    ],
    [
      { branch_prefix: '' },
      /worktrees\.branch_prefix MUST be a non-empty string without whitespace/u,
    ],
    [{ setup: 'npm ci' }, /worktrees\.setup MUST be an array/u],
    [
      { setup: ['npm ci', ''] },
      /worktrees\.setup\[1\] MUST be a non-empty command string/u,
    ],
  ]

  for (const [worktrees, message] of rejected) {
    writeJson(configPath, { ...config, worktrees })

    assert.throws(() => readProjectConfig(root), message)
  }

  writeJson(configPath, {
    ...config,
    worktrees: { root: 'runtime/operator-worktrees', branch_prefix: 'task/' },
  })

  assert.equal(readProjectConfig(root)?.schema_version, 1)
})

test('worktree index round-trips through its atomic writer', () => {
  const root = scratchRoot()
  const index: WorktreeIndex = {
    schema_version: 1,
    worktrees: [
      {
        name: 'feature-one',
        path: 'worktrees/operator/feature-one',
        branch: 'worktree/feature-one',
        created_from: '0123456789abcdef',
        description: 'Feature one',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  }

  writeWorktreeIndex(root, index)

  assert.deepEqual(readWorktreeIndex(root), index)

  const indexPath = path.join(root, 'worktrees', 'operator', 'index.json')

  assert.match(readFileSync(indexPath, 'utf8'), /\n$/u)

  writeFileSync(
    indexPath,
    '{"schema_version":1,"worktrees":[{"name":"bad name"}]}\n',
  )

  assert.throws(() => readWorktreeIndex(root), /MUST be a non-empty string/u)
})

test('reconcile validates its target and source arguments before any merge', () => {
  const root = scratchRoot()

  assert.throws(
    () => reconcileWorktrees(root, {}, ['one', 'two']),
    /exactly one of --into or --into-branch/u,
  )
  assert.throws(
    () =>
      reconcileWorktrees(root, { into: 'target', into_branch: 'main' }, [
        'one',
        'two',
      ]),
    /exactly one of --into or --into-branch/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one']),
    /at least two --source worktrees/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one', 'one']),
    /MUST be unique/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one', 'target']),
    /MUST NOT also be a source/u,
  )
})

test('workspace specifiers pass paths through and resolve recorded names', () => {
  const root = scratchRoot()

  assert.equal(
    resolveWorkspacePathOrWorktree(root, 'nested/project'),
    'nested/project',
  )
  assert.equal(resolveWorkspacePathOrWorktree(root, 'unknown'), 'unknown')

  writeWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [
      {
        name: 'alpha',
        path: 'runtime/worktrees/operator/alpha',
        branch: 'worktree/alpha',
        created_from: '0123456789abcdef',
        description: 'Alpha',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  })

  assert.equal(
    resolveWorkspacePathOrWorktree(root, 'alpha'),
    'runtime/worktrees/operator/alpha',
  )
})

test('legacy operator index remains active when the current index is absent', () => {
  const root = createFixture()
  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, {
    schema_version: 1,
    worktrees: [
      {
        name: 'legacy-one',
        path: 'runtime/worktrees/operator/legacy-one',
        branch: 'worktree/legacy-one',
        created_from: '0123456789abcdef',
        description: 'Legacy record',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  })

  assert.deepEqual(readWorktreeIndex(root).worktrees[0]?.name, 'legacy-one')

  const currentIndexPath = path.join(
    root,
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(currentIndexPath), { recursive: true })
  writeJson(currentIndexPath, { schema_version: 1, worktrees: [] })

  assert.throws(
    () => readWorktreeIndex(root),
    /Both operator worktree indexes exist/u,
  )
})

test('new worktrees use the current root when the legacy index is active', () => {
  const root = createFixture()
  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, { schema_version: 1, worktrees: [] })

  const record = createWorktree(root, 'fresh')

  assert.equal(record.path, 'worktrees/operator/fresh')
  assert.equal(readWorktreeIndex(root).worktrees[0]?.path, record.path)
})

test('a declared operator root keeps new worktrees where the operator put them', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: { root: 'runtime/worktrees/operator' },
  })

  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, { schema_version: 1, worktrees: [] })

  const record = createWorktree(root, 'pinned')

  assert.equal(record.path, 'runtime/worktrees/operator/pinned')
  assert.equal(readWorktreeIndex(root).worktrees[0]?.path, record.path)
})
