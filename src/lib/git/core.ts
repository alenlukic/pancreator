/**
 * The bounded `git` subprocess runner, repository detection, and the read-only
 * revision, diff, and file queries every other git module builds on.
 */

import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { statSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { sha256 } from '../io.js'

interface RunGitOptions {
  allowFailure?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Run `git` synchronously in `root` with a 20 MiB output buffer and return the
 * spawn result. Throws `PanError` `GIT_FAILED` on a non-zero exit unless
 * `allowFailure` is set, in which case the caller reads the status.
 */
export function runGit(
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

/**
 * Digest of the workspace's source content: every tracked and untracked
 * non-ignored file, by path and blob hash, outside `runtime/` and the
 * `excluded` paths. Staging and commit state do not enter it, so a tree the
 * release steward only committed or checkpointed keeps its digest. Returns
 * null when Git cannot list or hash the tree.
 */
export function gitSourceContentFingerprint(
  root: string,
  excluded: ReadonlySet<string>,
): string | null {
  const listed = runGit(
    root,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { allowFailure: true },
  )

  if (listed.status !== 0) {
    return null
  }

  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))]
    .filter(
      (file) =>
        !excluded.has(file) &&
        !file.startsWith('runtime/') &&
        !file.includes('\n'),
    )
    .filter((file) => {
      try {
        return statSync(path.join(root, file)).isFile()
      } catch {
        // A deleted tracked file is absent from the content, which is how
        // its deletion enters the digest.
        return false
      }
    })
    .sort()

  if (files.length === 0) {
    return sha256('')
  }

  const hashed = spawnSync('git', ['hash-object', '--stdin-paths'], {
    cwd: root,
    encoding: 'utf8',
    input: `${files.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024,
  })

  if (hashed.status !== 0) {
    return null
  }

  const blobs = hashed.stdout.trim().split('\n')

  if (blobs.length !== files.length) {
    return null
  }

  return sha256(
    files.map((file, index) => `${file}\0${blobs[index]}`).join('\n'),
  )
}

// Cache a positive answer only. A directory can become a repository after a
// negative check, but a repository never stops being one in a live process.
const gitRepositoryCache = new Map<string, true>()

/**
 * True when the path lies inside a Git work tree. A positive answer is cached
 * for the life of the process; a negative one is rechecked on each call.
 */
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

/** The full commit id of HEAD, or null when it cannot be resolved. */
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

  return diffNameOnlyPaths(result.stdout)
}

/**
 * Repository-relative paths whose content differs between two commit trees.
 *
 * A three-dot diff answers "what did this branch add since the fork", which
 * counts a path the base already holds at the same content whenever the two
 * commits fork. A rebase makes exactly that shape, so a caller asking what
 * changed between two specific trees must compare the trees themselves.
 */
export function gitChangedPathsBetweenCommits(
  root: string,
  base: string,
  head: string,
  options: { detectRenames?: boolean } = {},
): string[] {
  const result = runGit(root, [
    'diff',
    '--name-only',
    ...(options.detectRenames === false ? ['--no-renames'] : []),
    '--end-of-options',
    base,
    head,
  ])

  return diffNameOnlyPaths(result.stdout)
}

function diffNameOnlyPaths(stdout: string): string[] {
  return stdout
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

/**
 * Commits that changed one path, newest first, at most `limit` of them. An
 * empty list means the path has no history or Git cannot answer.
 */
export function gitPathCommits(
  root: string,
  relativePath: string,
  limit: number,
): string[] {
  const result = runGit(
    root,
    ['log', '--format=%H', `--max-count=${limit}`, '--', relativePath],
    { allowFailure: true },
  )

  return result.status === 0
    ? result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : []
}

/** True when a local branch of this name exists under `refs/heads/`. */
export function gitBranchExists(root: string, branch: string): boolean {
  const result = runGit(
    root,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { allowFailure: true },
  )

  return result.status === 0
}
