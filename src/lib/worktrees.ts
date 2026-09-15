import { spawn } from 'node:child_process'
import { copyFileSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant, PanError } from './errors.js'
import { queueInboxRelativePath } from './inbox.js'
import {
  gitBranchExists,
  gitBranchNameIsValid,
  gitConflictedPaths,
  gitCurrentBranch,
  gitDefaultBranch,
  gitDeleteBranch,
  gitHead,
  gitIsAncestor,
  gitMergeAbort,
  gitMergeBranch,
  gitRevParse,
  gitToplevel,
  gitSwitchBranch,
  gitWorktreeAddOnBranch,
  gitWorktreeAddOnExistingBranch,
  gitWorktreeForBranch,
  gitWorktreeIsDirty,
  gitWorktreePaths,
  gitWorktreePrune,
  gitWorktreeRemove,
  isGitRepository,
} from './git.js'
import {
  appendJsonLine,
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  toRepoRelative,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import {
  configuredWorkspaceRoot,
  configuredWorktreeRoot,
  DEFAULT_WORKTREE_ROOT,
  isSelfDevelopmentInstallation,
  LEGACY_DEFAULT_WORKTREE_ROOT,
  localConfigName,
  worktreesConfig,
} from './project-config.js'
import { runSetupCommands } from './setup-commands.js'
import { now } from './state.js'
import type { ManagedWorktreeReference } from './types.js'

const WORKTREE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const TEST_SCRATCH_RELATIVE_PATH = path.join('runtime', 'tmp', 'tests.noindex')
/** A scratch tree `sweepWorktreeTestScratch` renamed out of its worktree. */
const DISCARDED_SCRATCH_NAME = /^\..+-tests-\d+-\d+\.noindex$/u

export interface WorktreeRecord extends ManagedWorktreeReference {
  created_from: string
  description: string
  created_at: string
  /** Present when the harness took over a worktree it did not create. */
  adopted_at?: string
  /**
   * Absolute path of the Git repository this worktree belongs to, when it is
   * not the configured workspace repository. A cohort fanned out from a plan
   * run whose workspace is another repository (an eval fixture, an explicit
   * `--workspace`) records it here so listing, removal, and reconciliation
   * address the right repository.
   */
  repository_root?: string
}

export interface WorktreeIndex {
  schema_version: 1
  worktrees: WorktreeRecord[]
}

export interface ListedWorktree extends WorktreeRecord {
  registered: boolean
  /** The record names a repository that no longer resolves anywhere. */
  orphaned: boolean
  current_commit: string | null
  dirty: boolean | null
}

export interface CreateWorktreeOptions {
  from?: string | null
  description?: string | null
  /**
   * Git repository to add the worktree to. Defaults to the configured
   * workspace repository; a cohort passes the repository of its plan run's
   * workspace.
   */
  repositoryRoot?: string | null
}

export interface RemoveWorktreeResult {
  name: string
  path: string
  /** Present unless `--delete-branch` deleted the branch. */
  kept_branch?: string
  /** Present when `--delete-branch` deleted a merged branch. */
  deleted_branch?: string
  /** Why a requested branch deletion did not happen. */
  branch_deletion_refused?: string
  removed_worktree: boolean
  pruned_index_entry: boolean
  /** Where the worktree's test scratch went for its detached removal. */
  discarded_test_scratch?: string
}

export interface ReconcileTarget {
  /** Name of a recorded worktree the sources merge into. */
  into?: string | null
  /** Existing local branch the sources merge into through a recorded worktree. */
  into_branch?: string | null
}

export interface ReconcileWorktreesResult {
  status: 'merged' | 'conflict'
  target: string
  target_branch: string
  /** `worktree` merges inside a recorded worktree; `checkout` merges inside the checkout that already holds the target branch. */
  target_kind: 'worktree' | 'checkout'
  target_path: string
  sources: string[]
  merged_sources: string[]
  conflicted_source?: string
  conflicted_paths: string[]
  conflict_request?: string
  /** True when a conflict inside a held checkout was aborted to restore it. */
  merge_aborted?: boolean
  evidence_path: string
}

export function isWorktreeName(value: string): boolean {
  return WORKTREE_NAME_PATTERN.test(value)
}

interface OperatorWorktreeStore {
  indexPath: string
  mutexPath: string
  newWorktreeRoot: string
}

function resolveOperatorWorktreeStore(root: string): OperatorWorktreeStore {
  const declared = configuredWorktreeRoot(root)

  if (declared !== undefined) {
    return {
      indexPath: resolveInside(root, path.join(declared, 'index.json')),
      mutexPath: resolveInside(root, path.join(declared, '.operation-mutex')),
      newWorktreeRoot: declared,
    }
  }

  const currentIndex = resolveInside(
    root,
    path.join(DEFAULT_WORKTREE_ROOT, 'index.json'),
  )
  const legacyIndex = resolveInside(
    root,
    path.join(LEGACY_DEFAULT_WORKTREE_ROOT, 'index.json'),
  )
  const currentExists = fileExists(currentIndex)
  const legacyExists = fileExists(legacyIndex)

  invariant(
    !(currentExists && legacyExists),
    `Both operator worktree indexes exist: ${toRepoRelative(root, currentIndex)} ` +
      `and ${toRepoRelative(root, legacyIndex)}. Remove or merge one index ` +
      'before continuing.',
    { code: 'WORKTREE_INDEX_CONFLICT' },
  )

  if (legacyExists) {
    return {
      indexPath: legacyIndex,
      mutexPath: resolveInside(
        root,
        path.join(LEGACY_DEFAULT_WORKTREE_ROOT, '.operation-mutex'),
      ),
      newWorktreeRoot: DEFAULT_WORKTREE_ROOT,
    }
  }

  return {
    indexPath: currentIndex,
    mutexPath: resolveInside(
      root,
      path.join(DEFAULT_WORKTREE_ROOT, '.operation-mutex'),
    ),
    newWorktreeRoot: DEFAULT_WORKTREE_ROOT,
  }
}

function worktreeIndexPath(root: string): string {
  return resolveOperatorWorktreeStore(root).indexPath
}

function worktreeMutexPath(root: string): string {
  return resolveOperatorWorktreeStore(root).mutexPath
}

function newWorktreeRoot(root: string): string {
  return resolveOperatorWorktreeStore(root).newWorktreeRoot
}

/**
 * Copy the recognized local harness override into a new self-development
 * worktree before setup runs. Target installations keep harness configuration
 * at the installation root and receive no override copy.
 *
 * Exported so a test can drive the copy failure directly; a worktree creation
 * that reaches this point has already added a Git worktree, which is too much
 * setup to stand behind one filesystem error.
 */
export function handoffSelfDevelopmentLocalConfig(
  installationRoot: string,
  worktreePath: string,
): void {
  if (!isSelfDevelopmentInstallation(installationRoot)) {
    return
  }

  const configName = localConfigName(installationRoot)
  const sourcePath = path.join(installationRoot, configName)

  if (!fileExists(sourcePath)) {
    return
  }

  const targetPath = path.join(worktreePath, configName)

  try {
    copyFileSync(sourcePath, targetPath)
  } catch (error) {
    // Without the wrapper this escaped as a bare Node.js filesystem error,
    // so an agent facing it had no code to act on and no named operation.
    throw new PanError(
      `Failed to copy the local harness override '${configName}' into the ` +
        `new worktree: ${errorMessage(error)}`,
      {
        code: 'WORKTREE_OVERRIDE_COPY_FAILED',
        details: {
          operation: 'configuration_handoff',
          file: configName,
          source: sourcePath,
          target: targetPath,
        },
      },
    )
  }
}

/** One thing a worktree needs before a run can work in it. */
export interface WorktreeReadinessGap {
  /** `setup_output` names a path the setup commands produce. */
  kind: 'setup_output' | 'configuration_handoff'
  /** Worktree-relative path of the missing item. */
  path: string
  reason: string
}

export interface WorktreeReadinessReport {
  workspace: string
  ready: boolean
  /** Every item readiness looked for, in the order it looked. */
  checked: string[]
  /**
   * The declared setup outputs alone. An installation that declares none
   * cannot have its provisioning judged, so a caller that would skip work on
   * a ready worktree tests this rather than `ready`.
   */
  declared_setup_paths: string[]
  gaps: WorktreeReadinessGap[]
}

/**
 * Whether a worktree holds what a run needs before its first prepare.
 *
 * Provisioning used to be a side effect of one creation path, so a worktree
 * created with no configured setup commands, or created by hand outside the
 * harness, only revealed the gap at the first gate as a failing build. The
 * declared readiness paths and the local configuration handoff are the two
 * things creation produces, so they are the two things readiness asserts.
 */
export function worktreeReadiness(
  root: string,
  worktreePath: string,
): WorktreeReadinessReport {
  const absolute = path.resolve(worktreePath)
  const gaps: WorktreeReadinessGap[] = []
  const checked: string[] = []
  const declaredSetupPaths = worktreesConfig(root).readiness_paths

  for (const relative of declaredSetupPaths) {
    checked.push(relative)

    if (!fileExists(path.join(absolute, relative))) {
      gaps.push({
        kind: 'setup_output',
        path: relative,
        reason: `The worktree setup commands produce '${relative}', and it is absent.`,
      })
    }
  }

  const handoff = requiredConfigurationHandoff(root)

  if (handoff) {
    checked.push(handoff)

    if (!fileExists(path.join(absolute, handoff))) {
      gaps.push({
        kind: 'configuration_handoff',
        path: handoff,
        reason: `The self-development local configuration '${handoff}' was not handed off to the worktree.`,
      })
    }
  }

  return {
    workspace: toRepoRelative(root, absolute),
    ready: gaps.length === 0,
    checked,
    declared_setup_paths: declaredSetupPaths,
    gaps,
  }
}

/** Local configuration file a worktree must receive, when one exists. */
function requiredConfigurationHandoff(root: string): string | null {
  if (!isSelfDevelopmentInstallation(root)) {
    return null
  }

  const configName = localConfigName(root)

  return fileExists(path.join(root, configName)) ? configName : null
}

function parseWorktreeRecord(value: unknown, source: string): WorktreeRecord {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_WORKTREE_INDEX',
  })

  for (const field of [
    'name',
    'path',
    'branch',
    'created_from',
    'description',
    'created_at',
  ]) {
    invariant(
      typeof value[field] === 'string' && value[field].length > 0,
      `${source}.${field} MUST be a non-empty string.`,
      { code: 'INVALID_WORKTREE_INDEX' },
    )
  }

  invariant(
    isWorktreeName(value.name as string),
    `${source}.name MUST use lowercase words separated by single hyphens.`,
    { code: 'INVALID_WORKTREE_INDEX' },
  )

  return value as unknown as WorktreeRecord
}

export function parseWorktreeIndex(
  value: unknown,
  source = 'worktree index',
): WorktreeIndex {
  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      Array.isArray(value.worktrees),
    `${source} MUST be a schema version 1 worktree index.`,
    { code: 'INVALID_WORKTREE_INDEX' },
  )

  const worktrees = value.worktrees.map((entry, index) =>
    parseWorktreeRecord(entry, `${source}.worktrees[${index}]`),
  )
  const names = new Set<string>()

  for (const worktree of worktrees) {
    invariant(
      !names.has(worktree.name),
      `${source} names worktree '${worktree.name}' more than once.`,
      { code: 'INVALID_WORKTREE_INDEX' },
    )
    names.add(worktree.name)
  }

  return { schema_version: 1, worktrees }
}

/**
 * Read the durable worktree index.
 *
 * A missing index means no operator worktree exists yet. A malformed index is
 * a hard failure instead: silently treating it as empty would create a second
 * worktree over an existing one and lose the operator's record of the first.
 */
export function readWorktreeIndex(root: string): WorktreeIndex {
  const indexPath = worktreeIndexPath(root)

  if (!fileExists(indexPath)) {
    return { schema_version: 1, worktrees: [] }
  }

  return parseWorktreeIndex(
    readJson(indexPath),
    toRepoRelative(root, indexPath),
  )
}

function persistWorktreeIndex(root: string, index: WorktreeIndex): void {
  const parsed = parseWorktreeIndex(index)

  writeJsonAtomic(worktreeIndexPath(root), {
    ...parsed,
    worktrees: [...parsed.worktrees].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  })
}

export function writeWorktreeIndex(root: string, index: WorktreeIndex): void {
  withOperationMutex(worktreeMutexPath(root), () => {
    persistWorktreeIndex(root, index)
  })
}

/**
 * Git repository the worktree commands act on.
 *
 * Git availability is a property of the deliverable workspace rather than of
 * the installation, so a detached harness reaches its target instead of
 * itself. The index and the worktree directories stay harness-relative.
 */
export function workspaceRepositoryRoot(root: string): string {
  const configured = configuredWorkspaceRoot(root)
  const repositoryRoot = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(root, configured)

  invariant(
    isGitRepository(repositoryRoot),
    'Worktree management requires a Git repository workspace.',
    { code: 'WORKTREE_REQUIRES_GIT' },
  )

  return repositoryRoot
}

/**
 * Resolve an explicitly named repository root: the Git top level of the
 * given directory, which must be a repository.
 */
export function resolveRepositoryRoot(directory: string): string {
  const absolute = path.resolve(directory)

  invariant(
    isGitRepository(absolute),
    `${absolute} is not inside a Git repository.`,
    { code: 'WORKTREE_REQUIRES_GIT' },
  )

  return gitToplevel(absolute)
}

/**
 * Repository one recorded worktree belongs to.
 *
 * `repository_root` points at a directory with its own lifecycle, and a
 * cleanup that removes the pointed-at worktree invalidates every record that
 * names it. An unresolvable pointer is not proof that this worktree is gone,
 * so the workspace repository is tried before anything concludes absence.
 * `kind` names which answer the caller got.
 */
function resolveRecordRepository(
  root: string,
  record: WorktreeRecord,
): {
  repositoryRoot: string | null
  kind: 'recorded' | 'fallback' | 'orphaned'
} {
  if (!record.repository_root) {
    return { repositoryRoot: workspaceRepositoryRoot(root), kind: 'recorded' }
  }

  if (isGitRepository(record.repository_root)) {
    return { repositoryRoot: record.repository_root, kind: 'recorded' }
  }

  const workspace = workspaceRepositoryRoot(root)
  const worktreePath = absoluteWorktreePath(root, record)

  return isPresent(registeredWorktreePaths(workspace), worktreePath)
    ? { repositoryRoot: workspace, kind: 'fallback' }
    : { repositoryRoot: null, kind: 'orphaned' }
}

/** Repository one recorded worktree belongs to, falling back to the workspace. */
function recordRepositoryRoot(root: string, record: WorktreeRecord): string {
  const resolved = resolveRecordRepository(root, record)

  return resolved.repositoryRoot ?? workspaceRepositoryRoot(root)
}

/**
 * Absolute path of the checkout that already holds one local branch.
 *
 * A merge must run inside the checkout Git gave the branch, because Git refuses
 * to move a branch that another worktree holds. Callers that merge a single
 * source cannot use `reconcileWorktrees`, which demands two, so they resolve
 * the held checkout through this function instead of guessing the main root.
 */
export function resolveBranchCheckout(
  root: string,
  branch: string,
  repositoryRootOverride?: string | null,
): string {
  const repositoryRoot = repositoryRootOverride ?? workspaceRepositoryRoot(root)

  invariant(
    gitBranchExists(repositoryRoot, branch),
    `Branch does not exist: ${branch}`,
    { code: 'WORKTREE_BRANCH_NOT_FOUND' },
  )

  const held = gitWorktreeForBranch(repositoryRoot, branch)

  invariant(
    held,
    `Branch '${branch}' is not checked out anywhere, so there is no checkout ` +
      'to merge into. Check it out first, or reconcile into a worktree.',
    { code: 'WORKTREE_BRANCH_NOT_HELD' },
  )

  return held
}

function recordByName(index: WorktreeIndex, name: string): WorktreeRecord {
  const record = index.worktrees.find((entry) => entry.name === name)

  invariant(
    record,
    `No worktree named '${name}' is recorded. Run 'pan worktree list' to ` +
      'see the recorded worktrees.',
    { code: 'WORKTREE_NOT_FOUND' },
  )

  return record
}

function absoluteWorktreePath(root: string, record: WorktreeRecord): string {
  return resolveInside(root, record.path)
}

function registeredWorktreePaths(repositoryRoot: string): Set<string> {
  return new Set(
    gitWorktreePaths(repositoryRoot).map((entry) => path.resolve(entry)),
  )
}

/**
 * Git keeps listing a worktree whose directory an operator deleted, so the
 * worktree must also retain its `.git` pointer before it counts as usable.
 */
function isPresent(registered: Set<string>, absolutePath: string): boolean {
  return (
    registered.has(path.resolve(absolutePath)) &&
    fileExists(path.join(absolutePath, '.git'))
  )
}

/**
 * Resolve the start point of a new worktree.
 *
 * An indexed worktree name wins over an identically named revision, because
 * the operator named something the harness itself created. An omitted source
 * means the branch the main checkout currently holds.
 */
function sourceCommit(
  root: string,
  repositoryRoot: string,
  index: WorktreeIndex,
  from: string | null | undefined,
): string {
  if (!from) {
    const head = gitHead(repositoryRoot)

    invariant(head, 'The workspace repository has no commit to branch from.', {
      code: 'WORKTREE_SOURCE_NOT_FOUND',
    })

    return head
  }

  const indexed = index.worktrees.find((entry) => entry.name === from)

  if (indexed) {
    const indexedPath = absoluteWorktreePath(root, indexed)

    invariant(
      isPresent(registeredWorktreePaths(repositoryRoot), indexedPath),
      `Indexed worktree '${from}' is not registered with Git.`,
      { code: 'WORKTREE_NOT_REGISTERED' },
    )

    const head = gitHead(indexedPath)

    invariant(head, `Indexed worktree '${from}' has no readable HEAD commit.`, {
      code: 'WORKTREE_SOURCE_NOT_FOUND',
    })

    return head
  }

  return gitRevParse(repositoryRoot, from)
}

export function createWorktree(
  root: string,
  name: string,
  options: CreateWorktreeOptions = {},
): WorktreeRecord {
  invariant(
    isWorktreeName(name),
    'Worktree names MUST use lowercase words separated by single hyphens.',
    { code: 'INVALID_WORKTREE_NAME' },
  )

  return withOperationMutex(worktreeMutexPath(root), () =>
    addWorktree(root, name, options),
  )
}

/** The caller holds the index mutex. */
function addWorktree(
  root: string,
  name: string,
  options: CreateWorktreeOptions,
): WorktreeRecord {
  const index = readWorktreeIndex(root)

  invariant(
    !index.worktrees.some((entry) => entry.name === name),
    `Worktree '${name}' already exists in the index.`,
    { code: 'WORKTREE_EXISTS' },
  )

  const config = worktreesConfig(root)
  const worktreePath = resolveInside(
    root,
    path.join(newWorktreeRoot(root), name),
  )

  const configuredRepositoryRoot = workspaceRepositoryRoot(root)
  const repositoryRoot = options.repositoryRoot
    ? resolveRepositoryRoot(options.repositoryRoot)
    : configuredRepositoryRoot

  const branch = name

  invariant(
    gitBranchNameIsValid(repositoryRoot, branch),
    `Configured worktree branch is invalid: ${branch}`,
    { code: 'INVALID_WORKTREE_BRANCH' },
  )

  const adoptable = adoptableWorktree(repositoryRoot, worktreePath, branch)

  invariant(
    adoptable || !fileExists(worktreePath),
    `Worktree path already exists: ${toRepoRelative(root, worktreePath)}`,
    { code: 'WORKTREE_PATH_EXISTS' },
  )
  invariant(
    adoptable ||
      !registeredWorktreePaths(repositoryRoot).has(path.resolve(worktreePath)),
    `Git already registers worktree path: ${worktreePath}`,
    { code: 'WORKTREE_PATH_EXISTS' },
  )
  invariant(
    adoptable || !gitBranchExists(repositoryRoot, branch),
    `Worktree branch already exists: ${branch}. Choose another worktree ` +
      'name, or delete that branch yourself first.',
    { code: 'WORKTREE_BRANCH_EXISTS' },
  )

  const adoptedHead = adoptable ? gitHead(worktreePath) : null

  invariant(
    !adoptable || adoptedHead,
    `Worktree '${name}' is registered with Git but has no commit to adopt.`,
    { code: 'WORKTREE_BRANCH_NOT_FOUND' },
  )

  const commit =
    adoptedHead ?? sourceCommit(root, repositoryRoot, index, options.from)

  if (!adoptable) {
    ensureDir(path.dirname(worktreePath))
    gitWorktreeAddOnBranch(repositoryRoot, worktreePath, branch, commit)
  }

  const description = options.description?.trim() || name
  const record: WorktreeRecord = {
    name,
    path: toRepoRelative(root, worktreePath),
    branch,
    created_from: commit,
    description,
    created_at: now(),
    ...(adoptable ? { adopted_at: now() } : {}),
    ...(path.resolve(repositoryRoot) !== path.resolve(configuredRepositoryRoot)
      ? { repository_root: repositoryRoot }
      : {}),
  }

  // The index entry is written before the setup commands run, so a failed
  // setup leaves a worktree the operator can inspect and remove through the
  // harness rather than an unrecorded directory.
  persistWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [...index.worktrees, record],
  })
  handoffSelfDevelopmentLocalConfig(root, worktreePath)
  runSetupCommands(config.setup, worktreePath, {
    label: `worktree '${name}'`,
    code: 'WORKTREE_SETUP_FAILED',
  })

  return record
}

/**
 * Whether an existing path is a worktree the harness can take over.
 *
 * An operator who made a worktree with plain `git worktree add` met the
 * refusal that protects an unrelated path, with no route to the repair. A
 * path Git already registers, on the branch this name maps to, is that
 * operator's worktree and nothing else: indexing it, handing off the local
 * configuration, and running the setup commands is exactly what creation
 * would have produced. Every other existing path still refuses.
 */
function adoptableWorktree(
  repositoryRoot: string,
  worktreePath: string,
  branch: string,
): boolean {
  if (!fileExists(worktreePath)) {
    return false
  }

  if (
    !registeredWorktreePaths(repositoryRoot).has(path.resolve(worktreePath))
  ) {
    return false
  }

  return gitCurrentBranch(worktreePath) === branch
}

export function listWorktrees(root: string): ListedWorktree[] {
  const registrations = new Map<string, Set<string>>()
  const registeredFor = (repositoryRoot: string): Set<string> => {
    let known = registrations.get(repositoryRoot)

    if (!known) {
      known = fileExists(repositoryRoot)
        ? registeredWorktreePaths(repositoryRoot)
        : new Set<string>()
      registrations.set(repositoryRoot, known)
    }

    return known
  }

  return readWorktreeIndex(root).worktrees.map((record) => {
    const worktreePath = absoluteWorktreePath(root, record)
    const resolved = resolveRecordRepository(root, record)
    const present =
      resolved.repositoryRoot !== null &&
      isPresent(registeredFor(resolved.repositoryRoot), worktreePath)

    return {
      ...record,
      registered: present,
      // A record that resolves against no repository is orphaned, which is a
      // different state from a worktree Git no longer registers.
      orphaned: resolved.kind === 'orphaned',
      current_commit: present ? gitHead(worktreePath) : null,
      dirty: present ? gitWorktreeIsDirty(worktreePath) : null,
    }
  })
}

/** Workspace path a command targeting the named worktree should use. */
export function resolveWorktreeWorkspace(root: string, name: string): string {
  const index = readWorktreeIndex(root)
  const record = recordByName(index, name)
  const repositoryRoot = recordRepositoryRoot(root, record)
  const worktreePath = absoluteWorktreePath(root, record)

  invariant(
    isPresent(registeredWorktreePaths(repositoryRoot), worktreePath),
    `Indexed worktree '${name}' is not registered with Git.`,
    { code: 'WORKTREE_NOT_REGISTERED' },
  )
  const currentBranch = gitCurrentBranch(worktreePath)

  if (currentBranch !== record.branch) {
    invariant(
      gitBranchExists(repositoryRoot, record.branch),
      `Recorded branch does not exist: ${record.branch}`,
      { code: 'WORKTREE_BRANCH_NOT_FOUND' },
    )

    const heldBy = gitWorktreeForBranch(repositoryRoot, record.branch)

    invariant(
      !heldBy || path.resolve(heldBy) === path.resolve(worktreePath),
      `Recorded branch '${record.branch}' is checked out at '${heldBy}'.`,
      { code: 'WORKTREE_BRANCH_HELD' },
    )
    invariant(
      !gitWorktreeIsDirty(worktreePath),
      `Worktree '${name}' is on branch '${currentBranch ?? '(detached)'}' ` +
        `with uncommitted work. Clean it before switching to ` +
        `'${record.branch}'.`,
      { code: 'WORKTREE_DIRTY_BRANCH_MISMATCH' },
    )

    gitSwitchBranch(worktreePath, record.branch)
  }

  invariant(
    gitCurrentBranch(worktreePath) === record.branch,
    `Indexed worktree '${name}' could not switch to its recorded branch '${record.branch}'.`,
    { code: 'WORKTREE_BRANCH_MISMATCH' },
  )

  return record.path
}

/**
 * Worktree a `--worktree <name>` option names, created when the index does
 * not hold it yet. Every entry point that accepts the shared worktree option
 * resolves through this function, so the create-or-resolve behavior stays
 * identical across runs, utilities, and standalone personas.
 */
export function resolveOrCreateWorktree(
  root: string,
  name: string,
  description: string,
): WorktreeRecord {
  const existing = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === name,
  )

  if (!existing) {
    return createWorktree(root, name, { description })
  }

  resolveWorktreeWorkspace(root, name)

  return existing
}

/**
 * Workspace specifier for a utility command: an indexed worktree name resolves
 * to its recorded path, and anything else passes through as a directory path.
 */
export function resolveWorkspacePathOrWorktree(
  root: string,
  value: string,
): string {
  if (!isWorktreeName(value)) {
    return value
  }

  const record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === value,
  )

  return record ? record.path : value
}

function startDetachedScratchRemoval(target: string): void {
  const remover = spawn('/bin/rm', ['-rf', target], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  })

  remover.once('error', () => {
    // The discarded tree stays beside the worktrees root for the next sweep.
  })
  remover.unref()
}

/**
 * Move test scratch out of a worktree and remove it from a detached process,
 * answering where the tree went.
 *
 * Removing the tree in place would charge the operator's worktree command a
 * recursive unlink of a cloned fixture tree. A rename inside the worktrees
 * root is a metadata operation, so the command returns when Git returns. A
 * failed handoff leaves Git removal authoritative and never fails the
 * command.
 */
export function sweepWorktreeTestScratch(worktreePath: string): string | null {
  const scratch = path.join(worktreePath, TEST_SCRATCH_RELATIVE_PATH)

  if (!fileExists(scratch)) {
    return null
  }

  const discarded = path.join(
    path.dirname(worktreePath),
    `.${path.basename(worktreePath)}-tests-${process.pid}-${Date.now()}.noindex`,
  )

  try {
    renameSync(scratch, discarded)
  } catch {
    return null
  }

  startDetachedScratchRemoval(discarded)

  return discarded
}

/**
 * Retry the scratch removals earlier sweeps handed off and lost.
 *
 * A detached remover can still die with the session that started it, which
 * is how 699 fixture clones once accumulated, and a discarded tree beside
 * the worktrees root is visited by no other cleanup. Restarting `rm -rf` on
 * a tree another remover is already deleting is harmless, so this needs no
 * ownership marker to keep two removers apart.
 */
export function sweepDiscardedWorktreeScratch(directory: string): string[] {
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch {
    return []
  }

  const discarded = names
    .filter((name) => DISCARDED_SCRATCH_NAME.test(name))
    .map((name) => path.join(directory, name))
    .sort()

  for (const target of discarded) {
    startDetachedScratchRemoval(target)
  }

  return discarded
}

/**
 * Remove one operator worktree and its index entry.
 *
 * Removing a worktree discards uncommitted work, so a dirty worktree is
 * refused without an explicit force flag. A worktree the operator already
 * deleted by hand leaves only its stale registration, which is pruned here.
 */
export function removeWorktree(
  root: string,
  name: string,
  options: { force?: boolean; deleteBranch?: boolean } = {},
): RemoveWorktreeResult {
  return withOperationMutex(worktreeMutexPath(root), () => {
    const index = readWorktreeIndex(root)
    const record = recordByName(index, name)
    const worktreePath = absoluteWorktreePath(root, record)
    const resolved = resolveRecordRepository(root, record)
    const repositoryRoot = resolved.repositoryRoot
    const present =
      repositoryRoot !== null &&
      isPresent(registeredWorktreePaths(repositoryRoot), worktreePath)

    // Presence is resolved and the dirty refusal fires before any mutation,
    // so a removal that removes nothing leaves the record for the retry.
    invariant(
      !present || options.force || !gitWorktreeIsDirty(worktreePath),
      `WARNING: worktree '${name}' has uncommitted work in ${record.path}. ` +
        'Removing it discards that work. Pass --force to remove it anyway.',
      { code: 'WORKTREE_DIRTY' },
    )
    invariant(
      present || !fileExists(worktreePath),
      `Worktree '${name}' exists at ${record.path} but no repository ` +
        'registers it, so removal would drop the record for a directory ' +
        'that stays on disk. Remove the directory yourself, or repair the ' +
        'record with `./bin/pan worktree resolve ' +
        `${name}\`.`,
      { code: 'WORKTREE_UNRESOLVED' },
    )

    let discardedScratch: string | null = null

    if (present && repositoryRoot) {
      sweepDiscardedWorktreeScratch(path.dirname(worktreePath))
      discardedScratch = sweepWorktreeTestScratch(worktreePath)
      gitWorktreeRemove(repositoryRoot, worktreePath, options.force ?? false)
    } else if (repositoryRoot) {
      gitWorktreePrune(repositoryRoot)
    }

    const branchDeletion =
      options.deleteBranch && repositoryRoot
        ? deleteMergedBranch(repositoryRoot, record.branch)
        : null

    persistWorktreeIndex(root, {
      schema_version: 1,
      worktrees: index.worktrees.filter((entry) => entry.name !== name),
    })

    return {
      name,
      path: record.path,
      ...(branchDeletion?.deleted
        ? { deleted_branch: record.branch }
        : { kept_branch: record.branch }),
      ...(branchDeletion && !branchDeletion.deleted
        ? { branch_deletion_refused: branchDeletion.reason }
        : {}),
      removed_worktree: present,
      pruned_index_entry: !present,
      ...(discardedScratch ? { discarded_test_scratch: discardedScratch } : {}),
    }
  })
}

/**
 * Delete a worktree branch once the default branch already holds its history.
 *
 * Every removal in the recorded cleanup returned `kept_branch` and cost a
 * separate `git branch -d`. Deletion stays bounded to a branch that is an
 * ancestor of the default branch, so unmerged work is never discarded here.
 */
function deleteMergedBranch(
  repositoryRoot: string,
  branch: string,
): { deleted: boolean; reason: string } {
  if (!gitBranchExists(repositoryRoot, branch)) {
    return { deleted: false, reason: `Branch '${branch}' does not exist.` }
  }

  const defaultBranch = gitDefaultBranch(repositoryRoot)

  if (!defaultBranch) {
    return {
      deleted: false,
      reason: 'The repository has no resolvable default branch.',
    }
  }

  if (!gitIsAncestor(repositoryRoot, branch, defaultBranch)) {
    return {
      deleted: false,
      reason:
        `Branch '${branch}' is not an ancestor of '${defaultBranch}', so it ` +
        'carries work the default branch does not hold.',
    }
  }

  const result = gitDeleteBranch(repositoryRoot, branch)

  return {
    deleted: result.deleted,
    reason: result.reason ?? `Branch '${branch}' was deleted.`,
  }
}

function reconcileEvidencePath(root: string): {
  relative: string
  absolute: string
} {
  const relative = 'runtime/logs/worktrees/reconcile.jsonl'

  return { relative, absolute: resolveInside(root, relative) }
}

function conflictRequestPath(
  root: string,
  target: string,
): {
  relative: string
  absolute: string
} {
  const timestamp = now().replace(/[-:.TZ]/gu, '')
  // A checkout target is named by its branch, which can contain `/`.
  const label = target.toLowerCase().replaceAll(/[^a-z0-9-]+/gu, '-')
  const relative = queueInboxRelativePath(
    `worktree-reconcile-${label}-${timestamp}.md`,
  )

  return { relative, absolute: resolveInside(root, relative) }
}

/**
 * Reconcile target after resolution. A `worktree` target is a recorded
 * worktree the merge runs inside. A `checkout` target is the checkout that
 * already holds the target branch, which includes the main checkout: Git
 * refuses a second checkout of a held branch, so the merge must run where the
 * branch already lives.
 */
interface ResolvedReconcileTarget {
  name: string
  branch: string
  kind: 'worktree' | 'checkout'
  absolutePath: string
  displayPath: string
}

function renderConflictRequest(
  target: ResolvedReconcileTarget,
  sources: WorktreeRecord[],
  mergedSources: string[],
  conflictedSource: string,
  conflicts: string[],
): string {
  const remaining = sources
    .map((source) => source.name)
    .filter(
      (source) =>
        source !== conflictedSource && !mergedSources.includes(source),
    )
  const aborted = target.kind === 'checkout'
  const lines = [
    '# Worktree reconcile conflict',
    '',
    'The reconcile command stopped after Git reported a conflict.',
    '',
    '## Target',
    '',
    `- ${aborted ? 'Checkout' : 'Worktree'}: \`${target.name}\``,
    `- Path: \`${target.displayPath}\``,
    `- Branch: \`${target.branch}\``,
    '',
    '## Sources',
    '',
    `- Completed: ${mergedSources.length > 0 ? mergedSources.join(', ') : 'None'}`,
    `- Conflicted: ${conflictedSource}`,
    `- Not started: ${remaining.length > 0 ? remaining.join(', ') : 'None'}`,
    '',
    '## Conflicted paths',
    '',
    ...conflicts.map((entry) => `- \`${entry}\``),
    '',
    '## Next action',
    '',
    ...(aborted
      ? [
          'The conflicted merge was aborted, so the checkout is back in its ' +
            'pre-merge state. Completed source merges remain on the branch.',
          `Reconcile the remaining sources into a worktree with ` +
            `\`pan worktree reconcile --into <worktree>\`, resolve the ` +
            `conflict there, then reconcile that worktree into ` +
            `\`${target.branch}\`.`,
        ]
      : [
          `Run an agent task in \`${target.displayPath}\` and resolve each conflicted path.`,
          'Do not commit the result without explicit operator approval.',
        ]),
    '',
  ]

  return `${lines.join('\n')}\n`
}

function reconcileInvocation(
  target: ReconcileTarget,
  sources: string[],
): string {
  const targetOption = target.into
    ? ['--into', target.into]
    : ['--into-branch', target.into_branch ?? '']

  return [
    'pan worktree reconcile',
    ...targetOption,
    ...sources.flatMap((source) => ['--source', source]),
  ].join(' ')
}

/** Index name for the worktree that materializes a branch reconcile target. */
function branchTargetName(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')

  invariant(
    isWorktreeName(slug),
    `Branch '${branch}' does not reduce to a usable worktree name.`,
    { code: 'INVALID_WORKTREE_NAME' },
  )

  return slug
}

/**
 * Path a reconcile result reports. A held checkout can sit outside the
 * harness root in a detached installation, so an outside path stays absolute
 * instead of failing the repo-relative conversion.
 */
function reconcileDisplayPath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath)

  if (relative === '') {
    return '.'
  }

  return relative.startsWith('..') || path.isAbsolute(relative)
    ? absolutePath
    : relative
}

function worktreeReconcileTarget(
  root: string,
  record: WorktreeRecord,
): ResolvedReconcileTarget {
  return {
    name: record.name,
    branch: record.branch,
    kind: 'worktree',
    absolutePath: absoluteWorktreePath(root, record),
    displayPath: record.path,
  }
}

/**
 * Resolve the reconcile target to a working tree. The caller holds the index
 * mutex.
 *
 * A branch target merges through a working tree because Git can only merge
 * inside one. An existing record on that branch is reused. A branch a
 * checkout already holds — the main checkout included — merges inside that
 * checkout, because Git refuses a second checkout of a held branch. Any other
 * existing branch is checked out into a new recorded worktree.
 */
function resolveReconcileTarget(
  root: string,
  repositoryRoot: string,
  index: WorktreeIndex,
  target: ReconcileTarget,
): ResolvedReconcileTarget {
  if (target.into) {
    return worktreeReconcileTarget(root, recordByName(index, target.into))
  }

  const branch = target.into_branch ?? ''
  const existing = index.worktrees.find((entry) => entry.branch === branch)

  if (existing) {
    return worktreeReconcileTarget(root, existing)
  }

  invariant(
    gitBranchExists(repositoryRoot, branch),
    `Target branch does not exist: ${branch}`,
    { code: 'WORKTREE_BRANCH_NOT_FOUND' },
  )

  const heldBy = gitWorktreeForBranch(repositoryRoot, branch)

  if (heldBy) {
    return {
      name: branch,
      branch,
      kind: 'checkout',
      absolutePath: heldBy,
      displayPath: reconcileDisplayPath(root, heldBy),
    }
  }

  const name = branchTargetName(branch)

  invariant(
    !index.worktrees.some((entry) => entry.name === name),
    `Worktree '${name}' already exists but is not on branch '${branch}'. ` +
      `Reconcile into it by name, or remove it first.`,
    { code: 'WORKTREE_EXISTS' },
  )

  const worktreePath = resolveInside(
    root,
    path.join(newWorktreeRoot(root), name),
  )

  invariant(
    !fileExists(worktreePath),
    `Worktree path already exists: ${toRepoRelative(root, worktreePath)}`,
    { code: 'WORKTREE_PATH_EXISTS' },
  )

  ensureDir(path.dirname(worktreePath))
  gitWorktreeAddOnExistingBranch(repositoryRoot, worktreePath, branch)

  const record: WorktreeRecord = {
    name,
    path: toRepoRelative(root, worktreePath),
    branch,
    created_from: gitRevParse(repositoryRoot, branch),
    description: `Reconcile target for branch '${branch}'`,
    created_at: now(),
  }

  persistWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [...index.worktrees, record],
  })

  return worktreeReconcileTarget(root, record)
}

/**
 * Absolute path of a working tree that holds one existing local branch,
 * creating a recorded worktree for it when no checkout holds it yet.
 *
 * This is the single-source counterpart of `reconcileWorktrees`: a merge of one
 * branch needs a working tree exactly as a merge of two does, and the target is
 * resolved by the same rules, so the held checkout, a recorded worktree on the
 * branch, or a newly recorded worktree come back in that order.
 */
export function materializeBranchCheckout(
  root: string,
  branch: string,
  repositoryRootOverride?: string | null,
): string {
  const repositoryRoot = repositoryRootOverride ?? workspaceRepositoryRoot(root)

  return withOperationMutex(
    worktreeMutexPath(root),
    () =>
      resolveReconcileTarget(root, repositoryRoot, readWorktreeIndex(root), {
        into_branch: branch,
      }).absolutePath,
  )
}

/**
 * Merge two or more recorded source worktrees into a target worktree or an
 * existing local branch.
 *
 * Sources merge one at a time, so a conflict names exactly one source. The
 * conflicted merge state stays in the target worktree, and a conflict request
 * under `runtime/inbox/queue/` gives an agent the resolution task. Merge commits
 * land only on harness-managed or operator-named branches, and the recorded
 * operator invocation is the ACTION-001 authorization trail.
 */
export function reconcileWorktrees(
  root: string,
  target: ReconcileTarget,
  sourceNames: string[],
): ReconcileWorktreesResult {
  invariant(
    Boolean(target.into) !== Boolean(target.into_branch),
    'Reconcile requires exactly one of --into or --into-branch.',
    { code: 'WORKTREE_TARGET_REQUIRED' },
  )
  invariant(
    sourceNames.length >= 2,
    'Reconcile requires at least two --source worktrees.',
    { code: 'WORKTREE_SOURCES_REQUIRED' },
  )
  invariant(
    new Set(sourceNames).size === sourceNames.length,
    'Reconcile source worktrees MUST be unique.',
    { code: 'WORKTREE_SOURCE_DUPLICATE' },
  )
  invariant(
    !target.into || !sourceNames.includes(target.into),
    'The target worktree MUST NOT also be a source.',
    { code: 'WORKTREE_TARGET_IS_SOURCE' },
  )

  return withOperationMutex(worktreeMutexPath(root), () => {
    const index = readWorktreeIndex(root)
    const sources = sourceNames.map((name) => recordByName(index, name))
    // Every source must belong to one repository, which is also where the
    // target branch lives: a merge across repositories has no meaning.
    const repositoryRoots = new Set(
      sources.map((record) => path.resolve(recordRepositoryRoot(root, record))),
    )

    invariant(
      repositoryRoots.size === 1,
      'Reconcile source worktrees MUST belong to one Git repository; ' +
        `found ${[...repositoryRoots].join(', ')}.`,
      { code: 'WORKTREE_REPOSITORY_MISMATCH' },
    )

    const [repositoryRoot] = [...repositoryRoots] as [string]
    const sourceRegistrations = registeredWorktreePaths(repositoryRoot)

    for (const record of sources) {
      const worktreePath = absoluteWorktreePath(root, record)

      invariant(
        isPresent(sourceRegistrations, worktreePath),
        `Indexed worktree '${record.name}' is not registered with Git.`,
        { code: 'WORKTREE_NOT_REGISTERED' },
      )
      invariant(
        !gitWorktreeIsDirty(worktreePath),
        `Worktree '${record.name}' has uncommitted work and cannot be reconciled.`,
        { code: 'WORKTREE_DIRTY' },
      )
      invariant(
        gitBranchExists(repositoryRoot, record.branch),
        `Indexed branch does not exist: ${record.branch}`,
        { code: 'WORKTREE_BRANCH_NOT_FOUND' },
      )
      invariant(
        gitCurrentBranch(worktreePath) === record.branch,
        `Indexed worktree '${record.name}' is not on its recorded branch '${record.branch}'.`,
        { code: 'WORKTREE_BRANCH_MISMATCH' },
      )
    }

    const resolved = resolveReconcileTarget(root, repositoryRoot, index, target)

    invariant(
      !sources.some(
        (source) =>
          source.name === resolved.name ||
          absoluteWorktreePath(root, source) === resolved.absolutePath,
      ),
      'The target worktree MUST NOT also be a source.',
      { code: 'WORKTREE_TARGET_IS_SOURCE' },
    )

    const targetRegistrations = registeredWorktreePaths(repositoryRoot)

    if (resolved.kind === 'worktree') {
      invariant(
        isPresent(targetRegistrations, resolved.absolutePath),
        `Indexed worktree '${resolved.name}' is not registered with Git.`,
        { code: 'WORKTREE_NOT_REGISTERED' },
      )
      invariant(
        gitBranchExists(repositoryRoot, resolved.branch),
        `Indexed branch does not exist: ${resolved.branch}`,
        { code: 'WORKTREE_BRANCH_NOT_FOUND' },
      )
      invariant(
        gitCurrentBranch(resolved.absolutePath) === resolved.branch,
        `Indexed worktree '${resolved.name}' is not on its recorded branch '${resolved.branch}'.`,
        { code: 'WORKTREE_BRANCH_MISMATCH' },
      )
    }

    invariant(
      !gitWorktreeIsDirty(resolved.absolutePath),
      resolved.kind === 'checkout'
        ? `The checkout at '${resolved.displayPath}' holds branch ` +
            `'${resolved.branch}' and has uncommitted work. Commit or stash ` +
            'that work, or reconcile into a worktree instead.'
        : `Worktree '${resolved.name}' has uncommitted work and cannot be reconciled.`,
      { code: 'WORKTREE_DIRTY' },
    )

    const targetPath = resolved.absolutePath
    const mergedSources: string[] = []
    const evidence = reconcileEvidencePath(root)
    const operatorInvocation = reconcileInvocation(target, sourceNames)

    appendJsonLine(evidence.absolute, {
      event: 'worktree_reconcile_started',
      recorded_at: now(),
      operator_invocation: operatorInvocation,
      outcome: 'started',
      target: resolved.name,
      target_branch: resolved.branch,
      target_kind: resolved.kind,
      target_path: resolved.displayPath,
      sources: sourceNames,
    })

    for (const source of sources) {
      const merge = gitMergeBranch(targetPath, source.branch)

      if (merge.succeeded) {
        mergedSources.push(source.name)
        continue
      }

      const conflicts = gitConflictedPaths(targetPath)

      invariant(
        conflicts.length > 0,
        `Git could not merge '${source.name}': ${merge.stderr || merge.stdout}`,
        {
          code: 'WORKTREE_MERGE_FAILED',
          details: { stdout: merge.stdout, stderr: merge.stderr },
        },
      )

      // A recorded worktree keeps the conflicted merge state as the agent's
      // resolution workspace. A held checkout is the operator's own working
      // tree, so the conflicted merge is aborted to restore it.
      const mergeAborted = resolved.kind === 'checkout'

      if (mergeAborted) {
        gitMergeAbort(targetPath)
      }

      const request = conflictRequestPath(root, resolved.name)

      writeTextAtomic(
        request.absolute,
        renderConflictRequest(
          resolved,
          sources,
          mergedSources,
          source.name,
          conflicts,
        ),
      )
      appendJsonLine(evidence.absolute, {
        event: 'worktree_reconcile',
        recorded_at: now(),
        operator_invocation: operatorInvocation,
        outcome: 'conflict',
        target: resolved.name,
        target_branch: resolved.branch,
        target_kind: resolved.kind,
        target_path: resolved.displayPath,
        sources: sourceNames,
        merged_sources: mergedSources,
        conflicted_source: source.name,
        conflicted_paths: conflicts,
        merge_aborted: mergeAborted,
        conflict_request: request.relative,
      })

      return {
        status: 'conflict',
        target: resolved.name,
        target_branch: resolved.branch,
        target_kind: resolved.kind,
        target_path: resolved.displayPath,
        sources: sourceNames,
        merged_sources: mergedSources,
        conflicted_source: source.name,
        conflicted_paths: conflicts,
        conflict_request: request.relative,
        merge_aborted: mergeAborted,
        evidence_path: evidence.relative,
      }
    }

    appendJsonLine(evidence.absolute, {
      event: 'worktree_reconcile',
      recorded_at: now(),
      operator_invocation: operatorInvocation,
      outcome: 'merged',
      target: resolved.name,
      target_branch: resolved.branch,
      target_kind: resolved.kind,
      target_path: resolved.displayPath,
      sources: sourceNames,
      merged_sources: mergedSources,
      conflicted_paths: [],
    })

    return {
      status: 'merged',
      target: resolved.name,
      target_branch: resolved.branch,
      target_kind: resolved.kind,
      target_path: resolved.displayPath,
      sources: sourceNames,
      merged_sources: mergedSources,
      conflicted_paths: [],
      evidence_path: evidence.relative,
    }
  })
}
