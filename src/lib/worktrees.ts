import path from 'node:path'

import { invariant } from './errors.js'
import {
  gitBranchExists,
  gitBranchNameIsValid,
  gitConflictedPaths,
  gitCurrentBranch,
  gitHead,
  gitMergeAbort,
  gitMergeBranch,
  gitRevParse,
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
import { configuredWorkspaceRoot, worktreesConfig } from './project-config.js'
import { runSetupCommands } from './setup-commands.js'
import { now } from './state.js'

const WORKTREE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export interface WorktreeRecord {
  name: string
  path: string
  branch: string
  created_from: string
  description: string
  created_at: string
}

export interface WorktreeIndex {
  schema_version: 1
  worktrees: WorktreeRecord[]
}

export interface ListedWorktree extends WorktreeRecord {
  registered: boolean
  current_commit: string | null
  dirty: boolean | null
}

export interface CreateWorktreeOptions {
  from?: string | null
  description?: string | null
}

export interface RemoveWorktreeResult {
  name: string
  path: string
  /** Branch deletion stays operator-owned, so removal always keeps it. */
  kept_branch: string
  removed_worktree: boolean
  pruned_index_entry: boolean
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

function worktreeIndexPath(root: string): string {
  const config = worktreesConfig(root)

  return resolveInside(root, path.join(config.root, 'index.json'))
}

function worktreeMutexPath(root: string): string {
  const config = worktreesConfig(root)

  return resolveInside(root, path.join(config.root, '.operation-mutex'))
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
function workspaceRepositoryRoot(root: string): string {
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
  const worktreePath = resolveInside(root, path.join(config.root, name))

  invariant(
    !fileExists(worktreePath),
    `Worktree path already exists: ${toRepoRelative(root, worktreePath)}`,
    { code: 'WORKTREE_PATH_EXISTS' },
  )

  const repositoryRoot = workspaceRepositoryRoot(root)

  invariant(
    !registeredWorktreePaths(repositoryRoot).has(path.resolve(worktreePath)),
    `Git already registers worktree path: ${worktreePath}`,
    { code: 'WORKTREE_PATH_EXISTS' },
  )

  const branch = `${config.branch_prefix}${name}`

  invariant(
    gitBranchNameIsValid(repositoryRoot, branch),
    `Configured worktree branch is invalid: ${branch}`,
    { code: 'INVALID_WORKTREE_BRANCH' },
  )
  invariant(
    !gitBranchExists(repositoryRoot, branch),
    `Worktree branch already exists: ${branch}. Choose another worktree ` +
      'name, or delete that branch yourself first.',
    { code: 'WORKTREE_BRANCH_EXISTS' },
  )

  const commit = sourceCommit(root, repositoryRoot, index, options.from)

  ensureDir(path.dirname(worktreePath))
  gitWorktreeAddOnBranch(repositoryRoot, worktreePath, branch, commit)

  const description = options.description?.trim() || name
  const record: WorktreeRecord = {
    name,
    path: toRepoRelative(root, worktreePath),
    branch,
    created_from: commit,
    description,
    created_at: now(),
  }

  // The index entry is written before the setup commands run, so a failed
  // setup leaves a worktree the operator can inspect and remove through the
  // harness rather than an unrecorded directory.
  persistWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [...index.worktrees, record],
  })
  runSetupCommands(config.setup, worktreePath, {
    label: `worktree '${name}'`,
    code: 'WORKTREE_SETUP_FAILED',
  })

  return record
}

export function listWorktrees(root: string): ListedWorktree[] {
  const repositoryRoot = workspaceRepositoryRoot(root)
  const registered = registeredWorktreePaths(repositoryRoot)

  return readWorktreeIndex(root).worktrees.map((record) => {
    const worktreePath = absoluteWorktreePath(root, record)
    const present = isPresent(registered, worktreePath)

    return {
      ...record,
      registered: present,
      current_commit: present ? gitHead(worktreePath) : null,
      dirty: present ? gitWorktreeIsDirty(worktreePath) : null,
    }
  })
}

/** Workspace path a command targeting the named worktree should use. */
export function resolveWorktreeWorkspace(root: string, name: string): string {
  const index = readWorktreeIndex(root)
  const record = recordByName(index, name)
  const repositoryRoot = workspaceRepositoryRoot(root)
  const worktreePath = absoluteWorktreePath(root, record)

  invariant(
    isPresent(registeredWorktreePaths(repositoryRoot), worktreePath),
    `Indexed worktree '${name}' is not registered with Git.`,
    { code: 'WORKTREE_NOT_REGISTERED' },
  )
  invariant(
    gitCurrentBranch(worktreePath) === record.branch,
    `Indexed worktree '${name}' is not on its recorded branch '${record.branch}'.`,
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
  options: { force?: boolean } = {},
): RemoveWorktreeResult {
  return withOperationMutex(worktreeMutexPath(root), () => {
    const index = readWorktreeIndex(root)
    const record = recordByName(index, name)
    const worktreePath = absoluteWorktreePath(root, record)
    const repositoryRoot = workspaceRepositoryRoot(root)
    const present = isPresent(
      registeredWorktreePaths(repositoryRoot),
      worktreePath,
    )

    invariant(
      !present || options.force || !gitWorktreeIsDirty(worktreePath),
      `WARNING: worktree '${name}' has uncommitted work in ${record.path}. ` +
        'Removing it discards that work. Pass --force to remove it anyway.',
      { code: 'WORKTREE_DIRTY' },
    )

    if (present) {
      gitWorktreeRemove(repositoryRoot, worktreePath, options.force ?? false)
    } else {
      gitWorktreePrune(repositoryRoot)
    }

    persistWorktreeIndex(root, {
      schema_version: 1,
      worktrees: index.worktrees.filter((entry) => entry.name !== name),
    })

    return {
      name,
      path: record.path,
      kept_branch: record.branch,
      removed_worktree: present,
      pruned_index_entry: !present,
    }
  })
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
  const relative = `runtime/inbox/worktree-reconcile-${label}-${timestamp}.md`

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

  const config = worktreesConfig(root)
  const worktreePath = resolveInside(root, path.join(config.root, name))

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
 * Merge two or more recorded source worktrees into a target worktree or an
 * existing local branch.
 *
 * Sources merge one at a time, so a conflict names exactly one source. The
 * conflicted merge state stays in the target worktree, and a conflict request
 * under `runtime/inbox/` gives an agent the resolution task. Merge commits
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
    const repositoryRoot = workspaceRepositoryRoot(root)
    const index = readWorktreeIndex(root)
    const sources = sourceNames.map((name) => recordByName(index, name))
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
