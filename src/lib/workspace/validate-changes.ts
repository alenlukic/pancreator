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
  loadWorkspaceIndex,
  readWorkflowBaseline,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
  workspaceSnapshotFromIndex,
} from './index.js'

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

function changedPathCount(
  baseline: Record<string, WorkspaceIndexEntry>,
  current: Record<string, WorkspaceIndexEntry>,
): number {
  const paths = new Set([...Object.keys(baseline), ...Object.keys(current)])
  let count = 0

  for (const relativePath of paths) {
    if (
      checksumAt(baseline, relativePath) !== checksumAt(current, relativePath)
    ) {
      count += 1
    }
  }

  return count
}

export interface ValidateChangesOptions {
  run_id: string
  state_root: string
  roots: ResolvedRoots
  expected_workspace_fingerprint?: string
}

/**
 * Validate stable workspace scope metadata and adopt the current checksum index.
 *
 * Earlier versions attempted to prove individual file ownership with persistent
 * cooperative locks and a per-edit ledger. Those records routinely outlived the
 * worker that created them and blocked unrelated lifecycle actions. Workspace
 * integrity now relies on immutable run baselines, per-stage fingerprints, and
 * read-only-stage mutation guards instead.
 */
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
  const anomalies: LedgerAnomaly[] = []

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

  const observedFingerprint = workspaceSnapshotFromIndex(
    observed.index,
  ).fingerprint

  if (
    options.expected_workspace_fingerprint &&
    observedFingerprint !== options.expected_workspace_fingerprint
  ) {
    anomalies.push(
      makeAnomaly(
        'evidence.fingerprint_mismatch',
        'Workspace changed after QA evidence was recorded.',
        `QA fingerprint ${options.expected_workspace_fingerprint} does not match current workspace fingerprint ${observedFingerprint}.`,
        {
          expected: options.expected_workspace_fingerprint,
          observed: observedFingerprint,
        },
      ),
    )
  }

  if (anomalies.length === 0) {
    saveWorkspaceIndex(options.state_root, observed.index)
  }

  const result: LedgerValidationResult = {
    schema_version: 1,
    workflow_id: options.run_id,
    status: anomalies.length === 0 ? 'passed' : 'operator-review-required',
    validated_at_ms: Date.now(),
    baseline_scope_hash: baseline.scope_hash,
    current_scope_hash: options.roots.scope_hash,
    // Retained for persisted-result compatibility. New runs do not create a
    // per-edit modification ledger.
    ledger_entry_count: 0,
    modified_path_count: changedPathCount(
      baseline.entries,
      observed.index.entries,
    ),
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
