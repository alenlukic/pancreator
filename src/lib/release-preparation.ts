import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  gitCommit,
  gitCommitChangedPaths,
  gitCommitParent,
  gitCommitSubject,
  gitConflictedPaths,
  gitCurrentBranch,
  gitFetchBranch,
  gitHead,
  gitIsAncestor,
  gitRebaseContinue,
  gitRebaseInProgress,
  gitRebaseOnto,
  gitRemotes,
  gitStagePaths,
  gitStatusPaths,
  gitUpstreamRemote,
  gitWorktreeIsDirty,
} from './git.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import { loadState, statePath } from './state.js'
import type {
  LocalReleaseContinueResult,
  LocalReleaseFinalizeResult,
  LocalReleaseSyncResult,
  ManagedWorktreeReference,
} from './types.js'
import { validateReleaseMetadata, isReleaseMetadataPath } from './versioning.js'
import {
  isProtectedWorkspacePath,
  normalizeProtectedPath,
} from './workspace/protected-paths.js'
import {
  readWorktreeIndex,
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
} from './worktrees.js'

const SECRET_PATH_PATTERN =
  /(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:credential|secret|token|private[-_.]?key)[^/]*)/iu
const COMMIT_HASH_PATTERN = /^[0-9a-f]{40}$/u

function worktree(
  root: string,
  name: string,
  ownerRunId?: string,
): { record: ManagedWorktreeReference; absolute: string } {
  assertReleaseWorkspaceAvailable(root, name, ownerRunId)

  const record = resolveOrCreateWorktree(
    root,
    name,
    `Release worktree '${name}'`,
  )

  resolveWorktreeWorkspace(root, name)

  const absolute = resolveInside(root, record.path)

  assertReleaseWorkspaceAvailable(root, name, ownerRunId, record)

  return { record, absolute }
}

function assertReleaseWorkspaceAvailable(
  root: string,
  name: string,
  ownerRunId?: string,
  record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === name,
  ),
): void {
  const workflowsRoot = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflowsRoot)) {
    return
  }

  for (const entry of readdirSync(workflowsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    if (!fileExists(statePath(root, entry.name))) {
      continue
    }

    const state = loadState(root, entry.name)

    if (['succeeded', 'failed', 'canceled'].includes(state.status)) {
      continue
    }

    const runWorkspace = path.resolve(root, state.workspace_root)
    const absolute = record ? resolveInside(root, record.path) : null
    const sameManagedWorktree =
      state.managed_worktree?.name === name &&
      (!record ||
        (state.managed_worktree.path === record.path &&
          state.managed_worktree.branch === record.branch))

    if (
      !sameManagedWorktree &&
      (!absolute || runWorkspace !== path.resolve(absolute))
    ) {
      continue
    }

    if (state.run_id === ownerRunId) {
      invariant(
        state.current_stage === 'ship' &&
          state.managed_worktree?.name === name &&
          (!record ||
            (state.managed_worktree.path === record.path &&
              state.managed_worktree.branch === record.branch)),
        `Run '${state.run_id}' does not own release preparation for '${name}'.`,
        { code: 'RELEASE_RUN_WORKTREE_MISMATCH' },
      )
      continue
    }

    invariant(
      false,
      `Release preparation is blocked by active workflow '${state.run_id}' ` +
        `against worktree '${name}'.`,
      {
        code: 'RELEASE_WORKFLOW_ACTIVE',
        details: { run_id: state.run_id, worktree: name },
      },
    )
  }
}

function rebaseWorktree(
  root: string,
  name: string,
  ownerRunId?: string,
): { record: ManagedWorktreeReference; absolute: string } {
  const record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === name,
  )

  invariant(record, `Worktree '${name}' does not exist in the index.`, {
    code: 'WORKTREE_NOT_FOUND',
  })
  assertReleaseWorkspaceAvailable(root, name, ownerRunId, record)

  const absolute = resolveInside(root, record.path)

  invariant(
    gitRebaseInProgress(absolute),
    'Release continue requires an active rebase.',
    { code: 'RELEASE_REBASE_NOT_ACTIVE' },
  )

  return { record, absolute }
}

function unsafeReleasePath(relativePath: string): string | null {
  const normalized = normalizeProtectedPath(relativePath)

  if (normalized === 'release/index.json') {
    return 'release index'
  }

  if (
    normalized.startsWith('runtime/') ||
    normalized === '.pancreator' ||
    normalized.startsWith('.pancreator/')
  ) {
    return 'generated state'
  }

  if (isProtectedWorkspacePath(normalized)) {
    return 'dependency or generated output'
  }

  if (SECRET_PATH_PATTERN.test(normalized)) {
    return 'secret-like path'
  }

  return null
}

function assertCommittablePaths(paths: string[]): void {
  for (const relativePath of paths) {
    const unsafeClass = unsafeReleasePath(relativePath)

    invariant(
      unsafeClass === null,
      `Release sync refused ${unsafeClass}: ${relativePath}`,
      {
        code: 'RELEASE_PATH_UNSAFE',
        details: { path: relativePath, class: unsafeClass },
      },
    )
  }
}

function releaseRemote(worktreePath: string): string {
  const upstream = gitUpstreamRemote(worktreePath)

  if (upstream) {
    return upstream
  }

  const remotes = gitRemotes(worktreePath)

  invariant(
    remotes.length === 1,
    remotes.length === 0
      ? 'Release sync requires a configured Git remote.'
      : `Release sync found ambiguous Git remotes: ${remotes.join(', ')}`,
    {
      code:
        remotes.length === 0
          ? 'RELEASE_REMOTE_MISSING'
          : 'RELEASE_REMOTE_AMBIGUOUS',
    },
  )

  return remotes[0] ?? ''
}

/** Commit eligible existing changes, fetch remote main, then rebase. */
export function syncLocalRelease(
  root: string,
  worktreeName: string,
  message: string,
  ownerRunId?: string,
): LocalReleaseSyncResult {
  invariant(message.trim().length > 0, 'Release sync requires --message.', {
    code: 'RELEASE_MESSAGE_REQUIRED',
  })

  const resolved = worktree(root, worktreeName, ownerRunId)
  const branch = gitCurrentBranch(resolved.absolute)

  invariant(
    branch === resolved.record.branch,
    `Release worktree '${worktreeName}' is not on '${resolved.record.branch}'.`,
    { code: 'WORKTREE_BRANCH_MISMATCH' },
  )

  const paths = gitStatusPaths(resolved.absolute)

  assertCommittablePaths(paths)

  let checkpointCommit: string | null = null

  if (paths.length > 0) {
    gitStagePaths(resolved.absolute, paths)
    checkpointCommit = gitCommit(resolved.absolute, message.trim())
  }

  const remote = releaseRemote(resolved.absolute)
  const fetchedMain = gitFetchBranch(resolved.absolute, remote, 'main')
  const rebase = gitRebaseOnto(resolved.absolute, fetchedMain)

  if (!rebase.succeeded && rebase.conflicted_paths.length === 0) {
    invariant(
      false,
      `Release rebase failed: ${rebase.stderr || rebase.stdout}`,
      {
        code: 'RELEASE_REBASE_FAILED',
      },
    )
  }

  return {
    status: rebase.succeeded ? 'synchronized' : 'conflict',
    worktree: resolved.record,
    branch,
    remote,
    fetched_main: fetchedMain,
    checkpoint_commit: checkpointCommit,
    conflicted_paths: rebase.conflicted_paths,
  }
}

/** Continue a release rebase after supported conflicts are resolved. */
export function continueLocalRelease(
  root: string,
  worktreeName: string,
  ownerRunId?: string,
): LocalReleaseContinueResult {
  const resolved = rebaseWorktree(root, worktreeName, ownerRunId)

  const unresolved = gitConflictedPaths(resolved.absolute)

  if (unresolved.length > 0) {
    return {
      status: 'conflict',
      worktree: resolved.record,
      branch: resolved.record.branch,
      conflicted_paths: unresolved,
    }
  }

  const paths = gitStatusPaths(resolved.absolute)

  assertCommittablePaths(paths)
  gitStagePaths(resolved.absolute, paths)

  const result = gitRebaseContinue(resolved.absolute)

  if (!result.succeeded && result.conflicted_paths.length === 0) {
    invariant(
      false,
      `Release rebase continuation failed: ${result.stderr || result.stdout}`,
      { code: 'RELEASE_REBASE_CONTINUE_FAILED' },
    )
  }

  return {
    status: result.succeeded ? 'complete' : 'conflict',
    worktree: resolved.record,
    branch: resolved.record.branch,
    conflicted_paths: result.conflicted_paths,
  }
}

interface ReleaseIndex {
  schema_version: 1
  releases: Array<{ version: string; commit: string }>
}

function readReleaseIndex(indexPath: string): ReleaseIndex {
  const value = readJson(indexPath)

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      Array.isArray(value.releases),
    'release/index.json MUST contain schema_version 1 and releases[].',
    { code: 'RELEASE_INDEX_INVALID' },
  )

  return value as unknown as ReleaseIndex
}

/** Create the immutable release commit, then its separate index commit. */
export function finalizeLocalRelease(
  root: string,
  worktreeName: string,
  fetchedMain: string,
  ownerRunId?: string,
): LocalReleaseFinalizeResult {
  invariant(
    COMMIT_HASH_PATTERN.test(fetchedMain),
    'Release finalization requires a full lowercase fetched-main commit hash.',
    { code: 'RELEASE_FETCHED_MAIN_INVALID' },
  )

  const resolved = worktree(root, worktreeName, ownerRunId)

  invariant(
    !gitRebaseInProgress(resolved.absolute),
    'Release finalization cannot run during a rebase.',
    { code: 'RELEASE_REBASE_ACTIVE' },
  )
  invariant(
    gitIsAncestor(resolved.absolute, fetchedMain),
    'Fetched main is not an ancestor of the release branch.',
    { code: 'RELEASE_ANCESTRY_INVALID' },
  )

  const metadata = validateReleaseMetadata(resolved.absolute)

  invariant(metadata.errors.length === 0, metadata.errors.join(' '), {
    code: 'RELEASE_METADATA_INVALID',
    details: { errors: metadata.errors },
  })

  const version = readText(path.join(resolved.absolute, 'VERSION')).trim()
  const indexPath = path.join(resolved.absolute, 'release', 'index.json')
  const releaseIndex = readReleaseIndex(indexPath)
  const existing = releaseIndex.releases.find(
    (entry) => entry.version === version,
  )
  const releasePaths = gitStatusPaths(resolved.absolute)
  const currentHead = gitHead(resolved.absolute)

  if (
    releasePaths.length === 0 &&
    currentHead &&
    existing &&
    gitCommitParent(resolved.absolute, currentHead) === existing.commit &&
    gitCommitChangedPaths(resolved.absolute, currentHead).join('\0') ===
      'release/index.json'
  ) {
    invariant(
      gitIsAncestor(resolved.absolute, fetchedMain, existing.commit),
      'Fetched main is not an ancestor of the completed release commit.',
      { code: 'RELEASE_ANCESTRY_INVALID' },
    )

    return {
      status: 'finalized',
      worktree: resolved.record,
      branch: resolved.record.branch,
      version,
      fetched_main: fetchedMain,
      release_commit: existing.commit,
      index_commit: currentHead,
      clean: true,
    }
  }

  const indexOnly =
    releasePaths.length === 1 && releasePaths[0] === 'release/index.json'
  const releaseCommitOnly =
    releasePaths.length === 0 &&
    currentHead !== null &&
    gitCommitSubject(resolved.absolute, currentHead) ===
      `release: prepare v${version}` &&
    gitCommitChangedPaths(resolved.absolute, currentHead).every(
      (relativePath) =>
        relativePath !== 'release/index.json' &&
        isReleaseMetadataPath(relativePath),
    )
  let releaseCommit: string

  if (releaseCommitOnly) {
    invariant(currentHead, 'Recovered release commit is unreadable.', {
      code: 'RELEASE_COMMIT_RECOVERY_INVALID',
    })
    releaseCommit = currentHead

    if (existing) {
      existing.commit = releaseCommit
    } else {
      releaseIndex.releases.push({ version, commit: releaseCommit })
    }

    writeJsonAtomic(indexPath, releaseIndex)
  } else if (indexOnly) {
    invariant(
      currentHead && existing?.commit === currentHead,
      'Release index does not identify the current release commit.',
      { code: 'RELEASE_INDEX_RECOVERY_INVALID' },
    )
    releaseCommit = currentHead
  } else {
    invariant(releasePaths.length > 0, 'No release metadata changes exist.', {
      code: 'RELEASE_METADATA_UNCHANGED',
    })

    for (const relativePath of releasePaths) {
      invariant(
        relativePath !== 'release/index.json' &&
          isReleaseMetadataPath(relativePath),
        `Release finalization found a non-metadata path: ${relativePath}`,
        { code: 'RELEASE_SCOPE_INVALID' },
      )
    }

    gitStagePaths(resolved.absolute, releasePaths)
    releaseCommit = gitCommit(resolved.absolute, `release: prepare v${version}`)

    if (existing) {
      existing.commit = releaseCommit
    } else {
      releaseIndex.releases.push({ version, commit: releaseCommit })
    }

    writeJsonAtomic(indexPath, releaseIndex)
  }

  gitStagePaths(resolved.absolute, ['release/index.json'])

  const indexCommit = gitCommit(
    resolved.absolute,
    `chore: index release v${version}`,
  )
  const clean = !gitWorktreeIsDirty(resolved.absolute)

  invariant(clean, 'Release finalization left a dirty worktree.', {
    code: 'RELEASE_WORKTREE_DIRTY',
  })
  invariant(
    gitHead(resolved.absolute) === indexCommit &&
      gitIsAncestor(resolved.absolute, fetchedMain, releaseCommit),
    'Release commit topology is invalid.',
    { code: 'RELEASE_TOPOLOGY_INVALID' },
  )

  return {
    status: 'finalized',
    worktree: resolved.record,
    branch: resolved.record.branch,
    version,
    fetched_main: fetchedMain,
    release_commit: releaseCommit,
    index_commit: indexCommit,
    clean,
  }
}
