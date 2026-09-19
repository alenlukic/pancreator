import path from 'node:path'

import { invariant } from './errors.js'
import {
  gitBranchExists,
  gitDefaultBranch,
  gitHead,
  gitShowFile,
  INTEGRATION_BRANCH,
} from './git.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readText,
  resolveInside,
  withOperationMutex,
} from './io.js'
import {
  compareVersions,
  isSemanticVersion,
  nextSemanticVersion,
  type ReleaseBump,
} from './versioning.js'
import {
  readWorktreeIndex,
  resolveWorktreeWorkspace,
  workspaceRepositoryRoot,
} from './worktrees.js'

/**
 * Release version allocation.
 *
 * Worktree isolation separates source trees, but the release version sequence
 * is one shared resource: two release worktrees branched from the same
 * integration head both read the same committed `VERSION`, and the ship
 * validator's exact-next-version rule then obliges both to propose the same
 * number. The collision surfaces only at merge, after release commits exist.
 *
 * This module is the stand-in allocation authority: one durable ledger under
 * the installation's `runtime/` directory, shared by every worktree, that
 * hands out the next version above every version any party has published or
 * already claimed. The wider allocation design tracked by the harness repair
 * intake for `int-con` HR-005 replaces it; the ledger shape here is what that
 * design should consult.
 */

const ALLOCATIONS_PATH = path.join('runtime', 'release', 'allocations.jsonl')
const ALLOCATIONS_MUTEX = path.join('runtime', 'release', 'allocations.lock')
const RELEASE_BUMPS: ReadonlySet<string> = new Set(['major', 'minor', 'patch'])

export interface ReleaseAllocationRecord {
  schema_version: 1
  version: string
  bump: ReleaseBump
  /** Version the bump was applied to: the highest published or allocated version seen. */
  base_version: string
  /** Committed `VERSION` at the worktree head when the allocation was made. */
  committed_version: string
  worktree: string
  workspace: string
  run_id: string | null
  /** Every version source consulted and the version it contributed, for audit. */
  sources: Array<{ source: string; version: string }>
  allocated_at: string
}

export interface ReleaseAllocationResult {
  status: 'allocated' | 'reused'
  allocation: ReleaseAllocationRecord
  ledger_path: string
}

export function releaseAllocationLedgerPath(root: string): string {
  return resolveInside(root, ALLOCATIONS_PATH)
}

export function isReleaseBump(value: string): value is ReleaseBump {
  return RELEASE_BUMPS.has(value)
}

function parseRecord(line: string): ReleaseAllocationRecord | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.version !== 'string' ||
    typeof parsed.bump !== 'string' ||
    typeof parsed.workspace !== 'string' ||
    !isReleaseBump(parsed.bump)
  ) {
    return null
  }

  return parsed as unknown as ReleaseAllocationRecord
}

/** Every allocation recorded so far, oldest first. A malformed line is skipped. */
export function readReleaseAllocations(
  root: string,
): ReleaseAllocationRecord[] {
  const ledgerPath = releaseAllocationLedgerPath(root)

  if (!fileExists(ledgerPath)) {
    return []
  }

  return readText(ledgerPath)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseRecord)
    .filter((record): record is ReleaseAllocationRecord => record !== null)
}

function versionAtRef(
  repositoryRoot: string,
  reference: string,
): string | null {
  const content = gitShowFile(repositoryRoot, reference, 'VERSION')
  const version = content?.trim() ?? ''

  return isSemanticVersion(version) ? version : null
}

function indexedVersionsAtRef(
  repositoryRoot: string,
  reference: string,
): string[] {
  const content = gitShowFile(repositoryRoot, reference, 'release/index.json')

  if (content === null) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.releases)) {
    return []
  }

  return parsed.releases.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.version === 'string' &&
    isSemanticVersion(entry.version)
      ? [entry.version]
      : [],
  )
}

function highest(versions: string[]): string | null {
  return versions.reduce<string | null>(
    (best, candidate) =>
      best === null || compareVersions(candidate, best) > 0 ? candidate : best,
    null,
  )
}

/**
 * The version sources a fresh allocation must clear: the worktree's own head,
 * the integration branch, the local default branch, and every earlier
 * allocation. A source that has no readable version contributes nothing.
 */
function versionSources(
  repositoryRoot: string,
  worktreePath: string,
  allocations: ReleaseAllocationRecord[],
): Array<{ source: string; version: string }> {
  const sources: Array<{ source: string; version: string }> = []
  const head = gitHead(worktreePath)

  if (head) {
    const committed = versionAtRef(worktreePath, head)

    if (committed) {
      sources.push({ source: 'worktree:VERSION', version: committed })
    }

    const indexed = highest(indexedVersionsAtRef(worktreePath, head))

    if (indexed) {
      sources.push({ source: 'worktree:release/index.json', version: indexed })
    }
  }

  const branches = new Set<string>([INTEGRATION_BRANCH])
  const defaultBranch = gitDefaultBranch(repositoryRoot)

  if (defaultBranch) {
    branches.add(defaultBranch)
  }

  for (const branch of branches) {
    if (!gitBranchExists(repositoryRoot, branch)) {
      continue
    }

    const version = versionAtRef(repositoryRoot, branch)

    if (version) {
      sources.push({ source: `${branch}:VERSION`, version })
    }

    const indexed = highest(indexedVersionsAtRef(repositoryRoot, branch))

    if (indexed) {
      sources.push({ source: `${branch}:release/index.json`, version: indexed })
    }
  }

  const allocated = highest(allocations.map((record) => record.version))

  if (allocated) {
    sources.push({ source: 'allocations.jsonl', version: allocated })
  }

  return sources
}

/**
 * The allocation a worktree still holds: its latest record whose version no
 * consulted branch has published yet. A release that already landed frees the
 * worktree to allocate again; a repeated request before then returns the same
 * version, which is what makes a retried ship stage idempotent.
 */
function heldAllocation(
  allocations: ReleaseAllocationRecord[],
  workspace: string,
  published: Set<string>,
): ReleaseAllocationRecord | null {
  const own = allocations.filter((record) => record.workspace === workspace)
  const latest = own.at(-1)

  return latest && !published.has(latest.version) ? latest : null
}

/**
 * Allocate the next release version for a worktree, or return the one it
 * already holds. The ledger append runs under the shared mutex, so two
 * worktrees allocating at once still receive distinct versions.
 */
export function allocateReleaseVersion(
  root: string,
  worktreeName: string,
  bump: string,
  options: { runId?: string | null; recordedAt?: string } = {},
): ReleaseAllocationResult {
  invariant(
    isReleaseBump(bump),
    `Release bump must be major, minor, or patch, not '${bump}'.`,
    { code: 'INVALID_RELEASE_BUMP' },
  )

  const worktreePath = path.resolve(
    root,
    resolveWorktreeWorkspace(root, worktreeName),
  )
  const record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === worktreeName,
  )
  const repositoryRoot = record?.repository_root
    ? path.resolve(root, record.repository_root)
    : workspaceRepositoryRoot(root)
  const ledgerPath = releaseAllocationLedgerPath(root)

  return withOperationMutex(
    resolveInside(root, ALLOCATIONS_MUTEX),
    () => {
      const allocations = readReleaseAllocations(root)
      const sources = versionSources(repositoryRoot, worktreePath, allocations)
      const published = new Set(
        sources
          .filter((source) => !source.source.startsWith('allocations'))
          .map((source) => source.version),
      )
      const held = heldAllocation(allocations, worktreePath, published)

      if (held) {
        return { status: 'reused', allocation: held, ledger_path: ledgerPath }
      }

      const committed =
        sources.find((source) => source.source === 'worktree:VERSION')
          ?.version ?? null

      invariant(
        committed !== null,
        `Worktree '${worktreeName}' has no committed SemVer VERSION to bump from.`,
        { code: 'RELEASE_VERSION_UNREADABLE' },
      )

      const base = highest(sources.map((source) => source.version)) ?? committed
      const version = nextSemanticVersion(base, bump)

      invariant(version !== null, `Cannot bump '${base}' by ${bump}.`, {
        code: 'RELEASE_VERSION_UNREADABLE',
      })

      const allocation: ReleaseAllocationRecord = {
        schema_version: 1,
        version,
        bump,
        base_version: base,
        committed_version: committed,
        worktree: worktreeName,
        workspace: worktreePath,
        run_id: options.runId ?? null,
        sources,
        allocated_at: options.recordedAt ?? new Date().toISOString(),
      }

      appendJsonLine(ledgerPath, allocation)

      return { status: 'allocated', allocation, ledger_path: ledgerPath }
    },
    { waitForHolderMs: 10_000 },
  )
}

/**
 * The allocation that authorizes a proposed version for a workspace, or null.
 * The ship validator accepts a `proposed_version` above the exact next version
 * only when this ledger shows the workspace was handed that version for the
 * same bump.
 */
export function releaseAllocationFor(
  root: string,
  workspace: string,
  proposedVersion: string,
  bump: string,
): ReleaseAllocationRecord | null {
  const resolved = path.resolve(workspace)

  return (
    readReleaseAllocations(root)
      .filter(
        (record) =>
          path.resolve(record.workspace) === resolved &&
          record.version === proposedVersion &&
          record.bump === bump,
      )
      .at(-1) ?? null
  )
}
