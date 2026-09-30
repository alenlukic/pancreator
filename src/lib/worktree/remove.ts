/**
 * Worktree test-scratch sweeps, worktree removal, and merged-branch deletion.
 */

import { spawn } from 'node:child_process'
import { renameSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import {
  gitDefaultBranch,
  gitIsAncestor,
  gitDeleteBranch,
} from '../git/branches.js'
import { gitBranchExists } from '../git/core.js'
import { gitWorktreeRemove, gitWorktreePrune } from '../git/worktree-merge.js'
import { fileExists, withOperationMutex } from '../io.js'
import { testScratchRoot } from '../test-scratch.js'
import {
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  DISCARDED_SCRATCH_NAME,
  worktreeMutexPath,
  type RemoveWorktreeResult,
} from './store.js'
import {
  absoluteWorktreePath,
  isPresent,
  persistWorktreeIndex,
  readWorktreeIndex,
  recordByName,
  registeredWorktreePaths,
  resolveRecordRepository,
} from './registry.js'

/** A worktree's scratch root, or null when its configuration cannot say. */
function worktreeScratchRoot(worktreePath: string): string | null {
  try {
    return testScratchRoot(worktreePath)
  } catch {
    return null
  }
}

/**
 * Where a worktree's scratch goes to be removed. Scratch inside the worktree
 * leaves it for the worktrees root, so Git never removes a tree a detached
 * remover is still deleting. Scratch under a configured root stays beside
 * itself, where a rename cannot cross volumes.
 */
function scratchDiscardDirectory(
  worktreePath: string,
  scratch: string,
): string {
  const relative = path.relative(worktreePath, scratch)

  return relative.startsWith('..') || path.isAbsolute(relative)
    ? path.dirname(scratch)
    : path.dirname(worktreePath)
}

function startDetachedScratchRemoval(target: string): void {
  const remover = spawn('/bin/rm', ['-rf', target], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  })

  remover.once('error', () => {
    // The discarded tree stays beside the worktrees root for the next sweep.
  })
  remover.unref()
}

/**
 * Move test scratch out of a worktree and remove it from a detached process,
 * answering where the tree went.
 *
 * Removing the tree in place would charge the operator's worktree command a
 * recursive unlink of a cloned fixture tree. A rename inside the worktrees
 * root is a metadata operation, so the command returns when Git returns. A
 * failed handoff leaves Git removal authoritative and never fails the
 * command.
 */
export function sweepWorktreeTestScratch(worktreePath: string): string | null {
  const scratch = worktreeScratchRoot(worktreePath)

  if (!scratch || !fileExists(scratch)) {
    return null
  }

  const discarded = path.join(
    scratchDiscardDirectory(worktreePath, scratch),
    `.${path.basename(worktreePath)}-tests-${process.pid}-${Date.now()}.noindex`,
  )

  try {
    renameSync(scratch, discarded)
  } catch {
    return null
  }

  startDetachedScratchRemoval(discarded)

  return discarded
}

/**
 * Retry the scratch removals earlier sweeps handed off and lost.
 *
 * A detached remover can still die with the session that started it, which
 * is how 699 fixture clones once accumulated, and a discarded tree beside
 * the worktrees root is visited by no other cleanup. Restarting `rm -rf` on
 * a tree another remover is already deleting is harmless, so this needs no
 * ownership marker to keep two removers apart.
 */
export function sweepDiscardedWorktreeScratch(directory: string): string[] {
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch {
    return []
  }

  const discarded = names
    .filter((name) => DISCARDED_SCRATCH_NAME.test(name))
    .map((name) => path.join(directory, name))
    .sort()

  for (const target of discarded) {
    startDetachedScratchRemoval(target)
  }

  return discarded
}

/**
 * Remove one operator worktree and its index entry.
 *
 * Removing a worktree discards uncommitted work, so a dirty worktree is
 * refused without an explicit force flag. A worktree the operator already
 * deleted by hand leaves only its stale registration, which is pruned here.
 */
export function removeWorktree(
  root: string,
  name: string,
  options: { force?: boolean; deleteBranch?: boolean } = {},
): RemoveWorktreeResult {
  return withOperationMutex(worktreeMutexPath(root), () => {
    const index = readWorktreeIndex(root)
    const record = recordByName(index, name)
    const worktreePath = absoluteWorktreePath(root, record)

    const resolved = resolveRecordRepository(root, record)
    const repositoryRoot = resolved.repositoryRoot
    const present =
      repositoryRoot !== null &&
      isPresent(registeredWorktreePaths(repositoryRoot), worktreePath)

    // Presence is resolved and the dirty refusal fires before any mutation,
    // so a removal that removes nothing leaves the record for the retry.
    const cleanliness = present
      ? workspaceCleanliness(root, worktreePath)
      : null

    if (cleanliness && !cleanliness.clean && !options.force) {
      invariant(
        false,
        cleanTreeRefusal(cleanliness, {
          action: `WARNING: worktree '${name}' cannot be removed`,
          remedy:
            'Removing it discards that work. Pass --force to remove it ' +
            'anyway.',
        }),
        { code: 'WORKTREE_DIRTY' },
      )
    }

    invariant(
      present || !fileExists(worktreePath),
      `Worktree '${name}' exists at ${record.path} but no repository ` +
        'registers it, so removal would drop the record for a directory ' +
        'that stays on disk. Remove the directory yourself, or repair the ' +
        'record with `./bin/pan worktree resolve ' +
        `${name}\`.`,
      { code: 'WORKTREE_UNRESOLVED' },
    )

    let discardedScratch: string | null = null

    if (present && repositoryRoot) {
      sweepDiscardedWorktreeScratch(path.dirname(worktreePath))

      const scratch = worktreeScratchRoot(worktreePath)

      if (scratch) {
        const discardDirectory = scratchDiscardDirectory(worktreePath, scratch)

        if (discardDirectory !== path.dirname(worktreePath)) {
          sweepDiscardedWorktreeScratch(discardDirectory)
        }
      }

      discardedScratch = sweepWorktreeTestScratch(worktreePath)
      // Git refuses to remove a worktree that still holds changes, so an
      // exempt read-only input carries the force its exemption granted.
      gitWorktreeRemove(
        repositoryRoot,
        worktreePath,
        options.force === true || (cleanliness?.exempt.length ?? 0) > 0,
      )
    } else if (repositoryRoot) {
      gitWorktreePrune(repositoryRoot)
    }

    const branchDeletion =
      options.deleteBranch && repositoryRoot
        ? deleteMergedBranch(repositoryRoot, record.branch)
        : null

    persistWorktreeIndex(root, {
      schema_version: 1,
      worktrees: index.worktrees.filter((entry) => entry.name !== name),
    })

    return {
      name,
      path: record.path,
      ...(branchDeletion?.deleted
        ? { deleted_branch: record.branch }
        : { kept_branch: record.branch }),
      ...(branchDeletion && !branchDeletion.deleted
        ? { branch_deletion_refused: branchDeletion.reason }
        : {}),
      removed_worktree: present,
      pruned_index_entry: !present,
      ...(discardedScratch ? { discarded_test_scratch: discardedScratch } : {}),
    }
  })
}

/**
 * Delete a worktree branch once the default branch already holds its history.
 *
 * Every removal in the recorded cleanup returned `kept_branch` and cost a
 * separate `git branch -d`. Deletion stays bounded to a branch that is an
 * ancestor of the default branch, so unmerged work is never discarded here.
 */
function deleteMergedBranch(
  repositoryRoot: string,
  branch: string,
): { deleted: boolean; reason: string } {
  if (!gitBranchExists(repositoryRoot, branch)) {
    return { deleted: false, reason: `Branch '${branch}' does not exist.` }
  }

  const defaultBranch = gitDefaultBranch(repositoryRoot)

  if (!defaultBranch) {
    return {
      deleted: false,
      reason: 'The repository has no resolvable default branch.',
    }
  }

  if (!gitIsAncestor(repositoryRoot, branch, defaultBranch)) {
    return {
      deleted: false,
      reason:
        `Branch '${branch}' is not an ancestor of '${defaultBranch}', so it ` +
        'carries work the default branch does not hold.',
    }
  }

  const result = gitDeleteBranch(repositoryRoot, branch)

  return {
    deleted: result.deleted,
    reason: result.reason ?? `Branch '${branch}' was deleted.`,
  }
}
