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
  gitMergeSignatures,
  gitReadRebaseMetadata,
  gitRebaseContinue,
  gitRebaseInProgress,
  gitRebaseOnto,
  gitRemotes,
  gitRevParse,
  gitShowFile,
  gitStagePaths,
  gitStatusPaths,
  gitUpstreamRemote,
  gitWriteRebaseMetadata,
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
  LocalReleaseAdvisory,
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
import {
  cleanTreeRefusal,
  committablePaths,
  workspaceCleanliness,
} from './workspace-attribution.js'

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
const RELEASE_REBASE_ANCHOR_METADATA = 'pancreator-release-anchor'

/**
 * What release sync recorded before it let Git rewrite the branch. A rebase
 * replays every commit above `rebase_target`, so `pre_sync_head` itself is
 * gone from the result whenever the rebase did real work; the merges that
 * range carried are the lineage integration recorded, and `replayed_merges`
 * holds their signatures so the postcondition can tell a merge-preserving
 * rewrite from a flattening one.
 */
interface ReleaseRebaseAnchor {
  pre_sync_head: string
  rebase_target: string
  /** `gitMergeSignatures` of `rebase_target..<head at rebase time>`. */
  replayed_merges: string[]
}

function writeReleaseRebaseAnchor(
  worktreePath: string,
  anchor: ReleaseRebaseAnchor,
): void {
  gitWriteRebaseMetadata(
    worktreePath,
    RELEASE_REBASE_ANCHOR_METADATA,
    `${JSON.stringify(anchor)}\n`,
  )
}

function readReleaseRebaseAnchor(
  worktreePath: string,
): ReleaseRebaseAnchor | null {
  const content = gitReadRebaseMetadata(
    worktreePath,
    RELEASE_REBASE_ANCHOR_METADATA,
  )

  if (content === null) {
    return null
  }

  let value: unknown = null

  try {
    value = JSON.parse(content)
  } catch {
    // The invariant below owns the stable diagnostic for malformed metadata.
  }

  invariant(
    isRecord(value) &&
      typeof value.pre_sync_head === 'string' &&
      COMMIT_HASH_PATTERN.test(value.pre_sync_head) &&
      typeof value.rebase_target === 'string' &&
      COMMIT_HASH_PATTERN.test(value.rebase_target) &&
      Array.isArray(value.replayed_merges) &&
      value.replayed_merges.every((entry) => typeof entry === 'string'),
    'Release rebase anchor metadata is invalid.',
    { code: 'RELEASE_REBASE_ANCHOR_INVALID' },
  )

  return value as unknown as ReleaseRebaseAnchor
}

/** Record the lineage a rebase must carry across, before Git rewrites it. */
function releaseRebaseAnchor(
  worktreePath: string,
  preSyncHead: string,
  rebaseTarget: string,
  headAtRebase: string,
): ReleaseRebaseAnchor {
  return {
    pre_sync_head: preSyncHead,
    rebase_target: rebaseTarget,
    replayed_merges: gitMergeSignatures(
      worktreePath,
      `${rebaseTarget}..${headAtRebase}`,
    ),
  }
}

/**
 * Refuse a completed rebase that flattened the branch. The check is on
 * content rather than identity: the result must descend from the rebase
 * target, and every merge the replayed range carried must still be present
 * with its parent arity and subject. Commit hashes are expected to change.
 */
function assertRebaseKeepsMergeTopology(
  worktreePath: string,
  anchor: ReleaseRebaseAnchor,
): void {
  const postSyncHead = gitHead(worktreePath)
  const descendsFromTarget =
    postSyncHead !== null &&
    gitIsAncestor(worktreePath, anchor.rebase_target, postSyncHead)
  const actualMerges =
    postSyncHead === null
      ? []
      : gitMergeSignatures(
          worktreePath,
          `${anchor.rebase_target}..${postSyncHead}`,
        )
  const mergesPreserved =
    actualMerges.length === anchor.replayed_merges.length &&
    actualMerges.every(
      (signature, index) => signature === anchor.replayed_merges[index],
    )

  invariant(
    descendsFromTarget && mergesPreserved,
    `Release rebase completed but the branch lost the lineage it carried ` +
      `before sync: ${anchor.replayed_merges.length} merge commit(s) were ` +
      `replayed onto ${anchor.rebase_target} and ${actualMerges.length} ` +
      `remain${descendsFromTarget ? '' : ', and the result does not descend from the rebase target'}. ` +
      `The branch is now ${postSyncHead ?? 'unreadable'}; its pre-sync ` +
      `head was ${anchor.pre_sync_head}. Stop release preparation and ` +
      `recover the preserved head before finalizing.`,
    {
      code: 'RELEASE_REBASE_TOPOLOGY_LOST',
      details: {
        pre_sync_head: anchor.pre_sync_head,
        post_sync_head: postSyncHead,
        rebase_target: anchor.rebase_target,
        descends_from_target: descendsFromTarget,
        expected_merges: anchor.replayed_merges,
        actual_merges: actualMerges,
      },
    },
  )
}

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

/** Warn when local integration has advanced beyond the fetched remote base. */
function localDefaultBranchAdvisories(
  worktreePath: string,
  fetchedMain: string,
): LocalReleaseAdvisory[] {
  const defaultBranch = gitDefaultBranch(worktreePath)

  if (!defaultBranch || !gitBranchExists(worktreePath, defaultBranch)) {
    return []
  }

  const localHead = gitRevParse(worktreePath, `refs/heads/${defaultBranch}`)

  if (
    localHead === fetchedMain ||
    !gitIsAncestor(worktreePath, fetchedMain, localHead)
  ) {
    return []
  }

  return [
    {
      code: 'RELEASE_LOCAL_DEFAULT_AHEAD',
      message:
        `Local default branch '${defaultBranch}' at ${localHead} is ahead of ` +
        `fetched main ${fetchedMain}; release preparation kept the local ` +
        `history and did not publish it.`,
      details: {
        default_branch: defaultBranch,
        fetched_main: fetchedMain,
        local_head: localHead,
      },
    },
  ]
}

/** Operator decisions that move the rebase off the fetched remote head. */
export interface LocalReleaseSyncOptions {
  /** Rebase onto this ref instead of the fetched remote head. */
  onto?: string
  /** Keep the local history as it stands and run no rebase. */
  noRebase?: boolean
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

  const preSyncHead = gitHead(resolved.absolute)

  invariant(preSyncHead, 'Release sync could not read the branch head.', {
    code: 'RELEASE_HEAD_MISSING',
  })

  const { committable, withheld } = committablePaths(
    root,
    resolved.absolute,
    gitStatusPaths(resolved.absolute),
  )

  assertCommittablePaths(committable)

  let checkpointCommit: string | null = null

  if (committable.length > 0) {
    gitStagePaths(resolved.absolute, committable)
    checkpointCommit = gitCommit(resolved.absolute, message.trim())
  }

  const remote = releaseRemote(resolved.absolute)
  const fetchedMain = gitFetchBranch(resolved.absolute, remote, 'main')
  const advisories = localDefaultBranchAdvisories(
    resolved.absolute,
    fetchedMain,
  )

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
      advisories,
      withheld_paths: withheld,
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
  }

  const currentHead = gitHead(resolved.absolute)

  invariant(currentHead, 'Release sync could not read the checkpoint head.', {
    code: 'RELEASE_HEAD_MISSING',
  })

  if (gitIsAncestor(resolved.absolute, rebaseTarget, currentHead)) {
    return {
      status: 'already_current',
      worktree: resolved.record,
      branch,
      remote,
      fetched_main: fetchedMain,
      rebase_target: rebaseTarget,
      rebase_override: override,
      checkpoint_commit: checkpointCommit,
      advisories,
      withheld_paths: withheld,
      conflicted_paths: [],
    }
  }

  const rebaseAnchor = releaseRebaseAnchor(
    resolved.absolute,
    preSyncHead,
    rebaseTarget,
    currentHead,
  )
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

  if (rebase.succeeded) {
    assertRebaseKeepsMergeTopology(resolved.absolute, rebaseAnchor)
  } else {
    writeReleaseRebaseAnchor(resolved.absolute, rebaseAnchor)
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
    advisories,
    withheld_paths: withheld,
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

  if (!gitRebaseInProgress(resolved.absolute)) {
    return {
      status: 'not_needed',
      worktree: resolved.record,
      branch: resolved.record.branch,
      withheld_paths: [],
      conflicted_paths: [],
    }
  }

  const rebaseAnchor = readReleaseRebaseAnchor(resolved.absolute)

  invariant(
    rebaseAnchor,
    `Release continuation found an active rebase without Pancreator's ` +
      `release lineage anchor. Finish or abort that rebase manually, then ` +
      `start release sync again so the lineage check can compare the ` +
      `result against the pre-sync merges.`,
    { code: 'RELEASE_REBASE_ANCHOR_MISSING' },
  )

  const unresolved = gitConflictedPaths(resolved.absolute)

  if (unresolved.length > 0) {
    return {
      status: 'conflict',
      worktree: resolved.record,
      branch: resolved.record.branch,
      withheld_paths: [],
      conflicted_paths: unresolved,
    }
  }

  const { committable, withheld } = committablePaths(
    root,
    resolved.absolute,
    gitStatusPaths(resolved.absolute),
  )

  assertCommittablePaths(committable)
  gitStagePaths(resolved.absolute, committable)

  const result = gitRebaseContinue(resolved.absolute)

  if (!result.succeeded && result.conflicted_paths.length === 0) {
    invariant(
      false,
      `Release rebase continuation failed: ${result.stderr || result.stdout}`,
      { code: 'RELEASE_REBASE_CONTINUE_FAILED' },
    )
  }

  if (result.succeeded) {
    assertRebaseKeepsMergeTopology(resolved.absolute, rebaseAnchor)
  } else {
    writeReleaseRebaseAnchor(resolved.absolute, rebaseAnchor)
  }

  return {
    status: result.succeeded ? 'complete' : 'conflict',
    worktree: resolved.record,
    branch: resolved.record.branch,
    withheld_paths: withheld,
    conflicted_paths: result.conflicted_paths,
  }
}

interface ReleaseIndex {
  schema_version: 1
  releases: Array<{ version: string; commit: string }>
}

function releaseIndexValue(value: unknown): ReleaseIndex | null {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.releases) ||
    !value.releases.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.version === 'string' &&
        typeof entry.commit === 'string',
    )
  ) {
    return null
  }

  return value as unknown as ReleaseIndex
}

function readReleaseIndex(indexPath: string): ReleaseIndex {
  const releaseIndex = releaseIndexValue(readJson(indexPath))

  invariant(
    releaseIndex,
    'release/index.json MUST contain schema_version 1 and releases[].',
    { code: 'RELEASE_INDEX_INVALID' },
  )

  return releaseIndex
}

function releaseIndexAtCommit(
  worktreePath: string,
  commit: string,
): ReleaseIndex | null {
  const content = gitShowFile(worktreePath, commit, 'release/index.json')

  if (content === null) {
    return null
  }

  try {
    const value: unknown = JSON.parse(content)

    return releaseIndexValue(value)
  } catch {
    return null
  }
}

interface CompleteReleasePair {
  releaseCommit: string
  indexCommit: string
}

/** A complete same-version pair at HEAD, independent of working-tree dirt. */
function completeReleasePairAtHead(
  worktreePath: string,
  version: string,
  currentHead: string | null,
): CompleteReleasePair | null {
  if (
    currentHead === null ||
    gitShowFile(worktreePath, currentHead, 'VERSION')?.trim() !== version
  ) {
    return null
  }

  const committedIndex = releaseIndexAtCommit(worktreePath, currentHead)
  const existing = committedIndex?.releases.find(
    (entry) => entry.version === version,
  )

  if (
    !existing ||
    gitCommitParent(worktreePath, currentHead) !== existing.commit ||
    gitCommitSubject(worktreePath, currentHead) !==
      `chore: index release v${version}` ||
    gitCommitChangedPaths(worktreePath, currentHead).join('\0') !==
      'release/index.json' ||
    gitCommitSubject(worktreePath, existing.commit) !==
      `release: prepare v${version}`
  ) {
    return null
  }

  const releasePaths = gitCommitChangedPaths(worktreePath, existing.commit)

  if (
    releasePaths.length === 0 ||
    !releasePaths.every(
      (relativePath) =>
        relativePath !== 'release/index.json' &&
        isReleaseMetadataPath(relativePath),
    )
  ) {
    return null
  }

  return { releaseCommit: existing.commit, indexCommit: currentHead }
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

  const advisories = localDefaultBranchAdvisories(
    resolved.absolute,
    fetchedMain,
  )
  const version = readText(path.join(resolved.absolute, 'VERSION')).trim()
  const indexPath = path.join(resolved.absolute, 'release', 'index.json')

  // A path the operator recorded as a read-only input is never committable,
  // so finalization must neither stage it nor refuse the release over it.
  const releasePaths = committablePaths(
    root,
    resolved.absolute,
    gitStatusPaths(resolved.absolute),
  ).committable
  const currentHead = gitHead(resolved.absolute)
  const cleanlinessBeforeCommit = workspaceCleanliness(root, resolved.absolute)
  const unexpectedBlocking = cleanlinessBeforeCommit.blocking.filter(
    (entry) => !releasePaths.includes(entry.path),
  )

  if (unexpectedBlocking.length > 0) {
    invariant(
      false,
      cleanTreeRefusal(
        {
          ...cleanlinessBeforeCommit,
          clean: false,
          blocking: unexpectedBlocking,
        },
        {
          action: 'Release finalization found work it cannot classify',
          remedy: 'Resolve each path, then finalize again.',
        },
      ),
      { code: 'RELEASE_WORKTREE_DIRTY' },
    )
  }

  const completePair = completeReleasePairAtHead(
    resolved.absolute,
    version,
    currentHead,
  )
  const dirtyReleaseMetadata = releasePaths.filter(
    (relativePath) =>
      relativePath === 'release/index.json' ||
      isReleaseMetadataPath(relativePath),
  )

  if (completePair && dirtyReleaseMetadata.length > 0) {
    invariant(
      false,
      `Release v${version} is already finalized at ` +
        `${completePair.indexCommit}, but release metadata is dirty: ` +
        `${dirtyReleaseMetadata.join(', ')}. Restore those paths to the ` +
        `finalized pair before retrying, or allocate a new version for a ` +
        `different release.`,
      {
        code: 'RELEASE_VERSION_ALREADY_FINALIZED_DIRTY',
        details: {
          version,
          release_commit: completePair.releaseCommit,
          index_commit: completePair.indexCommit,
          dirty_paths: dirtyReleaseMetadata,
        },
      },
    )
  }

  const metadata = validateReleaseMetadata(resolved.absolute)

  invariant(metadata.errors.length === 0, metadata.errors.join(' '), {
    code: 'RELEASE_METADATA_INVALID',
    details: { errors: metadata.errors },
  })

  if (
    completePair &&
    releasePaths.length === 0 &&
    cleanlinessBeforeCommit.clean
  ) {
    invariant(
      gitIsAncestor(resolved.absolute, fetchedMain, completePair.releaseCommit),
      'Fetched main is not an ancestor of the completed release commit.',
      { code: 'RELEASE_ANCESTRY_INVALID' },
    )

    return {
      status: 'finalized',
      worktree: resolved.record,
      branch: resolved.record.branch,
      version,
      fetched_main: fetchedMain,
      release_commit: completePair.releaseCommit,
      index_commit: completePair.indexCommit,
      advisories,
      clean: true,
    }
  }

  const releaseIndex = readReleaseIndex(indexPath)
  const existing = releaseIndex.releases.find(
    (entry) => entry.version === version,
  )

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

  invariant(
    gitHead(resolved.absolute) === indexCommit &&
      gitIsAncestor(resolved.absolute, fetchedMain, releaseCommit),
    'Release commit topology is invalid.',
    { code: 'RELEASE_TOPOLOGY_INVALID' },
  )

  const cleanlinessAfterCommit = workspaceCleanliness(root, resolved.absolute)

  if (!cleanlinessAfterCommit.clean) {
    invariant(
      false,
      cleanTreeRefusal(cleanlinessAfterCommit, {
        action: 'Release finalization completed its commits but cannot succeed',
        remedy: 'Resolve each path, then finalize again.',
      }),
      { code: 'RELEASE_WORKTREE_DIRTY' },
    )
  }

  return {
    status: 'finalized',
    worktree: resolved.record,
    branch: resolved.record.branch,
    version,
    fetched_main: fetchedMain,
    release_commit: releaseCommit,
    index_commit: indexCommit,
    advisories,
    clean: true,
  }
}
