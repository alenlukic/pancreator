/**
 * Merge signatures, linked worktree management, dirty-entry inspection, and
 * branch merges.
 */

import path from 'node:path'

import { runGit } from './core.js'
import { parsePorcelainStatus } from './branches.js'

/**
 * Sorted `"<parent count> <subject>"` signatures of every merge commit in one
 * revision range. A rebase rewrites commit hashes, so identity cannot tell
 * whether the replayed history still carries its merges; the parent arity and
 * subject of each merge survive `--rebase-merges` and do not survive a
 * flattening rebase, which is the loss this signature exists to detect.
 */
export function gitMergeSignatures(root: string, range: string): string[] {
  const result = runGit(root, [
    'log',
    '--merges',
    '--no-decorate',
    '--format=%P%x1f%s',
    range,
  ])

  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf('\u001f')
      const parents = line.slice(0, separator).split(' ').filter(Boolean)

      return `${parents.length} ${line.slice(separator + 1)}`
    })
    .sort()
}

/**
 * Create a detached worktree at `commit`.
 *
 * Detached is deliberate: a best-of-N candidate is disposable exploration, and
 * a branch would leave a named ref behind that only an operator may delete.
 */
export function gitWorktreeAdd(
  root: string,
  worktreePath: string,
  commit: string,
): void {
  runGit(root, ['worktree', 'add', '--detach', worktreePath, commit])
}

/** Create a persistent worktree on a new named branch. */
export function gitWorktreeAddOnBranch(
  root: string,
  worktreePath: string,
  branch: string,
  commit: string,
): void {
  runGit(root, ['worktree', 'add', '-b', branch, worktreePath, commit])
}

/**
 * Create a worktree that checks out an existing branch. Git itself refuses a
 * branch that another worktree or the main checkout already holds.
 */
export function gitWorktreeAddOnExistingBranch(
  root: string,
  worktreePath: string,
  branch: string,
): void {
  runGit(root, ['worktree', 'add', worktreePath, branch])
}

/** Drop stale worktree registrations whose directories no longer exist. */
export function gitWorktreePrune(root: string): void {
  runGit(root, ['worktree', 'prune'])
}

/**
 * Absolute path of the checkout that holds `branch`, or `null` when no
 * checkout holds it. The main checkout counts as a checkout here, because Git
 * lists it first in `git worktree list`.
 */
export function gitWorktreeForBranch(
  root: string,
  branch: string,
): string | null {
  const result = runGit(root, ['worktree', 'list', '--porcelain'], {
    allowFailure: true,
  })

  if (result.status !== 0) {
    return null
  }

  let currentPath: string | null = null

  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim()
    } else if (line === `branch refs/heads/${branch}` && currentPath) {
      return path.resolve(currentPath)
    }
  }

  return null
}

/** Absolute paths of every worktree registered in this repository. */
export function gitWorktreePaths(root: string): string[] {
  const result = runGit(root, ['worktree', 'list', '--porcelain'], {
    allowFailure: true,
  })

  if (result.status !== 0) {
    return []
  }

  return result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .sort()
}

/**
 * Run `git worktree remove` for the path, deleting its checkout and
 * registration; `force` also discards uncommitted changes. Throws `PanError`
 * `GIT_FAILED` when Git refuses.
 */
export function gitWorktreeRemove(
  root: string,
  worktreePath: string,
  force = false,
): void {
  runGit(root, [
    'worktree',
    'remove',
    ...(force ? ['--force'] : []),
    worktreePath,
  ])
}

/** Whether a worktree holds uncommitted work an operator has not preserved. */
export function gitWorktreeIsDirty(worktreePath: string): boolean {
  const result = runGit(
    worktreePath,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { allowFailure: true },
  )

  return result.status !== 0 || result.stdout.trim().length > 0
}

/** One path porcelain status reports for a worktree. */
export interface GitDirtyEntry {
  /** Repository-relative path. */
  path: string
  /** False only for an untracked (`??`) entry. */
  tracked: boolean
}

/**
 * Every path porcelain status reports for one worktree, sorted.
 *
 * `gitWorktreeIsDirty` answers whether anything is there; this answers what,
 * so a caller can judge each path on its own. A status read that fails
 * returns no entries, which is indistinguishable from a clean tree here, so a
 * caller that must not read an unreadable worktree as clean keeps
 * `gitWorktreeIsDirty` as its dirty signal. Both sides of a rename are
 * tracked paths.
 */
export function gitDirtyEntries(worktreePath: string): GitDirtyEntry[] {
  const result = runGit(
    worktreePath,
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    { allowFailure: true },
  )

  if (result.status !== 0) {
    return []
  }

  const tracked = new Map<string, boolean>()

  for (const entry of parsePorcelainStatus(result.stdout)) {
    tracked.set(entry.path, entry.status !== '??')

    if (entry.source) {
      tracked.set(entry.source, true)
    }
  }

  return [...tracked]
    .map(([relativePath, isTracked]) => ({
      path: relativePath,
      tracked: isTracked,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export interface GitMergeResult {
  succeeded: boolean
  stdout: string
  stderr: string
}

/** Merge one branch and preserve failure output for conflict handling. */
export function gitMergeBranch(
  worktreePath: string,
  branch: string,
): GitMergeResult {
  const result = runGit(
    worktreePath,
    ['merge', '--no-ff', '--no-edit', branch],
    { allowFailure: true },
  )

  return {
    succeeded: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/** Abort a stopped merge and restore the checkout to its pre-merge state. */
export function gitMergeAbort(worktreePath: string): void {
  runGit(worktreePath, ['merge', '--abort'])
}
