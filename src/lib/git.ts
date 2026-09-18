import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
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
  env?: NodeJS.ProcessEnv
}

function runGit(
  root: string,
  args: string[],
  options: RunGitOptions = {},
): SpawnSyncReturns<string> {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env,
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

// Cache a positive answer only. A directory can become a repository after a
// negative check, but a repository never stops being one in a live process.
const gitRepositoryCache = new Map<string, true>()

export function isGitRepository(root: string): boolean {
  const resolved = path.resolve(root)

  if (gitRepositoryCache.has(resolved)) {
    return true
  }

  const result = runGit(root, ['rev-parse', '--is-inside-work-tree'], {
    allowFailure: true,
  })

  if (result.status === 0) {
    gitRepositoryCache.set(resolved, true)
  }

  return result.status === 0
}

export function gitHead(root: string): string | null {
  const result = runGit(root, ['rev-parse', 'HEAD'], { allowFailure: true })

  return result.status === 0 ? result.stdout.trim() : null
}

/** Absolute top-level directory of the repository that contains `directory`. */
export function gitToplevel(directory: string): string {
  return runGit(directory, ['rev-parse', '--show-toplevel']).stdout.trim()
}

/**
 * Absolute common Git directory of the repository that contains `directory`.
 *
 * The main checkout and every linked worktree report the same directory, so
 * this is the identity that reaches every checkout of one repository. Git
 * answers relatively inside the main checkout, so the value is resolved
 * against the directory it was asked about and then canonicalized, because a
 * repository reached through a symlinked parent must still compare equal.
 */
export function gitCommonDir(directory: string): string {
  const reported = runGit(directory, [
    'rev-parse',
    '--git-common-dir',
  ]).stdout.trim()
  const absolute = path.resolve(directory, reported)

  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
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

/** Repository-relative paths a three-dot diff changes between two revisions. */
export function gitChangedPathsBetween(
  root: string,
  base: string,
  head: string,
  options: { detectRenames?: boolean } = {},
): string[] {
  // With rename detection on, Git names only the destination of a rename.
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

/**
 * The local branch `ACTION-001` lands agent work on. `bin/install` creates it
 * from the target's HEAD on a fresh install or refresh when it is missing.
 */
export const INTEGRATION_BRANCH = 'pan-dev'

export interface IntegrationBranchReadiness {
  name: string
  /** `null` when the workspace is not a Git repository. */
  present: boolean | null
  advisory?: string
}

/**
 * Doctor's advisory view of the integration branch. A missing branch is a
 * readiness gap, not a failure: the next `./bin/install` refresh creates it,
 * and so does `git branch pan-dev`.
 */
export function integrationBranchReadiness(
  workspaceRoot: string,
): IntegrationBranchReadiness {
  if (!isGitRepository(workspaceRoot)) {
    return { name: INTEGRATION_BRANCH, present: null }
  }

  if (gitBranchExists(workspaceRoot, INTEGRATION_BRANCH)) {
    return { name: INTEGRATION_BRANCH, present: true }
  }

  return {
    name: INTEGRATION_BRANCH,
    present: false,
    advisory:
      `integration branch ${INTEGRATION_BRANCH} missing; ` +
      `run ./bin/install refresh or git branch ${INTEGRATION_BRANCH}`,
  }
}

/**
 * Default branch of the repository.
 *
 * The remote head is authoritative where it exists. A repository without one,
 * which includes every test fixture, falls back to the local `main` and then
 * to `master`.
 */
export function gitDefaultBranch(root: string): string | null {
  const remote = runGit(
    root,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    { allowFailure: true },
  )

  if (remote.status === 0) {
    return remote.stdout.trim().replace(/^origin\//u, '')
  }

  for (const candidate of ['main', 'master']) {
    if (gitBranchExists(root, candidate)) {
      return candidate
    }
  }

  return null
}

/** Delete a local branch. Returns the command's stderr on failure. */
export function gitDeleteBranch(
  root: string,
  branch: string,
): { deleted: boolean; reason: string | null } {
  const result = runGit(root, ['branch', '-d', '--end-of-options', branch], {
    allowFailure: true,
  })

  return result.status === 0
    ? { deleted: true, reason: null }
    : { deleted: false, reason: result.stderr.trim() || 'git branch -d failed' }
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

/** Create a local branch at one commit without checking it out. */
export function gitCreateBranch(
  root: string,
  branch: string,
  commit: string,
): void {
  runGit(root, ['branch', '--end-of-options', branch, commit])
}

/** Switch one clean checkout to an existing local branch. */
export function gitSwitchBranch(root: string, branch: string): void {
  runGit(root, ['switch', branch])
}

/** One entry of the null-separated porcelain status format. */
export interface PorcelainStatusEntry {
  /** Two-character status code. */
  status: string
  /** Destination path, or the only path when the entry is not a rename. */
  path: string
  /** Source path of a rename or a copy, absent otherwise. */
  source: string | null
}

/**
 * Read `git status --porcelain=v1 -z` output.
 *
 * In `-z` mode a rename emits two fields: the status-prefixed destination and
 * then the bare source path with no status prefix. A reader that treats every
 * field as status-prefixed removes the first three characters of the source
 * and produces a path that names no file. This is the one reader for the
 * format, so both the workspace snapshot and the status-path helper agree on
 * the rename shape.
 */
export function parsePorcelainStatus(stdout: string): PorcelainStatusEntry[] {
  const fields = stdout.split('\0').filter(Boolean)
  const entries: PorcelainStatusEntry[] = []

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ''
    const status = field.slice(0, 2)
    const destination = field.length >= 4 ? field.slice(3) : field
    const source = /[RC]/u.test(status) ? (fields[index + 1] ?? null) : null

    if (source !== null) {
      index += 1
    }

    entries.push({ status, path: destination, source })
  }

  return entries
}

/** Sorted worktree paths reported by porcelain status. */
export function gitStatusPaths(root: string): string[] {
  const result = runGit(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '-z',
  ])

  const paths = new Set<string>()

  for (const entry of parsePorcelainStatus(result.stdout)) {
    paths.add(entry.path)

    if (entry.source) {
      paths.add(entry.source)
    }
  }

  return [...paths].sort()
}

/** Stage an explicit set of repository-relative paths. */
export function gitStagePaths(root: string, paths: string[]): void {
  if (paths.length === 0) {
    return
  }

  runGit(root, ['add', '--', ...paths])
}

/** Create one local commit and return its immutable hash. */
export function gitCommit(root: string, message: string): string {
  runGit(root, ['commit', '-m', message])

  const head = gitHead(root)

  if (!head) {
    throw new PanError('Git created no readable commit.', {
      code: 'GIT_COMMIT_MISSING',
    })
  }

  return head
}

/** Configured remote names, sorted. */
export function gitRemotes(root: string): string[] {
  const result = runGit(root, ['remote'])

  return result.stdout.split(/\r?\n/u).filter(Boolean).sort()
}

/** Remote configured as the current branch upstream, when one exists. */
export function gitUpstreamRemote(root: string): string | null {
  const result = runGit(
    root,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { allowFailure: true },
  )

  if (result.status !== 0) {
    return null
  }

  const upstream = result.stdout.trim()
  const separator = upstream.indexOf('/')

  return separator > 0 ? upstream.slice(0, separator) : null
}

/** Fetch one remote branch and return the fetched commit. */
export function gitFetchBranch(
  root: string,
  remote: string,
  branch: string,
): string {
  runGit(root, ['fetch', '--no-tags', remote, branch])

  return gitRevParse(root, 'FETCH_HEAD')
}

export interface GitRebaseResult {
  succeeded: boolean
  stdout: string
  stderr: string
  conflicted_paths: string[]
}

/** Rebase the current branch and preserve conflicts for later continuation. */
export function gitRebaseOnto(root: string, commit: string): GitRebaseResult {
  const result = runGit(root, ['rebase', commit], { allowFailure: true })

  return {
    succeeded: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    conflicted_paths: gitConflictedPaths(root),
  }
}

/** Continue a prepared rebase without opening an interactive editor. */
export function gitRebaseContinue(root: string): GitRebaseResult {
  const result = runGit(root, ['rebase', '--continue'], {
    allowFailure: true,
    env: { ...process.env, GIT_EDITOR: 'true' },
  })

  return {
    succeeded: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    conflicted_paths: gitConflictedPaths(root),
  }
}

/** True when Git reports an active rebase state for this checkout. */
export function gitRebaseInProgress(root: string): boolean {
  const result = runGit(root, ['rev-parse', '--git-path', 'rebase-merge'], {
    allowFailure: true,
  })
  const mergePath = result.status === 0 ? result.stdout.trim() : ''
  const applyResult = runGit(
    root,
    ['rev-parse', '--git-path', 'rebase-apply'],
    {
      allowFailure: true,
    },
  )
  const applyPath = applyResult.status === 0 ? applyResult.stdout.trim() : ''

  return (
    (mergePath.length > 0 && statPathExists(root, mergePath)) ||
    (applyPath.length > 0 && statPathExists(root, applyPath))
  )
}

function statPathExists(root: string, candidate: string): boolean {
  try {
    statSync(
      path.isAbsolute(candidate) ? candidate : path.join(root, candidate),
    )
    return true
  } catch {
    return false
  }
}

/** True when `ancestor` is reachable from `descendant`. */
export function gitIsAncestor(
  root: string,
  ancestor: string,
  descendant = 'HEAD',
): boolean {
  const result = runGit(
    root,
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { allowFailure: true },
  )

  return result.status === 0
}

/** First parent of one commit, or null for a root commit. */
export function gitCommitParent(root: string, commit: string): string | null {
  const result = runGit(root, ['rev-parse', '--verify', `${commit}^`], {
    allowFailure: true,
  })

  return result.status === 0 ? result.stdout.trim() : null
}

/** Sorted paths changed by one commit against its first parent. */
export function gitCommitChangedPaths(root: string, commit: string): string[] {
  const result = runGit(root, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    commit,
  ])

  return result.stdout.split('\0').filter(Boolean).sort()
}

/** Subject line recorded by one commit. */
export function gitCommitSubject(root: string, commit: string): string {
  const result = runGit(root, ['show', '-s', '--format=%s', commit])

  return result.stdout.trim()
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

const gitDirCache = new Map<string, string>()
const toplevelCache = new Map<string, string>()
const trackedPathsCache = new Map<string, { token: string; paths: string[] }>()

/**
 * Invalidation token for the tracked-file cache. Every write to the git index
 * changes its mtime or size.
 */
function gitIndexToken(workspaceDir: string): string {
  let gitDir = gitDirCache.get(workspaceDir)

  if (!gitDir) {
    const result = runGit(workspaceDir, ['rev-parse', '--absolute-git-dir'], {
      allowFailure: true,
    })

    gitDir = result.status === 0 ? result.stdout.trim() : ''
    gitDirCache.set(workspaceDir, gitDir)
  }

  if (!gitDir) {
    return 'no-git-dir'
  }

  try {
    const stats = statSync(path.join(gitDir, 'index'))

    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return 'no-index'
  }
}

export function gitTrackedWorkspacePaths(workspaceDir: string): string[] {
  if (!isGitRepository(workspaceDir)) {
    return []
  }

  const token = gitIndexToken(workspaceDir)
  const cached = trackedPathsCache.get(workspaceDir)

  if (cached && cached.token === token) {
    return cached.paths
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

  const paths = tracked.stdout
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

  trackedPathsCache.set(workspaceDir, { token, paths })

  return paths
}

function entryContentFingerprint(
  root: string,
  entries: string[],
): Array<[string, string]> {
  return contentFingerprint(root, entries.map(snapshotEntryPath))
}

function contentFingerprint(
  root: string,
  paths: string[],
): Array<[string, string]> {
  const files: Array<[string, string]> = []

  for (const relative of paths) {
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

/**
 * Path component of one snapshot entry.
 *
 * Snapshot entries are always status-prefixed, because `parsePorcelainStatus`
 * normalizes a rename into one prefixed entry per path. The ` -> ` form this
 * also handles belongs to the non-`-z` porcelain output, which no caller here
 * requests; it stays for a caller that reads that form directly.
 */
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
 * Cheap activity digest of a workspace: its Git status entries plus the size
 * and mtime of every path they name. It answers "did anything move since the
 * last look" in one Git call and no content hashing, which is what a
 * fixed-cadence watch needs; `gitWorkspaceSnapshot` remains the fingerprint
 * that attributes changes.
 */
export function gitWorkspaceActivityFingerprint(workspaceDir: string): string {
  if (!isGitRepository(workspaceDir)) {
    return sha256('no-git')
  }

  // Porcelain v2 with --branch carries the HEAD oid in the same call, so a
  // commit registers as activity without a second Git process.
  const status = runGit(
    workspaceDir,
    [
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '-z',
      '--',
      '.',
    ],
    { allowFailure: true },
  )

  if (status.status !== 0) {
    return sha256(`status-failed:${status.status}`)
  }

  let toplevel = toplevelCache.get(workspaceDir)

  if (toplevel === undefined) {
    const toplevelResult = runGit(
      workspaceDir,
      ['rev-parse', '--show-toplevel'],
      { allowFailure: true },
    )

    toplevel =
      toplevelResult.status === 0 ? toplevelResult.stdout.trim() : workspaceDir
    toplevelCache.set(workspaceDir, toplevel)
  }

  const lines = status.stdout
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const relative = statusV2EntryPath(entry)

      if (relative === null) {
        return entry
      }

      if (relative.startsWith('runtime/')) {
        return null
      }

      try {
        const stats = statSync(path.join(toplevel as string, relative))

        return `${entry}:${stats.size}:${stats.mtimeMs}`
      } catch {
        return `${entry}:missing`
      }
    })
    .filter((line): line is string => line !== null)
    .sort()

  return sha256(lines.join('\n'))
}

/**
 * Path of one `git status --porcelain=v2 -z` entry, or null for a header line.
 * Ordinary entries (`1`), renames (`2`), unmerged entries (`u`), untracked
 * (`?`), and ignored (`!`) all end with the path; in `-z` mode a rename's
 * original path arrives as the following NUL-separated field, which the
 * caller sees as a headerless entry and keeps verbatim.
 */
function statusV2EntryPath(entry: string): string | null {
  if (entry.startsWith('# ')) {
    return null
  }

  if (entry.startsWith('? ') || entry.startsWith('! ')) {
    return entry.slice(2)
  }

  const fieldCount = entry.startsWith('1 ')
    ? 8
    : entry.startsWith('2 ')
      ? 9
      : entry.startsWith('u ')
        ? 10
        : 0

  if (fieldCount === 0) {
    return null
  }

  let offset = 0

  for (let field = 0; field < fieldCount; field += 1) {
    const next = entry.indexOf(' ', offset)

    if (next === -1) {
      return null
    }

    offset = next + 1
  }

  return entry.slice(offset)
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
 *
 * `options.commitBase` names the commit the caller is comparing against,
 * normally the head of the earlier snapshot. When it is supplied and HEAD has
 * moved past it, the snapshot also records the content of every path those
 * commits touched, so a later comparison can tell a commit of already-present
 * content from a change to the workspace.
 */
export function gitWorkspaceSnapshot(
  workspaceDir: string,
  options: { commitBase?: string | null } = {},
): WorkspaceSnapshot {
  if (!isGitRepository(workspaceDir)) {
    return {
      kind: 'filesystem',
      fingerprint: sha256('no-git'),
      entries: [],
    }
  }

  let toplevel = toplevelCache.get(workspaceDir)

  if (toplevel === undefined) {
    const toplevelResult = runGit(
      workspaceDir,
      ['rev-parse', '--show-toplevel'],
      {
        allowFailure: true,
      },
    )

    if (toplevelResult.status === 0) {
      toplevel = toplevelResult.stdout.trim()
      toplevelCache.set(workspaceDir, toplevel)
    } else {
      toplevel = workspaceDir
    }
  }
  const status = runGit(workspaceDir, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '-z',
    '--',
    '.',
    ...protectedGitPathspecs(),
  ])
  // A rename becomes one status-prefixed entry per path, so both its
  // destination and its source survive into the snapshot as real paths.
  const entries = parsePorcelainStatus(status.stdout)
    .flatMap((entry) =>
      entry.source
        ? [`${entry.status} ${entry.path}`, `${entry.status} ${entry.source}`]
        : [`${entry.status} ${entry.path}`],
    )
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
  const content = entryContentFingerprint(toplevel, entries)
  const committed = commitAbsorbedContent(
    workspaceDir,
    toplevel,
    options.commitBase ?? null,
    head,
  )

  return {
    kind: 'git',
    head,
    // The commit-absorbed content stays out of the fingerprint. The
    // fingerprint identifies a workspace state, and two callers of the same
    // state must agree on it whether or not either passed a commit base.
    fingerprint: sha256({
      entries,
      index: sha256(indexEntries.join('\0')),
      content,
    }),
    entries,
    dirty_content: Object.fromEntries(content),
    ...(committed === null
      ? {}
      : { commit_content: Object.fromEntries(committed) }),
  }
}

/**
 * Newest ancestor of `head` that a ref other than the current branch already
 * holds, or null when this branch carries its history alone.
 *
 * Null is also the answer when the branch rejoins shared history at more than
 * one commit, because no single commit bounds the window there.
 */
function sharedHistoryTip(workspaceDir: string, head: string): string | null {
  const branch = gitCurrentBranch(workspaceDir)
  const result = runGit(
    workspaceDir,
    [
      'rev-list',
      '--boundary',
      head,
      '--not',
      ...(branch === null ? [] : [`--exclude=${branch}`]),
      '--branches',
      '--remotes',
    ],
    { allowFailure: true },
  )

  if (result.status !== 0) {
    return null
  }

  const boundaries = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('-'))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0)

  return boundaries.length === 1 ? (boundaries[0] ?? null) : null
}

/**
 * Commit the change window starts from.
 *
 * The caller's base normally bounds it. The release sync a ship stage must
 * run rebases the branch onto a fetched main, which puts commits the working
 * tree never produced above that base; a window opened at the base would
 * report every path the upstream advance carried as a workspace change. When
 * the shared history this branch now sits on is ahead of the base, it is the
 * truthful start instead. Shared history at or behind the base leaves the
 * base as the tighter bound.
 */
function commitWindowStart(
  workspaceDir: string,
  base: string,
  head: string,
): string {
  const shared = sharedHistoryTip(workspaceDir, head)

  if (shared === null || shared === base) {
    return base
  }

  return gitIsAncestor(workspaceDir, shared, base) ? base : shared
}

/**
 * Content of every path the commits between the window start and `head`
 * touched, read from the working tree. Null when the caller named no base,
 * when HEAD has not moved, or when the range does not resolve, which leaves
 * the snapshot in its pre-commit-aware shape.
 */
function commitAbsorbedContent(
  workspaceDir: string,
  toplevel: string,
  base: string | null,
  head: string | null,
): Array<[string, string]> | null {
  if (base === null || head === null || base === head) {
    return null
  }

  let changed: string[]

  try {
    changed = gitChangedPathsBetween(
      workspaceDir,
      commitWindowStart(workspaceDir, base, head),
      head,
      { detectRenames: false },
    )
  } catch {
    // A base the workspace no longer holds, for example after a rebase, is a
    // missing comparison rather than a failure of the snapshot.
    return null
  }

  return contentFingerprint(toplevel, changed)
}

function snapshotEntryMap(snapshot: WorkspaceSnapshot): Map<string, string> {
  return new Map(
    snapshot.entries.map((entry) => [snapshotEntryPath(entry), entry]),
  )
}

function comparedPaths(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  return [
    ...new Set([
      ...snapshotEntryMap(before).keys(),
      ...snapshotEntryMap(after).keys(),
      ...Object.keys(after.commit_content ?? {}),
    ]),
  ]
    .filter((relativePath) => !isProtectedWorkspacePath(relativePath))
    .sort()
}

/**
 * Whether a commit between the two snapshots carried this path at exactly the
 * content the working tree already held: dirty before, clean after, and
 * byte-identical across the two.
 */
function commitAbsorbedPath(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  relativePath: string,
): boolean {
  const held = before.dirty_content?.[relativePath]
  const committed = after.commit_content?.[relativePath]

  return (
    held !== undefined &&
    committed !== undefined &&
    held === committed &&
    !snapshotEntryMap(after).has(relativePath)
  )
}

/**
 * Paths whose content differs between two snapshots.
 *
 * Three rules apply in order. A commit that carried content the working tree
 * already held is not a change, which is what lets a ship stage make the
 * release commit its own contract mandates. Any other path a commit touched
 * is a change, because the working tree must have moved for the commit to
 * record anything. Otherwise content decides when both snapshots state a hash
 * — that catches an edit to an already-dirty file, whose status code never
 * changes — and the Git status entry decides when either does not, which is
 * also the behavior for a snapshot recorded before content hashing existed.
 */
export function workspaceChangedPathsFromSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  const beforeEntries = snapshotEntryMap(before)
  const afterEntries = snapshotEntryMap(after)

  return comparedPaths(before, after).filter((relativePath) => {
    if (commitAbsorbedPath(before, after, relativePath)) {
      return false
    }

    if (after.commit_content?.[relativePath] !== undefined) {
      return true
    }

    const beforeContent = before.dirty_content?.[relativePath]
    const afterContent = after.dirty_content?.[relativePath]

    if (beforeContent !== undefined && afterContent !== undefined) {
      return beforeContent !== afterContent
    }

    return beforeEntries.get(relativePath) !== afterEntries.get(relativePath)
  })
}

/**
 * Paths a commit absorbed at unchanged content between the two snapshots.
 *
 * These are not workspace changes, but committing them is still an action of
 * the stage that made the commit. The scope adjudication asks who authored
 * each one rather than accepting the commit on its own.
 */
export function workspaceAbsorbedPathsFromSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  return comparedPaths(before, after).filter((relativePath) =>
    commitAbsorbedPath(before, after, relativePath),
  )
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
