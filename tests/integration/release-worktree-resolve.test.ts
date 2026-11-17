import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  createWorktree,
  resolveReleaseWorktree,
  worktreeIndexHost,
  writeWorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'
import { git } from './release-preparation-helpers.js'

function seedNamedWorktree(root: string, name: string): string {
  const relative = path.join('worktrees', 'operator', name)

  mkdirSync(path.join(root, relative), { recursive: true })
  writeWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [
      {
        name,
        path: relative,
        branch: name,
        created_from: 'HEAD',
        description: 'fixture',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  })

  return relative
}

test('release worktree host is the invocation root when the index holds the name', () => {
  const root = createFixture()

  try {
    seedNamedWorktree(root, 'ship-one')

    assert.equal(worktreeIndexHost(root, 'ship-one'), path.resolve(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release worktree host is the parent installation when invoked from the named checkout', () => {
  const root = createFixture()

  try {
    const relative = seedNamedWorktree(root, 'ship-two')
    const checkout = path.join(root, relative)

    assert.equal(worktreeIndexHost(checkout, 'ship-two'), path.resolve(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing release worktree is not found rather than created', () => {
  const root = createFixture()

  try {
    assert.throws(
      () => resolveReleaseWorktree(root, 'never-made'),
      (error: unknown) =>
        error instanceof PanError && error.code === 'WORKTREE_NOT_FOUND',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an ancestor record for a different path does not become the release host', () => {
  const root = createFixture()

  try {
    seedNamedWorktree(root, 'ship-three')
    const other = path.join(root, 'elsewhere', 'ship-three')

    mkdirSync(other, { recursive: true })

    assert.equal(worktreeIndexHost(other, 'ship-three'), path.resolve(other))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release worktree lookup leaves a mismatched checkout in place', () => {
  const root = createFixture()

  try {
    const record = createWorktree(root, 'release-lookup')
    const worktreePath = path.join(root, record.path)

    git(worktreePath, ['switch', '-c', 'other-branch'])

    const resolved = resolveReleaseWorktree(root, record.name)

    assert.equal(resolved.root, path.resolve(root))
    assert.equal(resolved.record.name, record.name)
    assert.equal(
      git(worktreePath, ['branch', '--show-current']),
      'other-branch',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
