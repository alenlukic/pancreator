import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadWorkspaceIndex,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
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
