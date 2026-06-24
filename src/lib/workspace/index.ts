import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from '../errors.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  sha256,
  writeJsonAtomic,
} from '../io.js'
import {
  baselinePath,
  indexPath,
  leasePath,
  ledgerValidationPath,
} from '../state.js'
import type {
  ActiveWorkflowLease,
  LedgerValidationResult,
  ResolvedRoots,
  WorkflowBaseline,
  WorkspaceIndex,
  WorkspaceIndexEntry,
  WorkspaceSnapshot,
} from '../types.js'
import { isExcludedPath, normalizeWorkspacePath } from './roots.js'

const DEFAULT_GENERATED_PATH_PREFIXES = [
  'dist',
  'node_modules',
  'coverage',
] as const

const DEFAULT_GENERATED_PATHS = new Set([
  'package-lock.json',
  'tsconfig.tsbuildinfo',
])

/** Whether a path is an expected generated artifact that must not block gates. */
export function isNonBlockingGeneratedArtifact(
  roots: ResolvedRoots,
  relativePath: string,
): boolean {
  if (isExcludedPath(roots, relativePath)) {
    return true
  }

  let normalized: string

  try {
    normalized = normalizeWorkspacePath(relativePath)
  } catch {
    return false
  }

  if (DEFAULT_GENERATED_PATHS.has(normalized)) {
    return true
  }

  for (const prefix of DEFAULT_GENERATED_PATH_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true
    }
  }

  return false
}

function snapshotEntryPath(entry: string): string {
  const colonIndex = entry.lastIndexOf(':')

  return colonIndex === -1 ? entry : entry.slice(0, colonIndex)
}

/** Paths whose snapshot deltas should block non-source workflow stages. */
export function blockingWorkspacePathsFromSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  roots: ResolvedRoots,
): string[] {
  const beforeByPath = new Map(
    before.entries.map((entry) => [snapshotEntryPath(entry), entry]),
  )
  const afterByPath = new Map(
    after.entries.map((entry) => [snapshotEntryPath(entry), entry]),
  )
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()])
  const blocking: string[] = []

  for (const relativePath of paths) {
    if (beforeByPath.get(relativePath) === afterByPath.get(relativePath)) {
      continue
    }

    if (!isNonBlockingGeneratedArtifact(roots, relativePath)) {
      blocking.push(relativePath)
    }
  }

  return blocking.sort()
}

function fileChecksum(filePath: string): string {
  return sha256(readFileSync(filePath))
}

function symlinkChecksum(filePath: string): string {
  return sha256(readlinkSync(filePath))
}

function collectTrackedPaths(
  roots: ResolvedRoots,
  directory: string,
  prefix = '',
  output: string[] = [],
): string[] {
  const absolute = path.join(roots.workspace_root, directory)

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = normalizeWorkspacePath(
      prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name,
    )

    if (isExcludedPath(roots, relative)) {
      continue
    }

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      collectTrackedPaths(roots, relative, relative, output)
      continue
    }

    if (entry.isFile() || entry.isSymbolicLink()) {
      output.push(relative)
    }
  }

  return output
}

function buildEntry(
  roots: ResolvedRoots,
  relativePath: string,
  previous?: WorkspaceIndexEntry,
): WorkspaceIndexEntry {
  const absolute = path.join(roots.workspace_root, relativePath)
  const metadata = lstatSync(absolute)
  const modifiedAtMs = metadata.mtimeMs

  if (metadata.isSymbolicLink()) {
    const checksum = symlinkChecksum(absolute)
    const size = readlinkSync(absolute).length

    return {
      kind: 'symlink',
      checksum,
      size,
      modified_at_ms: modifiedAtMs,
    }
  }

  invariant(metadata.isFile(), `Unsupported tracked entry: ${relativePath}`, {
    code: 'UNSUPPORTED_ENTRY',
  })

  if (
    previous &&
    previous.kind === 'file' &&
    previous.size === metadata.size &&
    previous.modified_at_ms === modifiedAtMs &&
    previous.checksum.length > 0
  ) {
    return previous
  }

  return {
    kind: 'file',
    checksum: fileChecksum(absolute),
    size: metadata.size,
    modified_at_ms: modifiedAtMs,
  }
}

export interface ReconcileWorkspaceResult {
  index: WorkspaceIndex
  changed_paths: string[]
  deleted_paths: string[]
}

export interface SnapshotWorkspaceResult extends ReconcileWorkspaceResult {
  snapshot: WorkspaceSnapshot
}

export function loadWorkspaceIndex(stateRoot: string): WorkspaceIndex | null {
  const filePath = indexPath(stateRoot)

  if (!fileExists(filePath)) {
    return null
  }

  const value = readJson(filePath)

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      typeof value.workspace_id === 'string' &&
      typeof value.workspace_root === 'string' &&
      typeof value.scope_hash === 'string' &&
      isRecord(value.entries),
    `Invalid workspace index: ${filePath}`,
    { code: 'INVALID_WORKSPACE_INDEX' },
  )

  return value as unknown as WorkspaceIndex
}

export function saveWorkspaceIndex(
  stateRoot: string,
  index: WorkspaceIndex,
): void {
  writeJsonAtomic(indexPath(stateRoot), index)
}

export function reconcileWorkspaceIndex(
  roots: ResolvedRoots,
  accepted: WorkspaceIndex | null,
): ReconcileWorkspaceResult {
  const paths = collectTrackedPaths(roots, '.').sort()
  const previousEntries = accepted?.entries ?? {}
  const entries: Record<string, WorkspaceIndexEntry> = {}
  const changedPaths: string[] = []

  for (const relativePath of paths) {
    const previous = previousEntries[relativePath]
    const next = buildEntry(roots, relativePath, previous)

    entries[relativePath] = next

    if (!previous || previous.checksum !== next.checksum) {
      changedPaths.push(relativePath)
    }
  }

  const deletedPaths = Object.keys(previousEntries).filter(
    (relativePath) =>
      !Object.prototype.hasOwnProperty.call(entries, relativePath),
  )
  const index: WorkspaceIndex = {
    schema_version: 1,
    workspace_id: roots.workspace_id,
    workspace_root: roots.workspace_root,
    scope_hash: roots.scope_hash,
    updated_at_ms: Date.now(),
    entries,
  }

  return {
    index,
    changed_paths: changedPaths,
    deleted_paths: deletedPaths,
  }
}

export function workspaceSnapshotFromIndex(
  index: WorkspaceIndex,
): WorkspaceSnapshot {
  const ordered = Object.keys(index.entries).sort()
  const fingerprint = sha256({
    workspace_id: index.workspace_id,
    workspace_root: index.workspace_root,
    scope_hash: index.scope_hash,
    entries: ordered.map((relativePath) => ({
      path: relativePath,
      ...index.entries[relativePath],
    })),
  })

  return {
    kind: 'filesystem',
    fingerprint,
    entries: ordered.map(
      (relativePath) =>
        `${relativePath}:${index.entries[relativePath]?.checksum}`,
    ),
  }
}

export function snapshotWorkspace(
  roots: ResolvedRoots,
  adopt = false,
): SnapshotWorkspaceResult {
  const accepted = loadWorkspaceIndex(roots.state_root)
  const reconciled = reconcileWorkspaceIndex(roots, accepted)

  if (adopt) {
    saveWorkspaceIndex(roots.state_root, reconciled.index)
  }

  return {
    ...reconciled,
    snapshot: workspaceSnapshotFromIndex(reconciled.index),
  }
}

export function writeWorkflowBaseline(
  stateRoot: string,
  runId: string,
  roots: ResolvedRoots,
  index: WorkspaceIndex,
  configurationHash: string,
): WorkflowBaseline {
  const filePath = baselinePath(stateRoot, runId)

  if (fileExists(filePath)) {
    return readWorkflowBaseline(stateRoot, runId)
  }

  const baseline: WorkflowBaseline = {
    schema_version: 1,
    workflow_id: runId,
    workspace_id: roots.workspace_id,
    workspace_root: roots.workspace_root,
    state_root: roots.state_root,
    installation_root: roots.installation_root,
    created_at_ms: Date.now(),
    configuration_hash: configurationHash,
    scope_hash: roots.scope_hash,
    entries: index.entries,
  }

  writeJsonAtomic(filePath, baseline)

  return baseline
}

export function readWorkflowBaseline(
  stateRoot: string,
  runId: string,
): WorkflowBaseline {
  const filePath = baselinePath(stateRoot, runId)
  const value = readJson(filePath)

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      value.workflow_id === runId &&
      typeof value.workspace_id === 'string' &&
      isRecord(value.entries),
    `Invalid workflow baseline: ${filePath}`,
    { code: 'INVALID_WORKFLOW_BASELINE' },
  )

  return value as unknown as WorkflowBaseline
}

export function readActiveWorkflowLease(
  stateRoot: string,
): ActiveWorkflowLease | null {
  const filePath = leasePath(stateRoot)

  if (!fileExists(filePath)) {
    return null
  }

  const value = readJson(filePath)

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.workflow_id !== 'string'
  ) {
    throw new PanError(`Invalid workspace lease: ${filePath}`, {
      code: 'INVALID_WORKFLOW_LEASE',
    })
  }

  return value as unknown as ActiveWorkflowLease
}

export function acquireActiveWorkflowLease(
  stateRoot: string,
  lease: ActiveWorkflowLease,
): void {
  const filePath = leasePath(stateRoot)
  ensureDir(path.dirname(filePath))

  let descriptor: number | null = null

  try {
    descriptor = openSync(filePath, 'wx')
    writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`, 'utf8')
  } catch {
    const existing = readActiveWorkflowLease(stateRoot)

    throw new PanError(
      `Another mutating workflow is already active: ${existing?.workflow_id ?? 'unknown'}`,
      {
        code: 'WORKFLOW_LEASE_HELD',
        details: { existing_workflow_id: existing?.workflow_id },
      },
    )
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
  }
}

export function releaseActiveWorkflowLease(
  stateRoot: string,
  runId: string,
): void {
  const existing = readActiveWorkflowLease(stateRoot)

  if (!existing) {
    return
  }

  if (existing.workflow_id !== runId) {
    throw new PanError(
      `Lease ownership mismatch: ${existing.workflow_id} != ${runId}`,
      {
        code: 'WORKFLOW_LEASE_MISMATCH',
      },
    )
  }

  rmSync(leasePath(stateRoot), { force: true })
}

export function readLedgerValidationResult(
  stateRoot: string,
  runId: string,
): LedgerValidationResult | null {
  const filePath = ledgerValidationPath(stateRoot, runId)

  if (!fileExists(filePath)) {
    return null
  }

  const value = readJson(filePath)

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      value.workflow_id === runId &&
      typeof value.status === 'string' &&
      Array.isArray(value.anomalies),
    `Invalid ledger validation result: ${filePath}`,
    { code: 'INVALID_LEDGER_VALIDATION' },
  )

  return value as unknown as LedgerValidationResult
}
