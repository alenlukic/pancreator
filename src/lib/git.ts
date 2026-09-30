/**
 * Git plumbing entry point. The implementation lives in `./git/`, one module
 * per concern; this module re-exports its public surface so every caller and
 * the tests keep one stable import path.
 */

export {
  gitSourceContentFingerprint,
  isGitRepository,
  gitHead,
  gitToplevel,
  gitCommonDir,
  gitRevParse,
  gitMergeBase,
  gitChangedPathsBetween,
  gitChangedPathsBetweenCommits,
  gitShowFile,
  gitPathCommits,
  gitBranchExists,
} from './git/core.js'
export {
  INTEGRATION_BRANCH,
  integrationBranchReadiness,
  gitDefaultBranch,
  gitDeleteBranch,
  gitBranchNameIsValid,
  gitCurrentBranch,
  gitCreateBranch,
  gitSwitchBranch,
  parsePorcelainStatus,
  gitStatusPaths,
  gitStagePaths,
  gitCommit,
  gitRemotes,
  gitUpstreamRemote,
  gitFetchBranch,
  gitRebaseOnto,
  gitRebaseContinue,
  gitRebaseInProgress,
  gitReadRebaseMetadata,
  gitWriteRebaseMetadata,
  gitIsAncestor,
  gitCommitParent,
  gitCommitChangedPaths,
  gitCommitDate,
  gitCommitSubject,
  gitConflictedPaths,
} from './git/branches.js'
export type {
  IntegrationBranchReadiness,
  PorcelainStatusEntry,
  GitRebaseResult,
} from './git/branches.js'
export {
  gitMergeSignatures,
  gitWorktreeAdd,
  gitWorktreeAddOnBranch,
  gitWorktreeAddOnExistingBranch,
  gitWorktreePrune,
  gitWorktreeForBranch,
  gitWorktreePaths,
  gitWorktreeRemove,
  gitWorktreeIsDirty,
  gitDirtyEntries,
  gitMergeBranch,
  gitMergeAbort,
} from './git/worktree-merge.js'
export type { GitDirtyEntry, GitMergeResult } from './git/worktree-merge.js'
export {
  gitTrackedWorkspacePaths,
  snapshotEntryPath,
  gitWorkspaceActivityFingerprint,
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
  workspaceAbsorbedPathsFromSnapshots,
  snapshotChanged,
  workspaceDelta,
} from './git/workspace.js'
