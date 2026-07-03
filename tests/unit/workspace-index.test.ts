import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  blockingWorkspacePathsFromSnapshots,
  loadWorkspaceIndex,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
  snapshotWorkspace,
} from '../../src/lib/workspace/index.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'

function makeWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'pancreator-index-'))

  mkdirSync(path.join(workspace, '.pancreator'), { recursive: true })
  writeFileSync(path.join(workspace, 'tracked.txt'), 'v1\n')

  return workspace
}

test('workspace index reconciliation reuses unchanged metadata', () => {
  const workspace = makeWorkspace()
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const first = reconcileWorkspaceIndex(roots, null)

  saveWorkspaceIndex(roots.state_root, first.index)

  const loaded = loadWorkspaceIndex(roots.state_root)
  const second = reconcileWorkspaceIndex(roots, loaded)

  assert.equal(loaded?.entries['tracked.txt']?.checksum.length, 64)
  assert.deepEqual(second.changed_paths, [])
  assert.equal(
    (second.index.entries['tracked.txt'] as { content?: string }).content,
    undefined,
  )
})

test('workspace index reconciliation rehashes changed files', () => {
  const workspace = makeWorkspace()
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const first = reconcileWorkspaceIndex(roots, null)

  writeFileSync(path.join(workspace, 'tracked.txt'), 'v2\n')

  const second = reconcileWorkspaceIndex(roots, first.index)

  assert.equal(second.changed_paths.includes('tracked.txt'), true)
  assert.notEqual(
    first.index.entries['tracked.txt']?.checksum,
    second.index.entries['tracked.txt']?.checksum,
  )
})

test('nested generated files under node_modules are not fingerprinted', () => {
  const workspace = makeWorkspace()
  const configPath = path.join(workspace, 'project.json')

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema_version: 1,
        workspace_id: 'fixture-workspace',
        tracking: {
          include: ['**/*'],
          exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
        },
      },
      null,
      2,
    ),
  )

  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const generatedPath = path.join(
    workspace,
    'client',
    'node_modules',
    '.vite',
    'vitest',
    'cache',
    'results.json',
  )

  mkdirSync(path.dirname(generatedPath), { recursive: true })
  writeFileSync(generatedPath, '{}\n')

  const reconciled = reconcileWorkspaceIndex(roots, null)

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      reconciled.index.entries,
      'client/node_modules/.vite/vitest/cache/results.json',
    ),
    false,
  )
})

test('nested generated file deltas do not block non-source stages', () => {
  const workspace = makeWorkspace()
  const configPath = path.join(workspace, 'project.json')

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema_version: 1,
        workspace_id: 'fixture-workspace',
        tracking: {
          include: ['**/*'],
          exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
        },
      },
      null,
      2,
    ),
  )

  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const before = snapshotWorkspace(roots, false).snapshot
  const generatedPath = path.join(
    workspace,
    'client',
    'node_modules',
    '.vite',
    'vitest',
    'cache',
    'results.json',
  )

  mkdirSync(path.dirname(generatedPath), { recursive: true })
  writeFileSync(generatedPath, '{}\n')

  const after = snapshotWorkspace(roots, false).snapshot
  const blocking = blockingWorkspacePathsFromSnapshots(before, after, roots)

  assert.deepEqual(blocking, [])
})
