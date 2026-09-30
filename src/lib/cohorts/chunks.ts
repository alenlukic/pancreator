/**
 * Chunk run queries, cohort satisfaction, and the predecessor checks that
 * order one cohort after another.
 */

import { invariant } from '../errors.js'
import { fileExists, sha256 } from '../io.js'
import { panCommand } from '../project-config.js'
import { statePath, loadState } from '../state.js'
import type {
  RunState,
  CohortSessionState,
  CohortChunkRecord,
} from '../types.js'
import { workspaceRepositoryRoot } from '../worktrees.js'
import {
  DEFAULT_COHORT_MAX_PARALLEL,
  TERMINAL_STATUSES,
  cohortStatePath,
  loadCohortState,
} from './state.js'

export function chunkRunState(
  root: string,
  runId: string | undefined,
): RunState | null {
  if (!runId || !fileExists(statePath(root, runId))) {
    return null
  }

  return loadState(root, runId)
}

export function chunksOfCohort(
  state: CohortSessionState,
  cohortIndex: number,
): CohortChunkRecord[] {
  return state.chunks.filter((chunk) => chunk.cohort_index === cohortIndex)
}

/** Parallelism limit of one session; older records predate the field. */
export function cohortMaxParallel(state: CohortSessionState): number {
  const recorded = state.max_parallel

  return Number.isInteger(recorded) && Number(recorded) >= 1
    ? Number(recorded)
    : DEFAULT_COHORT_MAX_PARALLEL
}

/**
 * Chunk runs of one cohort that exist and have not reached a terminal state.
 * A chunk whose run record is missing counts as live, because the fan-out that
 * created it may still be writing it.
 */
export function liveChunkRuns(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): number {
  return chunksOfCohort(state, cohortIndex).filter((chunk) => {
    if (!chunk.run_id || chunk.abandoned) {
      return false
    }

    const run = chunkRunState(root, chunk.run_id)

    return run === null || !TERMINAL_STATUSES.has(run.status)
  }).length
}

/**
 * Git repository that holds the base branch and every chunk worktree: the one
 * recorded at init from the plan run's workspace, else the configured
 * workspace repository for sessions that predate the field.
 */
export function cohortRepositoryRoot(
  root: string,
  state?: Pick<CohortSessionState, 'repository_root'>,
): string {
  return state?.repository_root ?? workspaceRepositoryRoot(root)
}

/**
 * Branch the session's cohorts merge into and later cohorts branch from.
 *
 * It is the base branch unless the operator retargeted integration, which
 * happens when the checkout that holds the base branch carries unrelated
 * uncommitted work the operator will not commit or stash for a cohort merge.
 */
export function integrationBranch(
  state: Pick<CohortSessionState, 'base_branch' | 'integration_branch'>,
): string {
  return state.integration_branch ?? state.base_branch
}

/**
 * Chunks of one cohort that still need a run.
 *
 * An abandoned chunk is excluded even though it has no run id: the operator
 * recorded its exclusion, so starting it would revive work the operator
 * dropped.
 */
export function unstartedChunksOfCohort(
  state: CohortSessionState,
  cohortIndex: number,
): CohortChunkRecord[] {
  return chunksOfCohort(state, cohortIndex).filter(
    (chunk) => !chunk.run_id && !chunk.abandoned,
  )
}

/**
 * Whether every chunk run of one cohort finished successfully.
 *
 * Read from each run's own durable state rather than from the cohort record,
 * because the run is the authority on its own outcome. An operator-abandoned
 * chunk counts as resolved: exclusion is a recorded operator decision, so it
 * must not block the rest of the plan forever.
 */
export function cohortRunsSucceeded(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): boolean {
  const chunks = chunksOfCohort(state, cohortIndex)

  if (chunks.length === 0) {
    return false
  }

  return chunks.every(
    (chunk) =>
      chunk.abandoned ||
      chunkRunState(root, chunk.run_id)?.status === 'succeeded',
  )
}

/**
 * Whether one cohort is satisfied.
 *
 * Satisfaction needs two independent durable facts: every chunk run of the
 * cohort succeeded, and `integrateCohort` recorded that the chunk branches
 * merged. Succeeded runs alone are not enough, because unmerged chunk branches
 * leave the next cohort branching from work it depends on but cannot see.
 */
export function cohortIsSatisfied(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): boolean {
  return (
    cohortRunsSucceeded(root, state, cohortIndex) &&
    state.satisfaction.some((entry) => entry.cohort_index === cohortIndex)
  )
}

export function cohortIndexes(state: CohortSessionState): number[] {
  return [...state.cohorts]
    .map((group) => group.index)
    .sort((left, right) => left - right)
}

export function firstUnsatisfiedIndex(
  root: string,
  state: CohortSessionState,
): number | null {
  for (const index of cohortIndexes(state)) {
    if (!cohortIsSatisfied(root, state, index)) {
      return index
    }
  }

  return null
}

/**
 * Refuse work on a cohort while an earlier cohort is unsatisfied.
 *
 * The refusal is computed from the two durable records every time, so it cannot
 * be bypassed by advancing a chunk run directly, and it survives a process that
 * died mid-fan-out.
 */
export function assertPredecessorsSatisfied(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): void {
  const pan = panCommand(root)

  for (const index of cohortIndexes(state)) {
    if (index >= cohortIndex) {
      break
    }

    invariant(
      cohortIsSatisfied(root, state, index),
      `Cohort ${cohortIndex} of session ${state.cohort_id} cannot proceed ` +
        `while cohort ${index} is unsatisfied. Finish every chunk run of ` +
        `cohort ${index}, then run '${pan} cohort integrate ` +
        `${state.cohort_id}'.`,
      {
        code: 'COHORT_PREDECESSOR_UNSATISFIED',
        details: {
          cohort_id: state.cohort_id,
          blocked_cohort_index: cohortIndex,
          unsatisfied_predecessor_index: index,
        },
      },
    )
  }
}

/** Refuse a chunk run whose predecessor cohort is unsatisfied. */
export function assertCohortRunUnblocked(root: string, state: RunState): void {
  // The release run follows every cohort, so it has no predecessor to wait on.
  if (!state.cohort || state.cohort.role === 'release') {
    return
  }

  if (!fileExists(cohortStatePath(root, state.cohort.cohort_id))) {
    return
  }

  assertPredecessorsSatisfied(
    root,
    loadCohortState(root, state.cohort.cohort_id),
    state.cohort.cohort_index,
  )
}

export function chunkIdSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')

  invariant(slug.length > 0, `Chunk id has no usable name: ${value}`, {
    code: 'INVALID_COHORT_PLAN',
  })

  return slug
}

export function chunkWorktreeName(cohortId: string, chunkId: string): string {
  return `cohort-${sha256(cohortId).slice(0, 6)}-${chunkIdSlug(chunkId)}`
}

export function requireString(
  value: unknown,
  source: string,
  code = 'INVALID_COHORT_PLAN',
): string {
  invariant(
    typeof value === 'string' && value.trim().length > 0,
    `${source} MUST be a non-empty string.`,
    { code },
  )

  return value as string
}
