import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { PanError } from '../errors.js'
import { canonicalize, fileExists } from '../io.js'
import type {
  FileLock,
  ModificationLedgerEntry,
  ResolvedRoots,
  WorkspaceIndex,
} from '../types.js'
import { appendLedgerEntry } from './ledger.js'
import {
  acquireFileLock,
  canCancelFileLock,
  digestPath,
  readFileLock,
  releaseFileLock,
} from './locks.js'
import {
  loadWorkspaceIndex,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
  workspaceSnapshotFromIndex,
} from './index.js'
import { normalizeWorkspacePath, resolveWorkspacePath } from './roots.js'

export interface ModificationContext {
  state_root: string
  roots: ResolvedRoots
  workflow_id: string
  stage: string
  stage_attempt: number
  invocation_id: string
}

export interface BeginModificationResult {
  lock: FileLock
  expected_checksum: string | null
}

export interface CommitModificationResult {
  lock: FileLock
  operation: 'create' | 'modify' | 'delete' | 'noop'
  entry: ModificationLedgerEntry | null
}

export interface AdoptAuthorizedChangesContext {
  state_root: string
  roots: ResolvedRoots
  workflow_id: string
  stage: string
  stage_attempt: number
  authorization_id: string
}

export interface AdoptAuthorizedChangesResult {
  workspace_fingerprint: string
  changed_paths: string[]
  deleted_paths: string[]
}

function canonicalPathForTarget(absolutePath: string): string {
  if (fileExists(absolutePath)) {
    return canonicalize(absolutePath)
  }

  return path.resolve(absolutePath)
}

function assertOwnedLock(lock: FileLock, context: ModificationContext): void {
  if (
    lock.workflow_id !== context.workflow_id ||
    lock.stage !== context.stage ||
    lock.stage_attempt !== context.stage_attempt ||
    lock.invocation_id !== context.invocation_id
  ) {
    throw new PanError(`Lock ownership mismatch for path ${lock.path}`, {
      code: 'LOCK_OWNERSHIP_MISMATCH',
      details: { lock },
    })
  }
}

function requireIndex(stateRoot: string): WorkspaceIndex {
  const index = loadWorkspaceIndex(stateRoot)

  if (!index) {
    throw new PanError(
      'Workspace index is missing. Reconcile workspace first.',
      {
        code: 'MISSING_WORKSPACE_INDEX',
      },
    )
  }

  return index
}

/**
 * Adopt operator-authored changes made during an explicit workflow pause.
 * The accepted index is advanced and each content delta is recorded in the
 * workflow ledger so later integrity validation can distinguish authorized
 * pause work from an unledgered external write.
 */
export function adoptAuthorizedWorkspaceChanges(
  context: AdoptAuthorizedChangesContext,
): AdoptAuthorizedChangesResult {
  const accepted = requireIndex(context.state_root)
  const observed = reconcileWorkspaceIndex(context.roots, accepted)
  const changedPaths = [...observed.changed_paths].sort()
  const deletedPaths = [...observed.deleted_paths].sort()
  const deltaPaths = [...new Set([...changedPaths, ...deletedPaths])].sort()

  for (const relativePath of deltaPaths) {
    const beforeChecksum = accepted.entries[relativePath]?.checksum ?? null
    const afterChecksum = observed.index.entries[relativePath]?.checksum ?? null
    let operation: 'create' | 'modify' | 'delete'

    if (beforeChecksum === null) {
      operation = 'create'
    } else if (afterChecksum === null) {
      operation = 'delete'
    } else {
      operation = 'modify'
    }

    appendLedgerEntry(context.state_root, context.workflow_id, {
      path: relativePath,
      operation,
      before_checksum: beforeChecksum,
      after_checksum: afterChecksum,
      workflow_id: context.workflow_id,
      stage: context.stage,
      stage_attempt: context.stage_attempt,
      invocation_id: context.authorization_id,
      modified_at_ms: Date.now(),
      lock_id: context.authorization_id,
    })
  }

  saveWorkspaceIndex(context.state_root, observed.index)

  return {
    workspace_fingerprint: workspaceSnapshotFromIndex(observed.index)
      .fingerprint,
    changed_paths: changedPaths,
    deleted_paths: deletedPaths,
  }
}

export function beginTrackedModification(
  context: ModificationContext,
  relativePath: string,
): BeginModificationResult {
  const normalizedPath = normalizeWorkspacePath(relativePath)
  const absolutePath = resolveWorkspacePath(context.roots, normalizedPath)
  const canonicalPath = canonicalPathForTarget(absolutePath)
  const index = requireIndex(context.state_root)
  const acceptedChecksum = index.entries[normalizedPath]?.checksum ?? null
  const currentChecksum = digestPath(absolutePath).checksum

  if (acceptedChecksum !== currentChecksum) {
    throw new PanError(
      `Pre-modification divergence detected for ${normalizedPath}.`,
      {
        code: 'WORKSPACE_DIVERGENCE',
        details: {
          path: normalizedPath,
          expected_checksum: acceptedChecksum,
          observed_checksum: currentChecksum,
        },
      },
    )
  }

  const lock: FileLock = {
    schema_version: 1,
    lock_id: randomUUID(),
    path: normalizedPath,
    canonical_path: canonicalPath,
    workflow_id: context.workflow_id,
    stage: context.stage,
    stage_attempt: context.stage_attempt,
    invocation_id: context.invocation_id,
    acquired_at_ms: Date.now(),
    expected_checksum: acceptedChecksum,
  }

  acquireFileLock(context.state_root, lock)

  return { lock, expected_checksum: acceptedChecksum }
}

export function commitTrackedModification(
  context: ModificationContext,
  relativePath: string,
  lockId: string,
): CommitModificationResult {
  const normalizedPath = normalizeWorkspacePath(relativePath)
  const absolutePath = resolveWorkspacePath(context.roots, normalizedPath)
  const canonicalPath = canonicalPathForTarget(absolutePath)
  const lock = readFileLock(context.state_root, canonicalPath)

  if (!lock || lock.lock_id !== lockId) {
    throw new PanError(`No active lock for ${normalizedPath}`, {
      code: 'LOCK_NOT_FOUND',
    })
  }

  assertOwnedLock(lock, context)

  const index = requireIndex(context.state_root)
  const digest = digestPath(absolutePath)
  const beforeChecksum = lock.expected_checksum
  const afterChecksum = digest.checksum

  if (beforeChecksum === afterChecksum) {
    releaseFileLock(context.state_root, lock.canonical_path)

    return {
      lock,
      operation: 'noop',
      entry: null,
    }
  }

  let operation: 'create' | 'modify' | 'delete'

  if (beforeChecksum === null && afterChecksum !== null) {
    operation = 'create'
  } else if (beforeChecksum !== null && afterChecksum === null) {
    operation = 'delete'
  } else {
    operation = 'modify'
  }

  const entry = appendLedgerEntry(context.state_root, context.workflow_id, {
    path: normalizedPath,
    operation,
    before_checksum: beforeChecksum,
    after_checksum: afterChecksum,
    workflow_id: context.workflow_id,
    stage: context.stage,
    stage_attempt: context.stage_attempt,
    invocation_id: context.invocation_id,
    modified_at_ms: Date.now(),
    lock_id: lock.lock_id,
  })

  if (operation === 'delete') {
    delete index.entries[normalizedPath]
  } else {
    index.entries[normalizedPath] = {
      kind: digest.kind === 'symlink' ? 'symlink' : 'file',
      checksum: afterChecksum ?? '',
      size: digest.size,
      modified_at_ms: digest.modified_at_ms,
    }
  }

  index.updated_at_ms = Date.now()
  saveWorkspaceIndex(context.state_root, index)
  releaseFileLock(context.state_root, lock.canonical_path)

  return { lock, operation, entry }
}

export function cancelTrackedModification(
  context: ModificationContext,
  relativePath: string,
  lockId: string,
): FileLock {
  const normalizedPath = normalizeWorkspacePath(relativePath)
  const absolutePath = resolveWorkspacePath(context.roots, normalizedPath)
  const canonicalPath = canonicalPathForTarget(absolutePath)
  const lock = readFileLock(context.state_root, canonicalPath)

  if (!lock || lock.lock_id !== lockId) {
    throw new PanError(`No active lock for ${normalizedPath}`, {
      code: 'LOCK_NOT_FOUND',
    })
  }

  assertOwnedLock(lock, context)

  const currentChecksum = digestPath(absolutePath).checksum

  if (!canCancelFileLock(lock, currentChecksum)) {
    throw new PanError(
      `Cannot cancel lock for ${normalizedPath} because the file changed.`,
      {
        code: 'LOCK_CANCEL_REJECTED',
        details: {
          expected_checksum: lock.expected_checksum,
          observed_checksum: currentChecksum,
        },
      },
    )
  }

  releaseFileLock(context.state_root, lock.canonical_path)

  return lock
}
