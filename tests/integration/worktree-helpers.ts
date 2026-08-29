import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { createWorktree as createWorktreeRecord } from '../../src/lib/worktrees.js'
import type { WorktreeRecord } from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'

import { cloneTree, repairClonedWorktrees } from './best-of-n-helpers.js'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

export interface CreatedWorktree {
  status: 'created'
  worktree: {
    name: string
    path: string
    branch: string
    created_from: string
    description: string
    created_at: string
  }
}

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

export function runCli<T>(root: string, args: string[]): T {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    }),
  ) as T
}

export function createWorktree(
  root: string,
  name: string,
  options: string[] = [],
): CreatedWorktree['worktree'] {
  return runCli<CreatedWorktree>(root, ['worktree', 'create', name, ...options])
    .worktree
}

export function commitFile(
  worktreePath: string,
  filename: string,
  content: string,
): string {
  writeFileSync(path.join(worktreePath, filename), content)
  git(worktreePath, ['add', filename])
  git(worktreePath, ['commit', '-qm', `add ${filename}`])

  return git(worktreePath, ['rev-parse', 'HEAD']).trim()
}

// A linked worktree holds absolute gitdir pointers, so each `cp -Rc` clone
// needs `git worktree repair` before use.

/**
 * - `single`: one operator worktree `alpha`.
 * - `two-sources`: `source-one` and `source-two`, each with one committed file
 *   (`one.txt` / `two.txt`).
 * - `conflict`: `source-one` commits `one.txt`, `source-two` commits
 *   `shared.txt`, and the main checkout commits a conflicting `shared.txt`.
 */
export type WorktreeCheckpointKey = 'single' | 'two-sources' | 'conflict'

export interface WorktreeCheckpoint {
  root: string
  worktrees: Record<string, WorktreeRecord>
  /** HEAD of the main checkout when the checkpoint was built. */
  mainHead: string
  mainBranch: string
}

const worktreeCheckpointTemplates = new Map<
  WorktreeCheckpointKey,
  Omit<WorktreeCheckpoint, 'root'> & { root: string }
>()

function buildWorktreeTemplate(key: WorktreeCheckpointKey): WorktreeCheckpoint {
  const root = createFixture()
  const worktrees: Record<string, WorktreeRecord> = {}
  const add = (name: string, description: string) => {
    worktrees[name] = createWorktreeRecord(root, name, { description })
  }

  if (key === 'single') {
    add('alpha', 'Alpha worktree')
  } else {
    add('source-one', 'First source')
    add('source-two', 'Second source')
    commitFile(
      path.join(root, worktrees['source-one'].path),
      'one.txt',
      'one\n',
    )

    if (key === 'two-sources') {
      commitFile(
        path.join(root, worktrees['source-two'].path),
        'two.txt',
        'two\n',
      )
    } else {
      commitFile(
        path.join(root, worktrees['source-two'].path),
        'shared.txt',
        'source\n',
      )
      commitFile(root, 'shared.txt', 'target\n')
    }
  }

  return {
    root,
    worktrees,
    mainHead: git(root, ['rev-parse', 'HEAD']).trim(),
    mainBranch: git(root, ['symbolic-ref', '--short', 'HEAD']).trim(),
  }
}

export function worktreeCheckpoint(
  key: WorktreeCheckpointKey,
): WorktreeCheckpoint {
  let template = worktreeCheckpointTemplates.get(key)

  if (!template) {
    template = buildWorktreeTemplate(key)
    worktreeCheckpointTemplates.set(key, template)
  }

  const root = cloneTree(template.root)

  repairClonedWorktrees(
    root,
    Object.values(template.worktrees).map((record) => record.path),
  )

  return {
    root,
    worktrees: structuredClone(template.worktrees),
    mainHead: template.mainHead,
    mainBranch: template.mainBranch,
  }
}
