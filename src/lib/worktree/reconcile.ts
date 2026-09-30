/**
 * Worktree reconciliation into a target branch, its conflict requests and
 * evidence, and branch checkout materialization.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { queueInboxRelativePath } from '../inbox.js'
import { gitCurrentBranch, gitConflictedPaths } from '../git/branches.js'
import { gitBranchExists, gitRevParse } from '../git/core.js'
import {
  gitWorktreeForBranch,
  gitWorktreeAddOnExistingBranch,
  gitMergeBranch,
  gitMergeAbort,
} from '../git/worktree-merge.js'
import {
  resolveInside,
  fileExists,
  toRepoRelative,
  ensureDir,
  withOperationMutex,
  appendJsonLine,
  writeTextAtomic,
} from '../io.js'
import { now } from '../state.js'
import {
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  isWorktreeName,
  newWorktreeRoot,
  worktreeMutexPath,
  type ReconcileOptions,
  type ReconcileTarget,
  type ReconcileWorktreesResult,
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
  workspaceRepositoryRoot,
} from './registry.js'

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
          'Commit the result once every conflict is resolved.',
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
  options: ReconcileOptions = {},
): ReconcileWorktreesResult {
  invariant(
    Boolean(target.into) !== Boolean(target.into_branch),
    'Reconcile requires exactly one of --into or --into-branch.',
    { code: 'WORKTREE_TARGET_REQUIRED' },
  )

  // pan-dev and main are protected landing targets. Every release landing on
  // pan-dev must go through `pan release land`, which holds the mutex,
  // integrates, allocates a version, verifies, and fast-forwards the branch.
  // A direct reconcile into pan-dev or main bypasses that gate.
  const protectedBranches = new Set(['pan-dev', 'main'])

  invariant(
    options.cohortIntegration === true ||
      !target.into_branch ||
      !protectedBranches.has(target.into_branch),
    `Reconcile cannot target '${target.into_branch}' directly. ` +
      `Use 'pan release land --worktree <name>' to land on pan-dev, ` +
      `which integrates, versions, verifies, and fast-forwards the branch.`,
    { code: 'LANDING_REQUIRES_RELEASE_LAND' },
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
      const sourceCleanliness = workspaceCleanliness(root, worktreePath)

      if (!sourceCleanliness.clean) {
        invariant(
          false,
          cleanTreeRefusal(sourceCleanliness, {
            action: `Worktree '${record.name}' cannot be reconciled`,
            remedy: 'Resolve each path, then reconcile again.',
          }),
          { code: 'WORKTREE_DIRTY' },
        )
      }

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

    const targetCleanliness = workspaceCleanliness(root, resolved.absolutePath)

    if (!targetCleanliness.clean) {
      invariant(
        false,
        cleanTreeRefusal(
          targetCleanliness,
          resolved.kind === 'checkout'
            ? {
                action:
                  `The checkout at '${resolved.displayPath}' holds branch ` +
                  `'${resolved.branch}' and cannot receive the merge`,
                remedy:
                  'Resolve each path, or reconcile into a worktree instead.',
              }
            : {
                action: `Worktree '${resolved.name}' cannot be reconciled`,
                remedy: 'Resolve each path, then reconcile again.',
              },
        ),
        { code: 'WORKTREE_DIRTY' },
      )
    }

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
