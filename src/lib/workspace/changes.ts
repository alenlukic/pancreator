import { PanError } from '../errors.js'
import type { ResolvedRoots, WorkspaceIndex } from '../types.js'
import {
  loadWorkspaceIndex,
  reconcileWorkspaceIndex,
  saveWorkspaceIndex,
  workspaceSnapshotFromIndex,
} from './index.js'

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
 * Per-file locks and the modification ledger were removed; the harness now
 * records the resulting workspace fingerprint and accepted checksum index.
 */
export function adoptAuthorizedWorkspaceChanges(
  context: AdoptAuthorizedChangesContext,
): AdoptAuthorizedChangesResult {
  const accepted = requireIndex(context.state_root)
  const observed = reconcileWorkspaceIndex(context.roots, accepted)
  const changedPaths = [...observed.changed_paths].sort()
  const deletedPaths = [...observed.deleted_paths].sort()

  saveWorkspaceIndex(context.state_root, observed.index)

  return {
    workspace_fingerprint: workspaceSnapshotFromIndex(observed.index)
      .fingerprint,
    changed_paths: changedPaths,
    deleted_paths: deletedPaths,
  }
}
