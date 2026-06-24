import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadWorkspaceIndex,
  snapshotWorkspace,
  writeWorkflowBaseline,
} from '../../src/lib/workspace/index.js'
import { appendLedgerEntry } from '../../src/lib/workspace/ledger.js'
import { digestPath } from '../../src/lib/workspace/locks.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import { validateWorkflowChanges } from '../../src/lib/workspace/validate-changes.js'
import { sha256 } from '../../src/lib/io.js'

function makeWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'pancreator-validate-'))

  mkdirSync(path.join(workspace, '.pancreator'), { recursive: true })
  writeFileSync(path.join(workspace, 'tracked.ts'), 'export const value = 1\n')

  return workspace
}

test('validate-changes reports unledgered modifications', () => {
  const workspace = makeWorkspace()
  const runId = 'run-unledgered'
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

  assert.equal(result.status, 'operator-review-required')
  assert.equal(
    result.anomalies.some(
      (anomaly) => anomaly.code === 'unledgered.modification',
    ),
    true,
  )
})

test('validate-changes repairs index when ledger is ahead', () => {
  const workspace = makeWorkspace()
  const runId = 'run-repair'
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })
  const adopted = snapshotWorkspace(roots, true)
  const beforeChecksum = adopted.index.entries['tracked.ts']?.checksum ?? null

  writeWorkflowBaseline(
    roots.state_root,
    runId,
    roots,
    adopted.index,
    sha256({ scope_hash: roots.scope_hash }),
  )

  writeFileSync(path.join(workspace, 'tracked.ts'), 'export const value = 3\n')

  appendLedgerEntry(roots.state_root, runId, {
    path: 'tracked.ts',
    operation: 'modify',
    before_checksum: beforeChecksum,
    after_checksum: digestPath(path.join(workspace, 'tracked.ts')).checksum,
    workflow_id: runId,
    stage: 'implement',
    stage_attempt: 1,
    invocation_id: 'implement-1',
    modified_at_ms: Date.now(),
    lock_id: 'lock-1',
  })

  const result = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots,
  })
  const repairedIndex = loadWorkspaceIndex(roots.state_root)

  assert.equal(result.status, 'passed')
  assert.equal(
    repairedIndex?.entries['tracked.ts']?.checksum,
    digestPath(path.join(workspace, 'tracked.ts')).checksum,
  )
})
