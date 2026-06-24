import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  appendLedgerEntry,
  readLedgerEntries,
  replayLedger,
} from '../../src/lib/workspace/ledger.js'
import type {
  ModificationLedgerEntry,
  WorkspaceIndexEntry,
} from '../../src/lib/types.js'

test('ledger append allocates contiguous sequences', () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'pancreator-ledger-'))

  appendLedgerEntry(stateRoot, 'run-1', {
    path: 'a.ts',
    operation: 'modify',
    before_checksum: 'before-1',
    after_checksum: 'after-1',
    workflow_id: 'run-1',
    stage: 'implement',
    stage_attempt: 1,
    invocation_id: 'implement-1',
    modified_at_ms: Date.now(),
    lock_id: 'lock-1',
  })
  appendLedgerEntry(stateRoot, 'run-1', {
    path: 'a.ts',
    operation: 'modify',
    before_checksum: 'after-1',
    after_checksum: 'after-2',
    workflow_id: 'run-1',
    stage: 'implement',
    stage_attempt: 2,
    invocation_id: 'implement-2',
    modified_at_ms: Date.now(),
    lock_id: 'lock-2',
  })

  const entries = readLedgerEntries(stateRoot, 'run-1')

  assert.deepEqual(
    entries.map((entry) => entry.sequence),
    [1, 2],
  )
})

test('ledger replay enforces checksum chain continuity', () => {
  const baseline: Record<string, WorkspaceIndexEntry> = {
    'file.ts': {
      kind: 'file',
      checksum: 'before',
      size: 4,
      modified_at_ms: 1,
    },
  }
  const valid: ModificationLedgerEntry[] = [
    {
      schema_version: 1,
      sequence: 1,
      path: 'file.ts',
      operation: 'modify',
      before_checksum: 'before',
      after_checksum: 'after',
      workflow_id: 'run-1',
      stage: 'implement',
      stage_attempt: 1,
      invocation_id: 'implement-1',
      modified_at_ms: 1,
      lock_id: 'lock-1',
    },
  ]
  const invalid: ModificationLedgerEntry[] = [
    {
      ...valid[0],
      before_checksum: 'different',
    },
  ]

  const replayValid = replayLedger(baseline, valid)
  const replayInvalid = replayLedger(baseline, invalid)

  assert.deepEqual(replayValid.anomalies, [])
  assert.equal(replayValid.final_checksums['file.ts'], 'after')
  assert.equal(replayInvalid.anomalies.length > 0, true)
})
