/**
 * Tracked-path enumeration, workspace fingerprints and snapshots, and the
 * snapshot comparisons that attribute workspace changes.
 */

import { statSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { sha256 } from '../io.js'
import type { WorkspaceSnapshot, WorkspaceDelta } from '../types.js'
import {
  protectedGitPathspecs,
  isProtectedWorkspacePath,
} from '../workspace/protected-paths.js'
import {
  gitChangedPathsBetweenCommits,
  gitHead,
  isGitRepository,
  runGit,
} from './core.js'
import {
  gitCurrentBranch,
  gitIsAncestor,
  parsePorcelainStatus,
} from './branches.js'

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

/** Newest shared-history boundary of this branch, when unique. */
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
    // The direct tree comparison is the outer bound: replayed commits whose
    // content the recorded base already held disappear from it. It must be a
    // two-commit tree diff, because a three-dot diff reads from the fork
    // point and so reports the replayed content a rebase moved. When a rebase
    // also introduced upstream content, intersect that bound with this
    // branch's post-shared-history delta so the upstream advance disappears.
    const direct = gitChangedPathsBetweenCommits(workspaceDir, base, head, {
      detectRenames: false,
    })
    const shared = sharedHistoryTip(workspaceDir, head)

    if (
      shared === null ||
      shared === base ||
      gitIsAncestor(workspaceDir, shared, base)
    ) {
      changed = direct
    } else {
      const branchDelta = new Set(
        gitChangedPathsBetweenCommits(workspaceDir, shared, head, {
          detectRenames: false,
        }),
      )
      changed = direct.filter((relativePath) => branchDelta.has(relativePath))
    }
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
