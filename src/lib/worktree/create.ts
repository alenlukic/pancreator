/**
 * Worktree creation and adoption, listing, and workspace resolution by
 * worktree name or path.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import {
  gitBranchNameIsValid,
  gitCurrentBranch,
  gitSwitchBranch,
} from '../git/branches.js'
import { gitHead, gitRevParse, gitBranchExists } from '../git/core.js'
import {
  gitWorktreeAddOnBranch,
  gitWorktreeIsDirty,
  gitWorktreeForBranch,
} from '../git/worktree-merge.js'
import {
  withOperationMutex,
  resolveInside,
  fileExists,
  toRepoRelative,
  ensureDir,
} from '../io.js'
import { worktreesConfig } from '../project-config.js'
import { runSetupCommands } from '../setup-commands.js'
import { now } from '../state.js'
import {
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  carryAttributedInputs,
  handoffSelfDevelopmentLocalConfig,
  isWorktreeName,
  newWorktreeRoot,
  syncSelfDevelopmentWorktreeProjection,
  worktreeMutexPath,
  type CreateWorktreeOptions,
  type CreatedWorktree,
  type ListedWorktree,
  type WorktreeIndex,
  type WorktreeRecord,
} from './store.js'
import {
  absoluteWorktreePath,
  isPresent,
  persistWorktreeIndex,
  readWorktreeIndex,
  recordByName,
  recordRepositoryRoot,
  registeredWorktreePaths,
  resolveRecordRepository,
  resolveRepositoryRoot,
  workspaceRepositoryRoot,
} from './registry.js'

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

/**
 * Under the worktree index mutex, add a Git worktree on a new branch named
 * after it (from `from` or the repository HEAD), or adopt an existing
 * registered checkout already on that branch. Records it in the index before
 * handing off local configuration, carrying attributed inputs, and running the
 * configured setup commands. Throws `PanError` `INVALID_WORKTREE_NAME`,
 * `WORKTREE_EXISTS`, `WORKTREE_PATH_EXISTS`, `WORKTREE_BRANCH_EXISTS`, or
 * `WORKTREE_SETUP_FAILED`, among others.
 */
export function createWorktree(
  root: string,
  name: string,
  options: CreateWorktreeOptions = {},
): CreatedWorktree {
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
): CreatedWorktree {
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

  const carriedPaths = carryAttributedInputs(root, worktreePath)

  runSetupCommands(config.setup, worktreePath, {
    label: `worktree '${name}'`,
    code: 'WORKTREE_SETUP_FAILED',
  })
  syncSelfDevelopmentWorktreeProjection(worktreePath)

  return { ...record, carried_paths: carriedPaths }
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

/**
 * Every indexed worktree with its live state: whether Git still registers it,
 * whether its record resolves to no repository (orphaned), and, when
 * registered, its HEAD commit and whether it has uncommitted work. Read-only.
 */
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
    const cleanliness = workspaceCleanliness(root, worktreePath)

    if (!cleanliness.clean) {
      invariant(
        false,
        cleanTreeRefusal(cleanliness, {
          action:
            `Worktree '${name}' is on branch ` +
            `'${currentBranch ?? '(detached)'}' and cannot switch`,
          remedy: `Resolve each path before switching to '${record.branch}'.`,
        }),
        { code: 'WORKTREE_DIRTY_BRANCH_MISMATCH' },
      )
    }

    gitSwitchBranch(worktreePath, record.branch)
  }

  invariant(
    gitCurrentBranch(worktreePath) === record.branch,
    `Indexed worktree '${name}' could not switch to its recorded branch '${record.branch}'.`,
    { code: 'WORKTREE_BRANCH_MISMATCH' },
  )

  // The projection derives from the canonical sources at the checked-out
  // head, and a fast-forward moves that head without changing the branch
  // name. The refresh therefore follows every resolution rather than only a
  // branch switch: it is a render and a compare that writes nothing when the
  // projection already matches.
  syncSelfDevelopmentWorktreeProjection(worktreePath)

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
