/**
 * Worktree readiness, the persisted worktree index, repository-root
 * resolution, and record lookup.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { isGitRepository, gitToplevel, gitBranchExists } from '../git/core.js'
import {
  gitWorktreeForBranch,
  gitWorktreePaths,
} from '../git/worktree-merge.js'
import {
  fileExists,
  toRepoRelative,
  isRecord,
  readJson,
  writeJsonAtomic,
  withOperationMutex,
  resolveInside,
} from '../io.js'
import {
  worktreesConfig,
  isSelfDevelopmentInstallation,
  localConfigName,
  configuredWorkspaceRoot,
} from '../project-config.js'
import {
  isWorktreeName,
  worktreeIndexPath,
  worktreeMutexPath,
  type WorktreeIndex,
  type WorktreeRecord,
} from './store.js'

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

/**
 * Validate a raw worktree index: schema version 1, every record carrying its
 * required non-empty fields and a valid worktree name, and no duplicate names.
 * Throws `PanError` `INVALID_WORKTREE_INDEX` naming the offending path under
 * `source`.
 */
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

/**
 * Validate the index and atomically write it with its records sorted by name.
 * Takes no lock: the caller holds the worktree mutex. Throws `PanError`
 * `INVALID_WORKTREE_INDEX` for an invalid index.
 */
export function persistWorktreeIndex(root: string, index: WorktreeIndex): void {
  const parsed = parseWorktreeIndex(index)

  writeJsonAtomic(worktreeIndexPath(root), {
    ...parsed,
    worktrees: [...parsed.worktrees].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  })
}

/**
 * Validate and atomically write the worktree index under the worktree mutex.
 * A caller that already holds the mutex uses `persistWorktreeIndex` instead.
 */
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
export function resolveRecordRepository(
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
export function recordRepositoryRoot(
  root: string,
  record: WorktreeRecord,
): string {
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

/**
 * The indexed worktree record with this name. Throws `PanError`
 * `WORKTREE_NOT_FOUND` when none is recorded.
 */
export function recordByName(
  index: WorktreeIndex,
  name: string,
): WorktreeRecord {
  const record = index.worktrees.find((entry) => entry.name === name)

  invariant(
    record,
    `No worktree named '${name}' is recorded. Run 'pan worktree list' to ` +
      'see the recorded worktrees.',
    { code: 'WORKTREE_NOT_FOUND' },
  )

  return record
}

/**
 * Absolute path of a recorded worktree, resolved from its harness-relative
 * path. Throws `PanError` `PATH_ESCAPE` when the path leaves the harness root.
 */
export function absoluteWorktreePath(
  root: string,
  record: WorktreeRecord,
): string {
  return resolveInside(root, record.path)
}

/**
 * Resolved absolute paths of every worktree Git registers for the
 * repository, including ones whose directory is gone. Empty when
 * `git worktree list` fails.
 */
export function registeredWorktreePaths(repositoryRoot: string): Set<string> {
  return new Set(
    gitWorktreePaths(repositoryRoot).map((entry) => path.resolve(entry)),
  )
}

/**
 * Git keeps listing a worktree whose directory an operator deleted, so the
 * worktree must also retain its `.git` pointer before it counts as usable.
 */
export function isPresent(
  registered: Set<string>,
  absolutePath: string,
): boolean {
  return (
    registered.has(path.resolve(absolutePath)) &&
    fileExists(path.join(absolutePath, '.git'))
  )
}
