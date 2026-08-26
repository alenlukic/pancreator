import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  readProjectConfig,
  worktreesConfig,
} from '../../src/lib/project-config.js'
import {
  isWorktreeName,
  readWorktreeIndex,
  reconcileWorktrees,
  resolveWorkspacePathOrWorktree,
  writeWorktreeIndex,
  type WorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'

test('worktree names use lowercase words with single hyphens', () => {
  assert.equal(isWorktreeName('feature-one'), true)
  assert.equal(isWorktreeName('feature--one'), false)
  assert.equal(isWorktreeName('Feature-one'), false)
  assert.equal(isWorktreeName('63328_Aug-12-1196_5360f379'), false)
})

test('worktree config uses defaults and local overrides', () => {
  const root = createFixture()

  assert.deepEqual(worktreesConfig(root), {
    root: 'runtime/worktrees/operator',
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
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

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
  const root = createFixture()
  const index: WorktreeIndex = {
    schema_version: 1,
    worktrees: [
      {
        name: 'feature-one',
        path: 'runtime/worktrees/operator/feature-one',
        branch: 'worktree/feature-one',
        created_from: '0123456789abcdef',
        description: 'Feature one',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  }

  writeWorktreeIndex(root, index)

  assert.deepEqual(readWorktreeIndex(root), index)

  const indexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  assert.match(readFileSync(indexPath, 'utf8'), /\n$/u)

  writeFileSync(
    indexPath,
    '{"schema_version":1,"worktrees":[{"name":"bad name"}]}\n',
  )

  assert.throws(() => readWorktreeIndex(root), /MUST be a non-empty string/u)
})

test('reconcile validates its target and source arguments before any merge', () => {
  const root = createFixture()

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
  const root = createFixture()

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
