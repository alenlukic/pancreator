import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  blockingWorkspacePathsFromSnapshots,
  loadWorkspaceIndex,
  snapshotWorkspace,
  writeWorkflowBaseline,
} from '../../src/lib/workspace/index.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import { validateWorkflowChanges } from '../../src/lib/workspace/validate-changes.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { sha256 } from '../../src/lib/io.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

function makeWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'pancreator-validate-'))

  mkdirSync(path.join(workspace, '.pancreator'), { recursive: true })
  writeFileSync(path.join(workspace, 'tracked.ts'), 'export const value = 1\n')

  return workspace
}

test('validate-changes adopts direct tracked modifications', () => {
  const workspace = makeWorkspace()
  const runId = 'run-direct-modification'
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const adopted = snapshotWorkspace(roots, true)

  writeWorkflowBaseline(
    roots.state_root,
    runId,
    roots,
    adopted.index,
    sha256({ scope_hash: roots.scope_hash }),
  )

  writeFileSync(path.join(workspace, 'tracked.ts'), 'export const value = 2\n')

  const result = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots,
  })
  const updatedIndex = loadWorkspaceIndex(roots.state_root)

  assert.equal(result.status, 'passed')
  assert.equal(result.anomalies.length, 0)
  assert.equal(result.modified_path_count, 1)
  assert.notEqual(
    updatedIndex?.entries['tracked.ts']?.checksum,
    adopted.index.entries['tracked.ts']?.checksum,
  )
})

test('validate-changes adopts direct tracked creations', () => {
  const workspace = makeWorkspace()
  const runId = 'run-direct-creation'
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const adopted = snapshotWorkspace(roots, true)

  writeWorkflowBaseline(
    roots.state_root,
    runId,
    roots,
    adopted.index,
    sha256({ scope_hash: roots.scope_hash }),
  )

  writeFileSync(path.join(workspace, 'new.ts'), 'export const value = 3\n')

  const result = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots,
  })
  const updatedIndex = loadWorkspaceIndex(roots.state_root)

  assert.equal(result.status, 'passed')
  assert.equal(result.modified_path_count, 1)
  assert.ok(updatedIndex?.entries['new.ts'])
})

test('validate-changes ignores dist and node_modules side effects', () => {
  const workspace = makeWorkspace()
  const runId = 'run-generated'
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const adopted = snapshotWorkspace(roots, true)

  writeWorkflowBaseline(
    roots.state_root,
    runId,
    roots,
    adopted.index,
    sha256({ scope_hash: roots.scope_hash }),
  )

  mkdirSync(path.join(workspace, 'dist', 'lib'), { recursive: true })
  writeFileSync(
    path.join(workspace, 'dist', 'lib', 'index.js'),
    'module.exports = {}\n',
  )
  mkdirSync(path.join(workspace, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(
    path.join(workspace, 'node_modules', 'pkg', 'index.js'),
    'export {}\n',
  )

  const result = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots,
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.anomalies.length, 0)
})

test('validate-changes blocks scope hash drift', () => {
  const workspace = makeWorkspace()
  const runId = 'run-scope-drift'
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const adopted = snapshotWorkspace(roots, true)

  writeWorkflowBaseline(
    roots.state_root,
    runId,
    roots,
    adopted.index,
    sha256({ scope_hash: roots.scope_hash }),
  )

  const changedRoots = {
    ...roots,
    scope_hash: 'changed-scope',
  }
  const result = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots: changedRoots,
  })

  assert.equal(result.status, 'operator-review-required')
  assert.equal(
    result.anomalies.some((anomaly) => anomaly.code === 'scope.hash_mismatch'),
    true,
  )
})

test('blocking workspace paths ignore generated dist artifacts', () => {
  const workspace = makeWorkspace()
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const before = snapshotWorkspace(roots, false).snapshot

  mkdirSync(path.join(workspace, 'dist'), { recursive: true })
  writeFileSync(path.join(workspace, 'dist', 'out.js'), 'console.log(1)\n')

  const after = snapshotWorkspace(roots, false).snapshot
  const blocking = blockingWorkspacePathsFromSnapshots(before, after, roots)

  assert.deepEqual(blocking, [])
})

test('blocking workspace paths ignore misplaced root delegation artifacts', () => {
  const workspace = makeWorkspace()
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const before = snapshotWorkspace(roots, false).snapshot

  writeFileSync(path.join(workspace, '.delegation.md'), '# delegated prompt\n')

  const after = snapshotWorkspace(roots, false).snapshot
  const blocking = blockingWorkspacePathsFromSnapshots(before, after, roots)

  assert.deepEqual(blocking, [])

  rmSync(path.join(workspace, '.delegation.md'))

  const removed = snapshotWorkspace(roots, false).snapshot
  const blockingAfterRemoval = blockingWorkspacePathsFromSnapshots(
    after,
    removed,
    roots,
  )

  assert.deepEqual(blockingAfterRemoval, [])
})

test('scope guard allows dist changes during read-only stages', () => {
  const workspace = makeWorkspace()
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const before = snapshotWorkspace(roots, false).snapshot

  mkdirSync(path.join(workspace, 'dist'), { recursive: true })
  writeFileSync(path.join(workspace, 'dist', 'bundle.js'), 'export {}\n')

  const after = snapshotWorkspace(roots, false).snapshot
  const stage: StageDefinition = {
    slug: 'test',
    title: 'Quality assurance',
    persona: 'qa-tester',
    workspace_policy: 'read_only',
    gate: 'stage_verdict',
    context: { request: 'omit' },
    criteria: [],
    transitions: { success: 'ship', failure: 'implement', blocked: 'paused' },
  }
  const state = {
    run_id: 'run-scope',
    workspace_root: workspace,
    state_root: roots.state_root,
    stage_history: [],
    gate_overrides: {},
  } as unknown as RunState

  const evaluated = evaluateDeterministicCriteria(
    workspace,
    path.join(workspace, 'runtime', 'logs', 'workflows', 'run-scope'),
    state,
    stage,
    before,
    workspace,
  )
  const scope = evaluated.results.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.passed, true)
  assert.equal(evaluated.workspace.fingerprint, after.fingerprint)
})
