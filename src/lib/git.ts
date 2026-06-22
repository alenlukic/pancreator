import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {readFileSync, statSync} from 'node:fs'
import path from 'node:path'

import {PanError} from './errors.js'
import {sha256} from './io.js'
import type {WorkspaceDelta, WorkspaceSnapshot} from './types.js'

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
      {code: 'GIT_FAILED'},
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
  const result = runGit(root, ['rev-parse', 'HEAD'], {allowFailure: true})

  return result.status === 0 ? result.stdout.trim() : null
}

function contentFingerprint(
  root: string,
  entries: string[],
): Array<[string, string]> {
  const files: Array<[string, string]> = []

  for (const entry of entries) {
    const relative = entry.length >= 4 ? entry.slice(3) : entry

    if (!relative || relative.startsWith('runtime/')) {
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

export function gitWorkspaceSnapshot(root: string): WorkspaceSnapshot {
  if (!isGitRepository(root)) {
    return {
      kind: 'filesystem',
      fingerprint: sha256('no-git'),
      entries: [],
    }
  }

  const status = runGit(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '-z',
  ])
  const entries = status.stdout
    .split('\0')
    .filter(Boolean)
    .filter((entry) => {
      const relative = entry.length >= 4 ? entry.slice(3) : entry

      return !relative.startsWith('runtime/')
    })
    .sort()

  const index = runGit(root, ['ls-files', '--stage', '-z'])
  const head = gitHead(root)
  const content = contentFingerprint(root, entries)

  return {
    kind: 'git',
    head,
    fingerprint: sha256({
      head,
      entries,
      index: sha256(index.stdout),
      content,
    }),
    entries,
  }
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
