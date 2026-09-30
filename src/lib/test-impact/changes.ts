/** The Git change set a selection starts from. */

import { spawnSync } from 'node:child_process'

import { PanError } from '../errors.js'
import { gitChangedPathsBetween, gitHead, isGitRepository } from '../git.js'
import type { ImpactOptions } from './model.js'

// --- Change set -------------------------------------------------------------

function gitLines(root: string, args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.status !== 0) {
    throw new PanError(`git ${args.join(' ')} failed: ${result.stderr}`, {
      code: 'GIT_FAILED',
    })
  }

  return result.stdout.split('\0').filter((line) => line.length > 0)
}

/** Paths with staged, unstaged, or untracked changes against HEAD. */
export function dirtyPaths(root: string): string[] {
  if (!isGitRepository(root)) {
    return []
  }

  const entries = gitLines(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ])

  return entries
    .map((entry) => (entry.length >= 4 ? entry.slice(3) : entry))
    .filter((entry) => entry.length > 0 && !entry.endsWith('/'))
}

/** Paths staged in the index relative to HEAD, or an empty list outside a Git repository. Runs `git diff --cached`. */
export function stagedPaths(root: string): string[] {
  if (!isGitRepository(root)) {
    return []
  }

  return gitLines(root, ['diff', '--name-only', '--cached', '-z'])
}

/** Resolve the change set the options describe. */
export function resolveChangeSet(
  root: string,
  options: ImpactOptions,
): string[] {
  const changed = new Set<string>(options.files ?? [])

  if (options.staged) {
    for (const file of stagedPaths(root)) {
      changed.add(file)
    }
  } else if (options.changed) {
    const head = gitHead(root)

    if (!head) {
      throw new PanError('--changed needs a Git repository with a HEAD.', {
        code: 'GIT_FAILED',
      })
    }

    for (const file of gitChangedPathsBetween(root, options.changed, 'HEAD')) {
      changed.add(file)
    }

    for (const file of dirtyPaths(root)) {
      changed.add(file)
    }
  } else if (options.worktreeDirty || (options.files ?? []).length === 0) {
    for (const file of dirtyPaths(root)) {
      changed.add(file)
    }
  }

  return [...changed].sort()
}
