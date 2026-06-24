import { randomUUID } from 'node:crypto'

import { invariant, PanError } from '../errors.js'
import { fileExists, isRecord, readText, writeJsonAtomic } from '../io.js'
import { ledgerValidationPath } from '../state.js'
import type {
  LedgerAnomaly,
  LedgerValidationResult,
  ResolvedRoots,
  WorkspaceIndexEntry,
} from '../types.js'
import {
  isNonBlockingGeneratedArtifact,
  loadWorkspaceIndex,
  readWorkflowBaseline,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
} from './index.js'
import { readLedgerEntries, replayLedger } from './ledger.js'
import { listFileLocks } from './locks.js'

function makeAnomaly(
  code: string,
  summary: string,
  details: string,
  options: Partial<LedgerAnomaly> = {},
): LedgerAnomaly {
  return {
    id: `anomaly-${randomUUID().slice(0, 8)}`,
    code,
    severity: 'hard',
    summary,
    details,
    suggested_actions: ['accept', 'restart-stage', 'spot-fix', 'abort'],
    ...options,
  }
}

function checksumAt(
  entries: Record<string, WorkspaceIndexEntry>,
  relativePath: string,
): string | null {
  return entries[relativePath]?.checksum ?? null
}

export interface ValidateChangesOptions {
  run_id: string
  state_root: string
  roots: ResolvedRoots
}

export function validateWorkflowChanges(
  options: ValidateChangesOptions,
): LedgerValidationResult {
  const baseline = readWorkflowBaseline(options.state_root, options.run_id)
  const acceptedIndex = loadWorkspaceIndex(options.state_root)

  if (!acceptedIndex) {
    throw new PanError(
      'Workspace index is missing. Reconcile before validating changes.',
      {
        code: 'MISSING_WORKSPACE_INDEX',
      },
    )
  }

  const observed = reconcileWorkspaceIndex(options.roots, acceptedIndex)
  const ledgerEntries = readLedgerEntries(options.state_root, options.run_id)
  const replay = replayLedger(baseline.entries, ledgerEntries)
  const anomalies: LedgerAnomaly[] = [...replay.anomalies]
  const repairs: string[] = []

  if (baseline.scope_hash !== options.roots.scope_hash) {
    anomalies.push(
      makeAnomaly(
        'scope.hash_mismatch',
        'Scope hash drift detected.',
        `Baseline scope hash ${baseline.scope_hash} does not match current scope hash ${options.roots.scope_hash}.`,
      ),
    )
  }

  if (acceptedIndex.scope_hash !== options.roots.scope_hash) {
    anomalies.push(
      makeAnomaly(
        'index.scope_mismatch',
        'Workspace index scope hash drift detected.',
        `Index scope hash ${acceptedIndex.scope_hash} does not match current scope hash ${options.roots.scope_hash}.`,
      ),
    )
  }

  for (const entry of ledgerEntries) {
    if (entry.workflow_id !== options.run_id) {
      anomalies.push(
        makeAnomaly(
          'ledger.foreign_workflow',
          'Ledger contains entries from a different workflow.',
          `Entry sequence ${entry.sequence} belongs to workflow ${entry.workflow_id}.`,
          { sequence: entry.sequence, path: entry.path },
        ),
      )
    }
  }

  const expectedFinalChecksums = new Map<string, string | null>(
    Object.entries(baseline.entries).map(([relativePath, entry]) => [
      relativePath,
      entry.checksum,
    ]),
  )

  for (const [relativePath, checksum] of Object.entries(
    replay.final_checksums,
  )) {
    expectedFinalChecksums.set(relativePath, checksum)
  }

  for (const relativePath of replay.modified_paths) {
    const replayChecksum = replay.final_checksums[relativePath] ?? null
    const observedChecksum = checksumAt(observed.index.entries, relativePath)
    const acceptedChecksum = checksumAt(acceptedIndex.entries, relativePath)

    if (replayChecksum !== observedChecksum) {
      anomalies.push(
        makeAnomaly(
          'ledger.filesystem_mismatch',
          'Ledger replay does not match the current filesystem.',
          `Path ${relativePath} replayed checksum ${replayChecksum ?? 'null'} but observed ${observedChecksum ?? 'null'}.`,
          {
            path: relativePath,
            expected: replayChecksum,
            observed: observedChecksum,
          },
        ),
      )
    }

    if (replayChecksum !== acceptedChecksum) {
      if (replayChecksum === observedChecksum) {
        if (replayChecksum === null) {
          delete acceptedIndex.entries[relativePath]
        } else {
          acceptedIndex.entries[relativePath] =
            observed.index.entries[relativePath]
        }

        repairs.push(`Replayed index entry for ${relativePath}.`)
      } else {
        anomalies.push(
          makeAnomaly(
            'ledger.index_mismatch',
            'Accepted index diverged from replay and filesystem.',
            `Path ${relativePath} accepted checksum ${acceptedChecksum ?? 'null'} does not match replay ${replayChecksum ?? 'null'}.`,
            {
              path: relativePath,
              expected: replayChecksum,
              observed: acceptedChecksum,
            },
          ),
        )
      }
    }
  }

  const observedPaths = new Set<string>(Object.keys(observed.index.entries))
  const expectedPaths = new Set<string>(expectedFinalChecksums.keys())

  for (const relativePath of new Set([...expectedPaths, ...observedPaths])) {
    const expectedChecksum = expectedFinalChecksums.get(relativePath) ?? null
    const observedChecksum = checksumAt(observed.index.entries, relativePath)

    if (expectedChecksum !== observedChecksum) {
      if (isNonBlockingGeneratedArtifact(options.roots, relativePath)) {
        continue
      }

      const code =
        expectedChecksum === null
          ? 'unledgered.creation'
          : observedChecksum === null
            ? 'unledgered.deletion'
            : 'unledgered.modification'

      anomalies.push(
        makeAnomaly(
          code,
          'Unledgered workspace difference detected.',
          `Path ${relativePath} expected checksum ${expectedChecksum ?? 'null'} but observed ${observedChecksum ?? 'null'}.`,
          {
            path: relativePath,
            expected: expectedChecksum,
            observed: observedChecksum,
          },
        ),
      )
    }
  }

  for (const lock of listFileLocks(options.state_root)) {
    if (lock.workflow_id === options.run_id) {
      anomalies.push(
        makeAnomaly(
          'lock.stale',
          'Workflow-owned lock remains after validation.',
          `Lock ${lock.lock_id} still exists for path ${lock.path}.`,
          { path: lock.path },
        ),
      )
    }
  }

  if (repairs.length > 0) {
    acceptedIndex.updated_at_ms = Date.now()
    saveWorkspaceIndex(options.state_root, acceptedIndex)
  }

  const result: LedgerValidationResult = {
    schema_version: 1,
    workflow_id: options.run_id,
    status: anomalies.length === 0 ? 'passed' : 'operator-review-required',
    validated_at_ms: Date.now(),
    baseline_scope_hash: baseline.scope_hash,
    current_scope_hash: options.roots.scope_hash,
    ledger_entry_count: ledgerEntries.length,
    modified_path_count: replay.modified_paths.length,
    anomalies,
  }

  writeJsonAtomic(
    ledgerValidationPath(options.state_root, options.run_id),
    result,
  )

  return result
}

export function waiveLedgerValidation(
  stateRoot: string,
  runId: string,
): LedgerValidationResult {
  const filePath = ledgerValidationPath(stateRoot, runId)
  const value = fileExists(filePath)
    ? (JSON.parse(readText(filePath)) as unknown)
    : null

  invariant(
    value && isRecord(value) && value.schema_version === 1,
    `Cannot waive missing validation result for workflow ${runId}.`,
    { code: 'MISSING_LEDGER_VALIDATION' },
  )

  const existing = value as unknown as LedgerValidationResult
  const waived: LedgerValidationResult = {
    ...existing,
    status: 'waived',
    validated_at_ms: Date.now(),
  }

  writeJsonAtomic(filePath, waived)

  return waived
}
