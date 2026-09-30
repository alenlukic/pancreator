/**
 * The integration branch, branch and status queries, commits, remotes,
 * rebases with their metadata, conflicted-path queries, and single-commit
 * inspection.
 */

import {
  statSync,
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import {
  gitBranchExists,
  gitHead,
  gitRevParse,
  isGitRepository,
  runGit,
} from './core.js'

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

/** True when `git check-ref-format --branch` accepts the branch name. */
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
  const result = runGit(root, ['rebase', '--rebase-merges', commit], {
    allowFailure: true,
  })

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

const REBASE_METADATA_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u

function activeRebaseMetadataDirectory(root: string): string | null {
  for (const directoryName of ['rebase-merge', 'rebase-apply']) {
    const result = runGit(root, ['rev-parse', '--git-path', directoryName], {
      allowFailure: true,
    })
    const reported = result.status === 0 ? result.stdout.trim() : ''

    if (reported.length === 0) {
      continue
    }

    const absolute = path.resolve(root, reported)

    try {
      if (statSync(absolute).isDirectory()) {
        return realpathSync.native(absolute)
      }
    } catch {
      continue
    }
  }

  return null
}

function rebaseMetadataPath(root: string, name: string): string | null {
  if (!REBASE_METADATA_NAME_PATTERN.test(name)) {
    throw new PanError(`Invalid Git rebase metadata name: ${name}`, {
      code: 'GIT_REBASE_METADATA_PATH_INVALID',
    })
  }

  const directory = activeRebaseMetadataDirectory(root)

  if (directory === null) {
    return null
  }

  const candidate = path.resolve(directory, name)
  const relative = path.relative(directory, candidate)

  if (
    relative.length === 0 ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new PanError(`Git rebase metadata escapes its directory: ${name}`, {
      code: 'GIT_REBASE_METADATA_PATH_INVALID',
    })
  }

  return candidate
}

/** Read one harness-owned marker alongside an active Git rebase. */
export function gitReadRebaseMetadata(
  root: string,
  name: string,
): string | null {
  const metadataPath = rebaseMetadataPath(root, name)

  if (metadataPath === null || !existsSync(metadataPath)) {
    return null
  }

  return readFileSync(metadataPath, 'utf8')
}

/** Write one harness-owned marker alongside an active Git rebase. */
export function gitWriteRebaseMetadata(
  root: string,
  name: string,
  content: string,
): void {
  const metadataPath = rebaseMetadataPath(root, name)

  if (metadataPath === null) {
    throw new PanError('Git rebase metadata requires an active rebase.', {
      code: 'GIT_REBASE_NOT_ACTIVE',
    })
  }

  writeFileSync(metadataPath, content, 'utf8')
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

/** Author date of one commit as an ISO-8601 instant, or null when unknown. */
export function gitCommitDate(root: string, commit: string): string | null {
  const result = runGit(
    root,
    ['show', '-s', '--format=%cI', '--end-of-options', commit],
    { allowFailure: true },
  )
  const value = result.stdout.trim()

  return result.status === 0 && value.length > 0 ? value : null
}

/** Subject line recorded by one commit. */
export function gitCommitSubject(root: string, commit: string): string {
  const result = runGit(root, ['show', '-s', '--format=%s', commit])

  return result.stdout.trim()
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
