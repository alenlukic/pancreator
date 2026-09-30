/**
 * Worktree record shapes, the operator worktree store and its paths, and the
 * self-development local configuration handoff into a new worktree.
 */

import { copyFileSync } from 'node:fs'
import path from 'node:path'

import { invariant, PanError, errorMessage } from '../errors.js'
import { fileExists, resolveInside, toRepoRelative, ensureDir } from '../io.js'
import {
  isSelfDevelopmentInstallation,
  configuredWorktreeRoot,
  DEFAULT_WORKTREE_ROOT,
  LEGACY_DEFAULT_WORKTREE_ROOT,
  localConfigName,
} from '../project-config.js'
import { syncCursorProjection } from '../projection.js'
import type { ManagedWorktreeReference } from '../types.js'
import {
  workspaceAttributions,
  workspaceAttributionDisposition,
} from '../workspace-attribution.js'

const WORKTREE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Refresh disposable Cursor state after a self-development worktree moves. */
export function syncSelfDevelopmentWorktreeProjection(
  worktreePath: string,
): void {
  if (
    fileExists(path.join(worktreePath, 'config.json')) &&
    isSelfDevelopmentInstallation(worktreePath)
  ) {
    syncCursorProjection(worktreePath, { write: true })
  }
}

/** A scratch tree `sweepWorktreeTestScratch` renamed out of its worktree. */
export const DISCARDED_SCRATCH_NAME = /^\..+-tests-\d+-\d+\.noindex$/u

export interface WorktreeRecord extends ManagedWorktreeReference {
  created_from: string
  description: string
  created_at: string
  /** Present when the harness took over a worktree it did not create. */
  adopted_at?: string
  /**
   * Absolute path of the Git repository this worktree belongs to, when it is
   * not the configured workspace repository. A cohort fanned out from a plan
   * run whose workspace is another repository (an eval fixture, an explicit
   * `--workspace`) records it here so listing, removal, and reconciliation
   * address the right repository.
   */
  repository_root?: string
}

export interface WorktreeIndex {
  schema_version: 1
  worktrees: WorktreeRecord[]
}

export interface CreatedWorktree extends WorktreeRecord {
  /**
   * Recorded read-only inputs the harness placed in the new worktree. The
   * index entry does not carry them, because they describe one creation
   * rather than the worktree's durable identity.
   */
  carried_paths: string[]
}

export interface ListedWorktree extends WorktreeRecord {
  registered: boolean
  /** The record names a repository that no longer resolves anywhere. */
  orphaned: boolean
  current_commit: string | null
  dirty: boolean | null
}

export interface CreateWorktreeOptions {
  from?: string | null
  description?: string | null
  /**
   * Git repository to add the worktree to. Defaults to the configured
   * workspace repository; a cohort passes the repository of its plan run's
   * workspace.
   */
  repositoryRoot?: string | null
}

export interface RemoveWorktreeResult {
  name: string
  path: string
  /** Present unless `--delete-branch` deleted the branch. */
  kept_branch?: string
  /** Present when `--delete-branch` deleted a merged branch. */
  deleted_branch?: string
  /** Why a requested branch deletion did not happen. */
  branch_deletion_refused?: string
  removed_worktree: boolean
  pruned_index_entry: boolean
  /** Where the worktree's test scratch went for its detached removal. */
  discarded_test_scratch?: string
}

export interface ReconcileTarget {
  /** Name of a recorded worktree the sources merge into. */
  into?: string | null
  /** Existing local branch the sources merge into through a recorded worktree. */
  into_branch?: string | null
}

export interface ReconcileOptions {
  /**
   * Cohort integration merges chunk branches into the session's own base
   * branch, which defaults to the branch the repository root holds. That merge
   * path predates `pan release land` and stays outside the landing guard; the
   * cohort's release run lands on pan-dev through its ship stage.
   */
  cohortIntegration?: boolean
}

export interface ReconcileWorktreesResult {
  status: 'merged' | 'conflict'
  target: string
  target_branch: string
  /** `worktree` merges inside a recorded worktree; `checkout` merges inside the checkout that already holds the target branch. */
  target_kind: 'worktree' | 'checkout'
  target_path: string
  sources: string[]
  merged_sources: string[]
  conflicted_source?: string
  conflicted_paths: string[]
  conflict_request?: string
  /** True when a conflict inside a held checkout was aborted to restore it. */
  merge_aborted?: boolean
  evidence_path: string
}

/**
 * True when the name is lowercase alphanumeric words joined by single
 * hyphens.
 */
export function isWorktreeName(value: string): boolean {
  return WORKTREE_NAME_PATTERN.test(value)
}

interface OperatorWorktreeStore {
  indexPath: string
  mutexPath: string
  newWorktreeRoot: string
}

function resolveOperatorWorktreeStore(root: string): OperatorWorktreeStore {
  const declared = configuredWorktreeRoot(root)

  if (declared !== undefined) {
    return {
      indexPath: resolveInside(root, path.join(declared, 'index.json')),
      mutexPath: resolveInside(root, path.join(declared, '.operation-mutex')),
      newWorktreeRoot: declared,
    }
  }

  const currentIndex = resolveInside(
    root,
    path.join(DEFAULT_WORKTREE_ROOT, 'index.json'),
  )
  const legacyIndex = resolveInside(
    root,
    path.join(LEGACY_DEFAULT_WORKTREE_ROOT, 'index.json'),
  )
  const currentExists = fileExists(currentIndex)
  const legacyExists = fileExists(legacyIndex)

  invariant(
    !(currentExists && legacyExists),
    `Both operator worktree indexes exist: ${toRepoRelative(root, currentIndex)} ` +
      `and ${toRepoRelative(root, legacyIndex)}. Remove or merge one index ` +
      'before continuing.',
    { code: 'WORKTREE_INDEX_CONFLICT' },
  )

  if (legacyExists) {
    return {
      indexPath: legacyIndex,
      mutexPath: resolveInside(
        root,
        path.join(LEGACY_DEFAULT_WORKTREE_ROOT, '.operation-mutex'),
      ),
      newWorktreeRoot: DEFAULT_WORKTREE_ROOT,
    }
  }

  return {
    indexPath: currentIndex,
    mutexPath: resolveInside(
      root,
      path.join(DEFAULT_WORKTREE_ROOT, '.operation-mutex'),
    ),
    newWorktreeRoot: DEFAULT_WORKTREE_ROOT,
  }
}

/**
 * Path of the operator worktree index: under the configured worktree root, or
 * the legacy default root when only its index exists, else the current
 * default. Throws `PanError` `WORKTREE_INDEX_CONFLICT` when both default
 * indexes exist.
 */
export function worktreeIndexPath(root: string): string {
  return resolveOperatorWorktreeStore(root).indexPath
}

/**
 * Path of the operation mutex that serializes worktree index changes, beside
 * the resolved index. Throws `PanError` `WORKTREE_INDEX_CONFLICT` when both
 * default indexes exist.
 */
export function worktreeMutexPath(root: string): string {
  return resolveOperatorWorktreeStore(root).mutexPath
}

/**
 * Harness-relative directory new worktrees are created under: the configured
 * worktree root, else the current default even while a legacy index is in
 * use. Throws `PanError` `WORKTREE_INDEX_CONFLICT` when both default indexes
 * exist.
 */
export function newWorktreeRoot(root: string): string {
  return resolveOperatorWorktreeStore(root).newWorktreeRoot
}

/**
 * Copy the recognized local harness override into a new self-development
 * worktree before setup runs. Target installations keep harness configuration
 * at the installation root and receive no override copy.
 *
 * Exported so a test can drive the copy failure directly; a worktree creation
 * that reaches this point has already added a Git worktree, which is too much
 * setup to stand behind one filesystem error.
 */
export function handoffSelfDevelopmentLocalConfig(
  installationRoot: string,
  worktreePath: string,
): void {
  if (!isSelfDevelopmentInstallation(installationRoot)) {
    return
  }

  const configName = localConfigName(installationRoot)
  const sourcePath = path.join(installationRoot, configName)

  if (!fileExists(sourcePath)) {
    return
  }

  const targetPath = path.join(worktreePath, configName)

  try {
    copyFileSync(sourcePath, targetPath)
  } catch (error) {
    // Without the wrapper this escaped as a bare Node.js filesystem error,
    // so an agent facing it had no code to act on and no named operation.
    throw new PanError(
      `Failed to copy the local harness override '${configName}' into the ` +
        `new worktree: ${errorMessage(error)}`,
      {
        code: 'WORKTREE_OVERRIDE_COPY_FAILED',
        details: {
          operation: 'configuration_handoff',
          file: configName,
          source: sourcePath,
          target: targetPath,
        },
      },
    )
  }
}

/**
 * Place every recorded read-only input into a new worktree.
 *
 * An operator who attributed an input once should not copy it into each new
 * worktree by hand. Placement reads the attribution records themselves, so
 * nothing new has to be declared in configuration, and a path already present
 * in the new worktree is left alone.
 */
export function carryAttributedInputs(
  root: string,
  worktreePath: string,
): string[] {
  const carried = new Set<string>()

  for (const record of workspaceAttributions(root, worktreePath)) {
    if (workspaceAttributionDisposition(record) !== 'read-only-input') {
      continue
    }

    if (!fileExists(record.recorded_in)) {
      continue
    }

    for (const relative of record.paths) {
      const source = resolveInside(record.recorded_in, relative)
      const destination = resolveInside(worktreePath, relative)

      if (!fileExists(source) || fileExists(destination)) {
        continue
      }

      try {
        ensureDir(path.dirname(destination))
        copyFileSync(source, destination)
      } catch (error) {
        // Mirrors WORKTREE_OVERRIDE_COPY_FAILED: a bare filesystem error at
        // this point names no operation an agent can act on.
        throw new PanError(
          `Failed to copy the recorded read-only input '${relative}' into ` +
            `the new worktree: ${errorMessage(error)}`,
          {
            code: 'WORKTREE_CARRY_COPY_FAILED',
            details: {
              operation: 'attributed_input_placement',
              file: relative,
              source,
              target: destination,
            },
          },
        )
      }

      carried.add(relative)
    }
  }

  return [...carried].sort()
}
