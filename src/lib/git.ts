import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { PanError } from './errors.js'
import { sha256 } from './io.js'
import type { WorkspaceDelta, WorkspaceSnapshot } from './types.js'
import {
  isProtectedWorkspacePath,
  protectedGitPathspecs,
} from './workspace/protected-paths.js'

interface RunGitOptions {
  allowFailure?: boolean
}

function runGit(
  root: string,
  args: string[],
  options: RunGitOptions = {},
): SpawnSyncReturns<string> {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (!options.allowFailure && result.status !== 0) {
    throw new PanError(
      `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
      { code: 'GIT_FAILED' },
    )
  }

  return result
}

export function isGitRepository(root: string): boolean {
  const result = runGit(root, ['rev-parse', '--is-inside-work-tree'], {
    allowFailure: true,
  })

  return result.status === 0
}

export function gitHead(root: string): string | null {
  const result = runGit(root, ['rev-parse', 'HEAD'], { allowFailure: true })

  return result.status === 0 ? result.stdout.trim() : null
}

/** Commit hash of a branch, tag, or revision expression. */
export function gitRevParse(root: string, reference: string): string {
  const result = runGit(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${reference}^{commit}`,
  ])

  return result.stdout.trim()
}

/** Merge-base of two revisions, or null when they share no history. */
export function gitMergeBase(
  root: string,
  left: string,
  right: string,
): string | null {
  const result = runGit(root, ['merge-base', '--end-of-options', left, right], {
    allowFailure: true,
  })

  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * Repository-relative paths a three-dot diff changes between two revisions.
 *
 * Three dots, not two: a review judges what the head added since the branches
 * parted, not what the base gained meanwhile.
 */
export function gitChangedPathsBetween(
  root: string,
  base: string,
  head: string,
  options: { detectRenames?: boolean } = {},
): string[] {
  // With rename detection on, Git names only the destination of a rename. A
  // consumer that matches paths against patterns needs both sides.
  const result = runGit(root, [
    'diff',
    '--name-only',
    ...(options.detectRenames === false ? ['--no-renames'] : []),
    '--end-of-options',
    `${base}...${head}`,
  ])

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort()
}

/** Contents of a tracked file at a revision, or null when absent there. */
export function gitShowFile(
  root: string,
  reference: string,
  relativePath: string,
): string | null {
  const result = runGit(
    root,
    ['show', '--end-of-options', `${reference}:${relativePath}`],
    { allowFailure: true },
  )

  return result.status === 0 ? result.stdout : null
}

export function gitBranchExists(root: string, branch: string): boolean {
  const result = runGit(
    root,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { allowFailure: true },
  )

  return result.status === 0
}

export function gitBranchNameIsValid(root: string, branch: string): boolean {
  const result = runGit(root, ['check-ref-format', '--branch', branch], {
    allowFailure: true,
  })

  return result.status === 0
}

/** Branch a checkout currently holds, or `null` when HEAD is detached. */
export function gitCurrentBranch(root: string): string | null {
  const result = runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFailure: true,
  })

  return result.status === 0 ? result.stdout.trim() : null
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

/** Paths a stopped merge left in the unmerged state, sorted. */
export function gitConflictedPaths(worktreePath: string): string[] {
  const result = runGit(
    worktreePath,
    ['diff', '--name-only', '--diff-filter=U', '-z'],
    { allowFailure: true },
  )

  if (result.status !== 0) {
    return []
  }

  return result.stdout.split('\0').filter(Boolean).sort()
}

function trackedWorkspacePath(
  entry: string,
  workspacePrefix: string,
): string | null {
  const normalizedEntry = entry.replaceAll('\\', '/')
  const normalizedPrefix = workspacePrefix.replaceAll('\\', '/')

  if (normalizedPrefix.length === 0) {
    return normalizedEntry
  }

  return normalizedEntry.startsWith(normalizedPrefix)
    ? normalizedEntry.slice(normalizedPrefix.length)
    : normalizedEntry
}

export function gitTrackedWorkspacePaths(workspaceDir: string): string[] {
  if (!isGitRepository(workspaceDir)) {
    return []
  }

  const prefixResult = runGit(workspaceDir, ['rev-parse', '--show-prefix'], {
    allowFailure: true,
  })
  const workspacePrefix =
    prefixResult.status === 0 ? prefixResult.stdout.trim() : ''
  const tracked = runGit(workspaceDir, [
    'ls-files',
    '-z',
    '--',
    '.',
    ...protectedGitPathspecs(),
  ])

  return tracked.stdout
    .split('\0')
    .filter(Boolean)
    .map((entry) => trackedWorkspacePath(entry, workspacePrefix))
    .filter(
      (relative): relative is string =>
        typeof relative === 'string' &&
        relative.length > 0 &&
        !relative.startsWith('runtime/') &&
        !isProtectedWorkspacePath(relative),
    )
    .sort()
}

function contentFingerprint(
  root: string,
  entries: string[],
): Array<[string, string]> {
  const files: Array<[string, string]> = []

  for (const entry of entries) {
    const relative = snapshotEntryPath(entry)

    if (
      !relative ||
      relative.startsWith('runtime/') ||
      isProtectedWorkspacePath(relative)
    ) {
      continue
    }

    const absolute = path.join(root, relative)

    try {
      if (statSync(absolute).isFile()) {
        files.push([relative, sha256(readFileSync(absolute))])
      }
    } catch {
      files.push([relative, 'missing'])
    }
  }

  return files.sort(([left], [right]) => left.localeCompare(right))
}

/** Path component of one `git status --porcelain=v1` snapshot entry. */
export function snapshotEntryPath(entry: string): string {
  const statusPath = entry.length >= 4 ? entry.slice(3) : entry
  const renameArrow = statusPath.lastIndexOf(' -> ')

  return renameArrow === -1 ? statusPath : statusPath.slice(renameArrow + 4)
}

function indexEntryPath(entry: string): string {
  const tab = entry.indexOf('\t')

  return tab === -1 ? entry : entry.slice(tab + 1)
}

/**
 * Fingerprint the Git state of a deliverable workspace directory.
 *
 * `workspaceDir` MAY be a nested repository (for example a gitignored project
 * capsule that is its own repository). Git runs with that directory as its
 * working directory and is scoped to it with a `.` pathspec, so changes inside
 * the deliverable are observed even when the surrounding repository ignores it.
 * Paths from Git are relative to that repository's top level, so file contents
 * are read from the resolved top level rather than from `workspaceDir`.
 */
export function gitWorkspaceSnapshot(workspaceDir: string): WorkspaceSnapshot {
  if (!isGitRepository(workspaceDir)) {
    return {
      kind: 'filesystem',
      fingerprint: sha256('no-git'),
      entries: [],
    }
  }

  const toplevelResult = runGit(
    workspaceDir,
    ['rev-parse', '--show-toplevel'],
    {
      allowFailure: true,
    },
  )
  const toplevel =
    toplevelResult.status === 0 ? toplevelResult.stdout.trim() : workspaceDir
  const status = runGit(workspaceDir, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '-z',
    '--',
    '.',
    ...protectedGitPathspecs(),
  ])
  const entries = status.stdout
    .split('\0')
    .filter(Boolean)
    .filter((entry) => {
      const relative = snapshotEntryPath(entry)

      return (
        !relative.startsWith('runtime/') && !isProtectedWorkspacePath(relative)
      )
    })
    .sort()

  const indexResult = runGit(workspaceDir, [
    'ls-files',
    '--stage',
    '-z',
    '--',
    '.',
    ...protectedGitPathspecs(),
  ])
  const indexEntries = indexResult.stdout
    .split('\0')
    .filter(Boolean)
    .filter((entry) => !isProtectedWorkspacePath(indexEntryPath(entry)))
    .sort()
  const head = gitHead(workspaceDir)
  const content = contentFingerprint(toplevel, entries)

  return {
    kind: 'git',
    head,
    fingerprint: sha256({
      entries,
      index: sha256(indexEntries.join('\0')),
      content,
    }),
    entries,
    dirty_content: Object.fromEntries(content),
  }
}

/**
 * Paths that differ between two snapshots.
 *
 * A path counts as changed when its Git status entry differs *or* when its
 * content hash differs. Comparing status entries alone misses an edit to a
 * path that was already dirty in `before`, because the status code stays
 * identical — the case that let ship-stage edits to feature-dirty
 * documentation pass unattributed.
 */
export function workspaceChangedPathsFromSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  const beforeByPath = new Map(
    before.entries.map((entry) => [snapshotEntryPath(entry), entry]),
  )
  const afterByPath = new Map(
    after.entries.map((entry) => [snapshotEntryPath(entry), entry]),
  )
  // Absent maps mean a snapshot predates content hashing; fall back to entry
  // comparison rather than reporting every dirty path as changed.
  const comparableContent =
    before.dirty_content !== undefined && after.dirty_content !== undefined
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()])

  return [...paths]
    .filter(
      (relativePath) =>
        beforeByPath.get(relativePath) !== afterByPath.get(relativePath) ||
        (comparableContent &&
          before.dirty_content?.[relativePath] !==
            after.dirty_content?.[relativePath]),
    )
    .filter((relativePath) => !isProtectedWorkspacePath(relativePath))
    .sort()
}

export function snapshotChanged(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): boolean {
  return before.fingerprint !== after.fingerprint
}

export function workspaceDelta(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): WorkspaceDelta {
  const beforeSet = new Set(before.entries)
  const afterSet = new Set(after.entries)

  return {
    added: [...afterSet].filter((entry) => !beforeSet.has(entry)),
    removed: [...beforeSet].filter((entry) => !afterSet.has(entry)),
  }
}
