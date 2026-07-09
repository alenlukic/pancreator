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
    const relative = entry.length >= 4 ? entry.slice(3) : entry

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
      const relative = entry.length >= 4 ? entry.slice(3) : entry

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
    .filter((entry) => {
      const tab = entry.indexOf('\t')
      const relative = tab === -1 ? entry : entry.slice(tab + 1)

      return !isProtectedWorkspacePath(relative)
    })
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
  }
}

function snapshotEntryPath(entry: string): string {
  const statusPath = entry.length >= 4 ? entry.slice(3) : entry
  const renameArrow = statusPath.lastIndexOf(' -> ')

  return renameArrow === -1 ? statusPath : statusPath.slice(renameArrow + 4)
}

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
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()])

  return [...paths]
    .filter(
      (relativePath) =>
        beforeByPath.get(relativePath) !== afterByPath.get(relativePath),
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
