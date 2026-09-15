import path from 'node:path'

import { invariant } from './errors.js'
import {
  gitBranchExists,
  gitCommit,
  gitCommitChangedPaths,
  gitCommitParent,
  gitCommitSubject,
  gitConflictedPaths,
  gitCurrentBranch,
  gitDefaultBranch,
  gitFetchBranch,
  gitHead,
  gitIsAncestor,
  gitMergeBase,
  gitRebaseContinue,
  gitRebaseInProgress,
  gitRebaseOnto,
  gitRemotes,
  gitRevParse,
  gitStagePaths,
  gitStatusPaths,
  gitUpstreamRemote,
  gitWorktreeIsDirty,
} from './git.js'
import {
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import { liveRunsBoundToWorktree } from './state.js'
import type {
  LocalReleaseContinueResult,
  LocalReleaseFinalizeResult,
  LocalReleaseRebaseOverride,
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

/**
 * Paths a release must never carry. The rule is one exported constant so the
 * corpus that pins it lives beside it: each branch here answers a shape the
 * detector missed, and a new shape is added with its positive and negative
 * cases in `tests/integration/release-preparation.test.ts`.
 *
 * The branches, in order: a dot-env file or anything inside a dot-env
 * directory; an OpenSSH private key, which carries no extension and whose
 * `.pub` sibling is deliberately excluded; a segment naming a credential; and
 * a key or certificate container extension.
 */
export const SECRET_PATH_PATTERN =
  /(?:^|\/)(?:\.env(?:[./]|$)|id_(?:rsa|dsa|ecdsa|ed25519)$|[^/]*(?:credential|secret|token|private[-_.]?key)[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore)$)/iu
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
  for (const state of liveRunsBoundToWorktree(root, name, record)) {
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

    // Naming only the blocking run left the operator to infer the abort.
    // Waiver-based plan reuse is the route that moves the claim; an abort is
    // the route for a run that never exchanged a plan with this one.
    const releaseCommand = ownerRunId
      ? `./bin/pan waive-gate ${ownerRunId} --adopt-plan-from ${state.run_id} --note "<why this run adopts that plan>"`
      : `./bin/pan abort ${state.run_id} --note "<why>"`

    invariant(
      false,
      `Release preparation is blocked by active workflow '${state.run_id}' ` +
        `against worktree '${name}'. Run '${state.run_id}' holds the ` +
        `worktree claim. Release it with: ${releaseCommand}`,
      {
        code: 'RELEASE_WORKFLOW_ACTIVE',
        details: {
          run_id: state.run_id,
          worktree: name,
          claim_holder_run_id: state.run_id,
          release_command: releaseCommand,
        },
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

/** Operator decisions that move the rebase off the fetched remote head. */
export interface LocalReleaseSyncOptions {
  /** Rebase onto this ref instead of the fetched remote head. */
  onto?: string
  /** Keep the local history as it stands and run no rebase. */
  noRebase?: boolean
}

/**
 * Refuse a rebase that would replay commits the local default branch already
 * carries.
 *
 * A rebase onto the fetched head rewrites everything in `fetched..HEAD`. When
 * the fetched head is strictly behind the point this branch shares with the
 * local default branch, part of that range is already on that branch under
 * its original hashes, and replaying it costs the fast-forward merge the
 * release depends on. Pancreator releases itself without pushing, so this is
 * the ordinary state of a self-development release rather than a rare one.
 *
 * The refusal names both heads and never retargets on its own; the operator
 * states a different target with `--onto` or declines the rebase with
 * `--no-rebase`, and the result records that choice.
 */
function assertRebaseKeepsLocalHistory(
  worktreePath: string,
  remote: string,
  fetchedMain: string,
): void {
  const defaultBranch = gitDefaultBranch(worktreePath)

  if (!defaultBranch || !gitBranchExists(worktreePath, defaultBranch)) {
    return
  }

  const localHead = gitRevParse(worktreePath, `refs/heads/${defaultBranch}`)
  const shared = gitMergeBase(worktreePath, 'HEAD', localHead)

  if (
    !shared ||
    shared === fetchedMain ||
    !gitIsAncestor(worktreePath, fetchedMain, shared)
  ) {
    return
  }

  invariant(
    false,
    `Release sync refused a rebase that would rewrite commits already on ` +
      `local '${defaultBranch}'. Fetched ${remote}/main is ${fetchedMain}; ` +
      `local '${defaultBranch}' is ${localHead}. Options: push ` +
      `'${defaultBranch}' to '${remote}' and sync again, rebase onto the ` +
      `local integration head with --onto ${defaultBranch}, or keep the ` +
      `local history as it stands with --no-rebase.`,
    {
      code: 'RELEASE_REMOTE_BEHIND_LOCAL',
      details: {
        remote,
        default_branch: defaultBranch,
        fetched_head: fetchedMain,
        local_head: localHead,
      },
    },
  )
}

/** Commit eligible existing changes, fetch remote main, then rebase. */
export function syncLocalRelease(
  root: string,
  worktreeName: string,
  message: string,
  ownerRunId?: string,
  options: LocalReleaseSyncOptions = {},
): LocalReleaseSyncResult {
  invariant(message.trim().length > 0, 'Release sync requires --message.', {
    code: 'RELEASE_MESSAGE_REQUIRED',
  })
  invariant(
    !(options.noRebase === true && options.onto !== undefined),
    'Release sync accepts --onto or --no-rebase, not both.',
    { code: 'RELEASE_REBASE_OVERRIDE_CONFLICT' },
  )

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

  if (options.noRebase === true) {
    return {
      status: 'synchronized',
      worktree: resolved.record,
      branch,
      remote,
      fetched_main: fetchedMain,
      rebase_target: null,
      rebase_override: {
        kind: 'no_rebase',
        requested_ref: null,
        resolved_commit: null,
      },
      checkpoint_commit: checkpointCommit,
      conflicted_paths: [],
    }
  }

  let override: LocalReleaseRebaseOverride | null = null
  let rebaseTarget = fetchedMain

  if (options.onto !== undefined) {
    const requested = options.onto.trim()

    invariant(requested.length > 0, 'Release sync requires a ref for --onto.', {
      code: 'RELEASE_REBASE_ONTO_INVALID',
    })

    rebaseTarget = gitRevParse(resolved.absolute, requested)
    override = {
      kind: 'onto',
      requested_ref: requested,
      resolved_commit: rebaseTarget,
    }
  } else {
    assertRebaseKeepsLocalHistory(resolved.absolute, remote, fetchedMain)
  }

  const rebase = gitRebaseOnto(resolved.absolute, rebaseTarget)

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
    rebase_target: rebaseTarget,
    rebase_override: override,
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
