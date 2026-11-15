/**
 * Cohort release, integration merges, auto-advance to the next cohort, and the
 * integration records they write.
 */

import { invariant, errorMessage, PanError } from '../errors.js'
import {
  gitWorktreeIsDirty,
  gitStatusPaths,
  gitStagePaths,
  gitCommit,
  gitRevParse,
  gitBranchNameIsValid,
  gitBranchExists,
  gitIsAncestor,
  gitCreateBranch,
  gitMergeBranch,
  gitConflictedPaths,
  gitMergeAbort,
  gitHead,
} from '../git.js'
import { fileExists, resolveInside, writeJsonAtomic } from '../io.js'
import { panCommand } from '../project-config.js'
import { now } from '../state.js'
import type {
  RunState,
  CohortSessionState,
  CohortChunkRecord,
} from '../types.js'
import {
  readWorktreeIndex,
  reconcileWorktrees,
  materializeBranchCheckout,
} from '../worktrees.js'
import {
  committablePaths,
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  cohortStatePath,
  loadCohortState,
  persistCohortState,
  withCohortSession,
  type CohortAdvanceResult,
  type CohortContinuationResult,
  type CohortIntegrationResult,
} from './state.js'
import {
  chunkIdSlug,
  chunkIsMerged,
  assertChunkPredecessorsMerged,
  chunkRunState,
  chunksOfCohort,
  cohortRepositoryRoot,
  firstUnsatisfiedIndex,
  integrationBranch,
  succeededUnmergedChunks,
} from './chunks.js'
import { continueAfterIntegration } from './delivery.js'

/**
 * Start or adopt the release run of a session whose every cohort is
 * integrated, without merging anything.
 *
 * `cohort integrate` is the merge verb, and the merge is the operator's own
 * action, so the retry of a release start that failed after the final merge
 * proof landed must not be spelled as another integrate. This command runs
 * only the continuation: it refuses while any cohort lacks its merge proof,
 * and it adopts a release run that already exists exactly as the integrate
 * path does, so a repeated call is idempotent.
 */
export function releaseCohort(
  root: string,
  cohortId: string,
): CohortContinuationResult {
  const state = loadCohortState(root, cohortId)
  const unsatisfied = firstUnsatisfiedIndex(root, state)

  invariant(
    unsatisfied === null,
    `Cohort ${unsatisfied} of session ${cohortId} holds no merge proof, so ` +
      'the release run cannot start. Finish every chunk run of cohort ' +
      `${unsatisfied}, then run '${panCommand(root)} cohort integrate ` +
      `${cohortId}'.`,
    {
      code: 'COHORT_NOT_SATISFIED',
      details: { cohort_id: cohortId, unsatisfied_cohort_index: unsatisfied },
    },
  )

  return continueAfterIntegration(root, cohortId)
}

/**
 * Commit each unit worktree of the active cohort, merge the chunk branches
 * into the base branch, and record the satisfaction entry.
 *
 * The satisfaction entry is the only signal that unblocks the next cohort, and
 * it is written only after a clean merge. An unsucceeded chunk run, an
 * integration checkout holding uncommitted work, or a conflict therefore
 * leaves the next cohort blocked rather than letting it branch from work that
 * never landed. A cohort whose every chunk the operator abandoned has nothing
 * to merge and is recorded satisfied.
 *
 * `intoBranch` retargets the session: this cohort and every later one merge
 * into that branch, and later cohorts branch from it. The option exists for the
 * checkout that holds the base branch and carries unrelated uncommitted work,
 * which a merge must not touch. The branch is created from the current
 * integration head when it does not exist, and an existing branch is accepted
 * only when it already contains that head, so no earlier cohort merge is lost.
 *
 * Once the merge proof is durable, the harness continues the plan itself: a
 * non-final cohort starts the next cohort, the final cohort starts the release
 * run. The continuation runs outside the session mutex the merge held, and its
 * failure is reported next to the integration instead of undoing it, because
 * the merge proof is true whatever happened afterwards. A repeated integrate
 * after every cohort landed reports the final merge proof again and completes
 * the continuation the earlier call left undone.
 */
export function integrateCohort(
  root: string,
  cohortId: string,
  options: { intoBranch?: string | null } = {},
): CohortIntegrationResult {
  let integrated: IntegratedCohort | null
  try {
    integrated = integrateActiveCohort(root, cohortId, options)
  } catch (error) {
    continuePartialMerge(root, cohortId, error)
    throw error
  }

  invariant(
    integrated,
    `Session ${cohortId} reported no cohort to integrate.`,
    { code: 'INVALID_COHORT_STATE' },
  )

  return {
    ...integrated,
    autostart: continueAfterIntegration(root, cohortId),
  }
}

/**
 * Integrate the submitting unit (and any sibling of its group that also
 * succeeded), then continue the plan.
 *
 * A unit that reports success is ready to merge even while an unrelated
 * sibling of the same group is still running. Two siblings can both reach
 * this before either takes the session mutex, so the integration rechecks
 * succeeded-unmerged units of the submitting group under that mutex and the
 * loser reports no advance instead of a failure against a later group.
 */
export function maybeAdvanceCohort(
  root: string,
  state: RunState,
): CohortAdvanceResult | null {
  const binding = state.cohort

  if (
    !binding ||
    binding.role === 'release' ||
    state.status !== 'succeeded' ||
    !fileExists(cohortStatePath(root, binding.cohort_id))
  ) {
    return null
  }

  if (!('chunk' in binding)) {
    return null
  }

  const {
    cohort_id: cohortId,
    cohort_index: cohortIndex,
    chunk: chunkId,
  } = binding
  const session = loadCohortState(root, cohortId)
  const chunk = session.chunks.find((entry) => entry.id === chunkId)

  // Read before the mutex: a unit that already merged, or that never ran,
  // costs nothing beyond these record reads.
  if (!chunk || chunkIsMerged(session, chunk)) {
    return null
  }

  try {
    const integrated = integrateActiveCohort(root, cohortId, {
      onlyCohortIndex: cohortIndex,
    })

    if (!integrated) {
      return null
    }

    return {
      status: 'integrated',
      ...integrated,
      autostart: continueAfterIntegration(root, cohortId),
    }
  } catch (error) {
    const autostart = continuePartialMerge(root, cohortId, error)
    // Only the conflicted unit lacks proof. Preserve the error and report
    // any continuation that the successfully merged units unlocked.
    return {
      status: 'failed',
      cohort_id: cohortId,
      cohort_index: cohortIndex,
      error: errorMessage(error),
      manual_commands: [`${panCommand(root)} cohort integrate ${cohortId}`],
      ...(autostart ? { autostart } : {}),
    }
  }
}

function continuePartialMerge(
  root: string,
  cohortId: string,
  error: unknown,
): CohortContinuationResult | undefined {
  if (
    error instanceof PanError &&
    error.code === 'COHORT_INTEGRATION_INCOMPLETE' &&
    Array.isArray(
      (error.details as { merged_chunks?: unknown } | undefined)?.merged_chunks,
    ) &&
    (error.details as { merged_chunks: unknown[] }).merged_chunks.length > 0
  ) {
    return continueAfterIntegration(root, cohortId)
  }
  return undefined
}

type IntegratedCohort = Omit<CohortIntegrationResult, 'autostart'>

interface IntegrateCohortOptions {
  intoBranch?: string | null
  /**
   * The one group this call may merge. The automatic advance sets it to the
   * submitting run's own group, so a sibling submission that loses the race
   * reports no advance instead of merging a group it never ran.
   */
  onlyCohortIndex?: number
}

/** Null only when the named group has nothing left to merge. */
function integrateActiveCohort(
  root: string,
  cohortId: string,
  options: IntegrateCohortOptions,
): IntegratedCohort | null {
  return withCohortSession(root, cohortId, (initial) => {
    const loaded = options.intoBranch
      ? retargetIntegration(root, initial, options.intoBranch)
      : initial

    if (options.onlyCohortIndex !== undefined) {
      const toMerge = succeededUnmergedChunks(
        root,
        loaded,
        options.onlyCohortIndex,
      )

      if (toMerge.length === 0) {
        return null
      }

      return mergeSucceededChunks(
        root,
        loaded,
        options.onlyCohortIndex,
        toMerge,
      )
    }

    const cohortIndex = firstUnsatisfiedIndex(root, loaded)

    if (cohortIndex === null) {
      invariant(
        !loaded.release_run_id,
        `Every cohort of session ${cohortId} is already integrated.`,
        { code: 'COHORT_COMPLETE' },
      )

      // Every merge proof landed but no release run is recorded: an earlier
      // integrate died between the merge and its continuation. Reporting the
      // final proof lets the caller run the continuation that is missing.
      return lastIntegratedCohort(loaded)
    }

    const remaining = chunksOfCohort(loaded, cohortIndex).filter(
      (chunk) => !chunk.abandoned,
    )

    if (remaining.length === 0) {
      return recordAbandonedCohort(root, loaded, cohortIndex)
    }

    const ready = integrableChunks(root, loaded)
    const next =
      ready.find((chunk) => chunk.cohort_index === cohortIndex) ?? ready[0]
    const toMerge = next
      ? succeededUnmergedChunks(root, loaded, next.cohort_index)
      : []

    if (toMerge.length === 0) {
      const blocked =
        remaining.find((chunk) => !chunkIsMerged(loaded, chunk)) ?? remaining[0]
      const run = chunkRunState(root, blocked.run_id)

      invariant(
        false,
        `Chunk '${blocked.id}' run '${blocked.run_id ?? '(not started)'}' ` +
          `reports '${run?.status ?? 'not_started'}', not 'succeeded', so ` +
          `cohort ${cohortIndex} cannot be integrated.`,
        {
          code: 'COHORT_INTEGRATION_INCOMPLETE',
          details: {
            chunk: blocked.id,
            status: run?.status ?? 'not_started',
          },
        },
      )
    }

    return mergeSucceededChunks(root, loaded, toMerge[0].cohort_index, toMerge)
  })
}

/**
 * Succeeded-unmerged units of any group, so an operator retry can merge a
 * later dependent while an unrelated earlier sibling is still running.
 */
function integrableChunks(
  root: string,
  state: CohortSessionState,
): CohortChunkRecord[] {
  return state.chunks.filter(
    (chunk) =>
      !chunk.abandoned &&
      !chunkIsMerged(state, chunk) &&
      chunkRunState(root, chunk.run_id)?.status === 'succeeded',
  )
}

function mergeSucceededChunks(
  root: string,
  loaded: CohortSessionState,
  cohortIndex: number,
  chunks: CohortChunkRecord[],
): IntegratedCohort {
  const index = readWorktreeIndex(root)
  const unitCommits = new Map<string, string>()

  for (const chunk of chunks) {
    assertChunkPredecessorsMerged(root, loaded, chunk)
    const record = index.worktrees.find(
      (entry) => entry.name === chunk.worktree,
    )

    invariant(
      record,
      `Chunk '${chunk.id}' has no recorded worktree, so there is nothing to ` +
        'merge.',
      { code: 'COHORT_INTEGRATION_INCOMPLETE', details: { chunk: chunk.id } },
    )

    const unitCommit = commitUnitWorktree(
      root,
      resolveInside(root, record.path),
      loaded,
      chunk.cohort_index,
      chunk,
    )

    if (unitCommit) {
      unitCommits.set(chunk.id, unitCommit)
    }
  }

  const merged =
    chunks.length >= 2
      ? mergeThroughReconcile(root, loaded, cohortIndex, chunks, unitCommits)
      : mergeSingleChunkBranch(
          root,
          loaded,
          cohortIndex,
          chunks[0],
          unitCommits,
        )

  recordMergedChunks(root, loaded, chunks, merged)

  return {
    cohort_id: loaded.cohort_id,
    cohort_index: cohortIndex,
    base_branch: loaded.base_branch,
    integration_branch: integrationBranch(loaded),
    merge_commit: merged.merge_commit,
    merged_chunks: chunks.map((chunk) => chunk.id),
    evidence_path: merged.evidence_path,
  }
}

/** The caller holds the session mutex and has verified these branches landed. */
function recordMergedChunks(
  root: string,
  state: CohortSessionState,
  chunks: CohortChunkRecord[],
  merged: MergeOutcome,
): void {
  persistCohortState(root, {
    ...state,
    satisfaction: [
      ...state.satisfaction,
      ...chunks.map((chunk) => ({
        cohort_index: chunk.cohort_index,
        chunk: chunk.id,
        recorded_at: now(),
        base_branch: state.base_branch,
        integration_branch: integrationBranch(state),
        merge_commit: merged.merge_commit,
        evidence_path: merged.evidence_path,
      })),
    ],
  })
}

/**
 * Commit whatever a finished unit left uncommitted in its own worktree, and
 * return the commit the harness created.
 *
 * The unit's run already reported success when this runs, so the change set
 * is that unit's deliverable rather than work in progress. Only the paths the
 * worktree's own status reports are staged, so a commit can never carry a
 * sibling unit's changes or the integration checkout's. A path a
 * `read-only-input` attribution record covers is withheld: the operator
 * declared it an input the repository does not track, so no harness commit
 * carries it. A worktree that is clean, or dirty only through such inputs, is
 * a no-op and returns null. A tracked modification of a read-only input is
 * neither committable nor exempt, so it refuses rather than silently dropping
 * out of the merge.
 */
function commitUnitWorktree(
  root: string,
  worktreePath: string,
  state: CohortSessionState,
  cohortIndex: number,
  chunk: CohortChunkRecord,
): string | null {
  if (!gitWorktreeIsDirty(worktreePath)) {
    return null
  }

  const { committable, withheld } = committablePaths(
    root,
    worktreePath,
    gitStatusPaths(worktreePath),
  )
  const cleanliness = workspaceCleanliness(root, worktreePath)
  const withheldTracked = cleanliness.blocking.filter(
    (entry) => entry.tracked && withheld.includes(entry.path),
  )

  if (withheldTracked.length > 0) {
    invariant(
      false,
      cleanTreeRefusal(
        { ...cleanliness, blocking: withheldTracked },
        {
          action: `Chunk '${chunk.id}' cannot be integrated`,
          remedy:
            'Restore each path or re-attribute it, then run ' +
            `'${panCommand(root)} cohort integrate ${state.cohort_id}' again.`,
        },
      ),
      {
        code: 'COHORT_INTEGRATION_INCOMPLETE',
        details: {
          chunk: chunk.id,
          blocking_paths: withheldTracked.map((entry) => entry.path),
        },
      },
    )
  }

  if (committable.length === 0) {
    return null
  }

  gitStagePaths(worktreePath, committable)

  return gitCommit(
    worktreePath,
    `cohort: unit '${chunk.id}' of session ${state.cohort_id}\n\n` +
      `Unit: ${chunk.id}\n` +
      `Run: ${chunk.run_id ?? 'none'}\n` +
      `Cohort: ${state.cohort_id}\n` +
      `Group: ${cohortIndex}\n`,
  )
}

/**
 * The recorded merge proof of the last cohort that landed. The satisfaction
 * entry is the proof itself, so the report is rebuilt from it rather than from
 * a second merge.
 */
export function lastIntegratedCohort(
  state: CohortSessionState,
): IntegratedCohort {
  const last = state.satisfaction.at(-1)

  invariant(last, `Session ${state.cohort_id} records no integrated cohort.`, {
    code: 'INVALID_COHORT_STATE',
  })

  return {
    cohort_id: state.cohort_id,
    cohort_index: last.cohort_index,
    base_branch: last.base_branch,
    integration_branch: last.integration_branch ?? integrationBranch(state),
    merge_commit: last.merge_commit,
    merged_chunks:
      last.chunk === undefined
        ? chunksOfCohort(state, last.cohort_index)
            .filter((chunk) => !chunk.abandoned)
            .map((chunk) => chunk.id)
        : state.satisfaction
            .filter(
              (entry) =>
                entry.evidence_path === last.evidence_path &&
                entry.chunk !== undefined,
            )
            .map((entry) => entry.chunk as string),
    evidence_path: last.evidence_path,
  }
}

interface MergeOutcome {
  merge_commit: string
  evidence_path: string
}

function integrationRecordPath(
  cohortId: string,
  cohortIndex: number,
  chunks: readonly CohortChunkRecord[],
): string {
  const suffix =
    chunks.length === 0
      ? ''
      : `-${chunks.map((chunk) => chunkIdSlug(chunk.id)).join('-')}`

  return `runtime/logs/cohorts/${cohortId}/integration-${cohortIndex}${suffix}.json`
}

/**
 * Write the durable integration record of one cohort and return its path.
 *
 * `COHORT-001` makes this record the merge proof of the cohort, so every
 * integration path writes the same shape: the branches and chunk runs that
 * landed, the integration head before and after, and the ledger entry a
 * reconcile appended, when one did. A caller that returned the shared
 * reconcile ledger instead left the per-cohort proof unwritten.
 */
function writeIntegrationRecord(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
  record: {
    merged: CohortChunkRecord[]
    /** Commit the harness created for a unit worktree that held work. */
    unit_commits?: ReadonlyMap<string, string>
    abandoned?: Array<{ chunk: string; note: string; recorded_at: string }>
    base_commit_before_merge: string
    merge_commit: string
    reconcile_evidence_path?: string
  },
): string {
  const repositoryRoot = cohortRepositoryRoot(root, state)
  const evidencePath = integrationRecordPath(
    state.cohort_id,
    cohortIndex,
    record.merged,
  )

  writeJsonAtomic(resolveInside(root, evidencePath), {
    schema_version: 1,
    cohort_id: state.cohort_id,
    cohort_index: cohortIndex,
    base_branch: state.base_branch,
    integration_branch: integrationBranch(state),
    merged_branches: record.merged.flatMap((chunk) =>
      chunk.branch ? [chunk.branch] : [],
    ),
    merged_chunks: record.merged.map((chunk) => ({
      chunk: chunk.id,
      run_id: chunk.run_id ?? null,
      branch: chunk.branch ?? null,
      worktree: chunk.worktree ?? null,
      branch_head: chunk.branch
        ? gitRevParse(repositoryRoot, chunk.branch)
        : null,
      unit_commit: record.unit_commits?.get(chunk.id) ?? null,
    })),
    abandoned_chunks: record.abandoned ?? [],
    base_commit_before_merge: record.base_commit_before_merge,
    merge_commit: record.merge_commit,
    ...(record.reconcile_evidence_path
      ? { reconcile_evidence_path: record.reconcile_evidence_path }
      : {}),
    recorded_at: now(),
  })

  return evidencePath
}

/**
 * Record a new integration branch on the session. The caller holds the session
 * mutex.
 *
 * The branch must carry every merge already recorded, so a new branch starts at
 * the current integration head and an existing branch must contain it. A
 * branch that does not is refused rather than silently dropping cohort work.
 */
function retargetIntegration(
  root: string,
  state: CohortSessionState,
  requested: string,
): CohortSessionState {
  const branch = requested.trim()
  const repositoryRoot = cohortRepositoryRoot(root, state)
  const current = integrationBranch(state)

  invariant(
    branch.length > 0 && gitBranchNameIsValid(repositoryRoot, branch),
    `--into-branch MUST name a valid Git branch; got '${requested}'.`,
    { code: 'INVALID_ARGUMENT' },
  )

  if (branch === current) {
    return state
  }

  const currentHead = gitRevParse(repositoryRoot, current)

  if (gitBranchExists(repositoryRoot, branch)) {
    invariant(
      gitIsAncestor(repositoryRoot, currentHead, branch),
      `Branch '${branch}' does not contain the head of '${current}' ` +
        `(${currentHead.slice(0, 12)}), so integrating into it would drop ` +
        `work already landed there. Name a branch that contains it, or a ` +
        'new branch name to create from it.',
      {
        code: 'COHORT_INTEGRATION_TARGET_DIVERGED',
        details: { branch, current_branch: current, current_head: currentHead },
      },
    )
  } else {
    gitCreateBranch(repositoryRoot, branch, currentHead)
  }

  return persistCohortState(root, { ...state, integration_branch: branch })
}

/**
 * Record satisfaction for a cohort whose every chunk the operator abandoned.
 *
 * Nothing merges, so the base branch head stands in for the merge commit and
 * the evidence record lists the abandoned chunks with their notes. Without this
 * entry the cohort could never be satisfied, and every later cohort would stay
 * blocked behind a decision the operator already recorded.
 */
function recordAbandonedCohort(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): IntegratedCohort {
  const abandoned = chunksOfCohort(state, cohortIndex).map((chunk) => ({
    chunk: chunk.id,
    note: chunk.abandoned?.note ?? '',
    recorded_at: chunk.abandoned?.recorded_at ?? '',
  }))
  const target = integrationBranch(state)
  const baseHead = gitRevParse(cohortRepositoryRoot(root, state), target)
  const evidencePath = writeIntegrationRecord(root, state, cohortIndex, {
    merged: [],
    abandoned,
    base_commit_before_merge: baseHead,
    merge_commit: baseHead,
  })

  persistCohortState(root, {
    ...state,
    satisfaction: [
      ...state.satisfaction,
      {
        cohort_index: cohortIndex,
        recorded_at: now(),
        base_branch: state.base_branch,
        integration_branch: target,
        merge_commit: baseHead,
        evidence_path: evidencePath,
      },
    ],
  })

  return {
    cohort_id: state.cohort_id,
    cohort_index: cohortIndex,
    base_branch: state.base_branch,
    integration_branch: target,
    merge_commit: baseHead,
    merged_chunks: [],
    evidence_path: evidencePath,
  }
}

/**
 * Merge two or more chunk branches into the base branch, one after another.
 *
 * The merges are sequential Git commits, so a conflict on a later chunk leaves
 * the earlier merges on the base branch. Undoing them would rewrite the
 * operator's branch, which stays operator-owned, so the outcome is recorded
 * instead: the pre-merge commit, every chunk that landed, and the chunk that
 * conflicted, in a durable incomplete-integration record and in the error.
 */
function mergeThroughReconcile(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
  chunks: CohortChunkRecord[],
  unitCommits: ReadonlyMap<string, string>,
): MergeOutcome {
  const repositoryRoot = cohortRepositoryRoot(root, state)
  const target = integrationBranch(state)
  const baseBefore = gitRevParse(repositoryRoot, target)

  const worktreeNames = chunks.map((chunk) => chunk.worktree as string)
  const chunkOfWorktree = (name: string): string =>
    chunks.find((chunk) => chunk.worktree === name)?.id ?? name

  const result = reconcileWorktrees(
    root,
    { into_branch: target },
    worktreeNames,
    { cohortIntegration: true },
  )

  if (result.status === 'conflict') {
    const landed = result.merged_sources.map(chunkOfWorktree)
    const conflicted = chunkOfWorktree(result.conflicted_source ?? '')
    const recordPath = incompleteIntegrationPath(
      state.cohort_id,
      cohortIndex,
      chunks,
    )

    writeJsonAtomic(resolveInside(root, recordPath), {
      schema_version: 1,
      cohort_id: state.cohort_id,
      cohort_index: cohortIndex,
      base_branch: state.base_branch,
      integration_branch: target,
      base_commit_before_merge: baseBefore,
      base_commit_after_conflict: gitRevParse(repositoryRoot, target),
      merged_chunks: landed,
      conflicted_chunk: conflicted,
      conflicted_paths: result.conflicted_paths,
      conflict_request: result.conflict_request,
      merge_aborted: result.merge_aborted,
      recorded_at: now(),
    })

    // Reconcile is sequential: a later conflict cannot undo earlier merges.
    // Record proofs for the branches that actually landed, so their own
    // successors are not held behind an unrelated conflicted sibling.
    const landedChunks = chunks.filter((chunk) => landed.includes(chunk.id))
    if (landedChunks.length > 0) {
      const mergeCommit = gitRevParse(repositoryRoot, target)
      const evidencePath = writeIntegrationRecord(root, state, cohortIndex, {
        merged: landedChunks,
        unit_commits: unitCommits,
        base_commit_before_merge: baseBefore,
        merge_commit: mergeCommit,
        reconcile_evidence_path: result.evidence_path,
      })
      recordMergedChunks(root, state, landedChunks, {
        merge_commit: mergeCommit,
        evidence_path: evidencePath,
      })
    }

    invariant(
      false,
      `Merging cohort ${cohortIndex} of session ${state.cohort_id} into ` +
        `'${target}' conflicted on chunk '${conflicted}': ` +
        `${result.conflicted_paths.join(', ')}. ` +
        (landed.length > 0
          ? `Chunks already merged onto '${target}': ` +
            `${landed.join(', ')} (base was ${baseBefore.slice(0, 12)} ` +
            'before integration). '
          : `No chunk was merged; '${target}' is unchanged. `) +
        `The record is at ${recordPath}. Resolve the conflict, then run ` +
        `'${panCommand(root)} cohort integrate ${state.cohort_id}' again.`,
      {
        code: 'COHORT_INTEGRATION_INCOMPLETE',
        details: {
          cohort_index: cohortIndex,
          base_commit_before_merge: baseBefore,
          merged_chunks: landed,
          conflicted_chunk: conflicted,
          conflicted_paths: result.conflicted_paths,
          record_path: recordPath,
        },
      },
    )
  }

  const mergeCommit = gitRevParse(repositoryRoot, target)

  return {
    merge_commit: mergeCommit,
    evidence_path: writeIntegrationRecord(root, state, cohortIndex, {
      merged: chunks,
      unit_commits: unitCommits,
      base_commit_before_merge: baseBefore,
      merge_commit: mergeCommit,
      reconcile_evidence_path: result.evidence_path,
    }),
  }
}

function incompleteIntegrationPath(
  cohortId: string,
  cohortIndex: number,
  chunks: readonly CohortChunkRecord[],
): string {
  const suffix =
    chunks.length === 0
      ? ''
      : `-${chunks.map((chunk) => chunkIdSlug(chunk.id)).join('-')}`

  return `runtime/logs/cohorts/${cohortId}/integration-${cohortIndex}${suffix}-incomplete.json`
}

/**
 * Merge one chunk branch into the base branch.
 *
 * `reconcileWorktrees` demands at least two sources, so a single-chunk cohort
 * merges directly inside the working tree that holds the integration branch,
 * resolved by the same rules a reconcile target uses: the checkout that holds
 * it, else a recorded worktree on it, else a worktree created for it. A
 * conflict is aborted, which restores that checkout instead of leaving the
 * operator's own workspace in a stopped merge.
 */
function mergeSingleChunkBranch(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
  chunk: CohortChunkRecord,
  unitCommits: ReadonlyMap<string, string>,
): MergeOutcome {
  const branch = chunk.branch
  const target = integrationBranch(state)

  invariant(
    branch,
    `Chunk '${chunk.id}' has no recorded branch, so there is nothing to merge.`,
    { code: 'COHORT_INTEGRATION_INCOMPLETE', details: { chunk: chunk.id } },
  )

  const repositoryRoot = cohortRepositoryRoot(root, state)
  const checkout = materializeBranchCheckout(root, target, repositoryRoot)

  const cleanliness = workspaceCleanliness(root, checkout)

  if (!cleanliness.clean) {
    invariant(
      false,
      cleanTreeRefusal(cleanliness, {
        action: `The checkout that holds '${target}' cannot receive the merge`,
        remedy:
          'Resolve each path, or integrate again with --into-branch ' +
          '<branch> to merge into a dedicated integration branch.',
      }),
      {
        code: 'COHORT_INTEGRATION_INCOMPLETE',
        details: {
          blocking_paths: cleanliness.blocking.map((entry) => entry.path),
        },
      },
    )
  }

  const baseBefore = gitRevParse(repositoryRoot, target)
  const merge = gitMergeBranch(checkout, branch)

  if (!merge.succeeded) {
    const conflicted = gitConflictedPaths(checkout)

    gitMergeAbort(checkout)

    invariant(
      false,
      `Merging chunk '${chunk.id}' into '${target}' conflicted on ` +
        `${conflicted.join(', ') || 'an unknown path'}. The merge was ` +
        'aborted. Resolve the divergence, then integrate again.',
      {
        code: 'COHORT_INTEGRATION_INCOMPLETE',
        details: { cohort_index: cohortIndex, conflicted_paths: conflicted },
      },
    )
  }

  const mergeCommit = gitHead(checkout)

  invariant(mergeCommit, 'The merge produced no readable commit.', {
    code: 'COHORT_INTEGRATION_INCOMPLETE',
  })

  return {
    merge_commit: mergeCommit,
    evidence_path: writeIntegrationRecord(root, state, cohortIndex, {
      merged: [chunk],
      unit_commits: unitCommits,
      base_commit_before_merge: baseBefore,
      merge_commit: mergeCommit,
    }),
  }
}
