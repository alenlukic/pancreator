/**
 * Chunk run queries, cohort satisfaction, and the DAG predecessor checks that
 * start a unit once its own predecessors have merged.
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

/**
 * Loads the run state of one chunk's run. Returns null when the chunk has no
 * run id or its run record does not exist yet.
 */
export function chunkRunState(
  root: string,
  runId: string | undefined,
): RunState | null {
  if (!runId || !fileExists(statePath(root, runId))) {
    return null
  }

  return loadState(root, runId)
}

/**
 * Returns the chunk records that belong to one cohort index of a session, in
 * recorded order, including abandoned chunks.
 */
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
 * Chunk runs that exist and have not reached a terminal state. Pass a cohort
 * index to count one group, or omit it to count the whole session. A chunk
 * whose run record is missing counts as live, because the fan-out that created
 * it may still be writing it.
 */
export function liveChunkRuns(
  root: string,
  state: CohortSessionState,
  cohortIndex?: number,
): number {
  const chunks =
    cohortIndex === undefined
      ? state.chunks
      : chunksOfCohort(state, cohortIndex)

  return chunks.filter((chunk) => {
    if (!chunk.run_id) {
      return false
    }

    const run = chunkRunState(root, chunk.run_id)

    return run === null || !TERMINAL_STATUSES.has(run.status)
  }).length
}

/**
 * Returns the predecessor chunk ids of one unit, from `depends_on` and the
 * session edges, without duplicates.
 */
export function predecessorIds(
  state: CohortSessionState,
  chunkId: string,
): string[] {
  const chunk = state.chunks.find((entry) => entry.id === chunkId)
  const fromDepends = chunk?.depends_on ?? []
  const fromEdges = state.edges
    .filter((edge) => edge.to === chunkId)
    .map((edge) => edge.from)

  return [...new Set([...fromDepends, ...fromEdges])]
}

/**
 * Whether one unit has a merge proof or an operator waiver. A wholly
 * abandoned group requires an explicit no-op proof. A group-level entry (no `chunk`)
 * covers every unit of that group.
 */
export function chunkIsMerged(
  state: CohortSessionState,
  chunk: CohortChunkRecord,
): boolean {
  const proof = state.satisfaction.some(
    (entry) =>
      entry.cohort_index === chunk.cohort_index &&
      (entry.chunk === chunk.id || entry.chunk === undefined),
  )

  // A wholly abandoned group still needs its explicit no-op integration
  // record. Otherwise an all-abandoned session has no final release proof.
  return (
    proof ||
    (Boolean(chunk.abandoned) &&
      chunksOfCohort(state, chunk.cohort_index).some(
        (entry) => !entry.abandoned,
      ))
  )
}

/**
 * Whether every predecessor of one unit has merged. A unit with no
 * predecessors is ready as soon as a slot is free.
 */
export function chunkPredecessorsMerged(
  state: CohortSessionState,
  chunk: CohortChunkRecord,
): boolean {
  return predecessorIds(state, chunk.id).every((id) => {
    const predecessor = state.chunks.find((entry) => entry.id === id)

    return predecessor !== undefined && chunkIsMerged(state, predecessor)
  })
}

/**
 * Unstarted units whose own predecessors have merged, in recorded order.
 * Pass a cohort index to restrict the pool to that group.
 */
export function readyUnstartedChunks(
  state: CohortSessionState,
  cohortIndex?: number,
): CohortChunkRecord[] {
  const pool =
    cohortIndex === undefined
      ? state.chunks
      : chunksOfCohort(state, cohortIndex)

  return pool.filter(
    (chunk) =>
      !chunk.run_id &&
      !chunk.abandoned &&
      !chunkIsMerged(state, chunk) &&
      chunkPredecessorsMerged(state, chunk),
  )
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
 * Chunks that still need a run. Pass a cohort index to restrict the pool.
 *
 * An abandoned chunk is excluded even though it has no run id: the operator
 * recorded its exclusion, so starting it would revive work the operator
 * dropped.
 */
export function unstartedChunksOfCohort(
  state: CohortSessionState,
  cohortIndex?: number,
): CohortChunkRecord[] {
  const pool =
    cohortIndex === undefined
      ? state.chunks
      : chunksOfCohort(state, cohortIndex)

  return pool.filter((chunk) => !chunk.run_id && !chunk.abandoned)
}

/**
 * Units of one group whose run succeeded and that still lack a merge proof.
 */
export function succeededUnmergedChunks(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): CohortChunkRecord[] {
  return chunksOfCohort(state, cohortIndex).filter(
    (chunk) =>
      !chunk.abandoned &&
      !chunkIsMerged(state, chunk) &&
      chunkRunState(root, chunk.run_id)?.status === 'succeeded',
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
 * Whether one cohort group is satisfied.
 *
 * Every unit of the group must have a merge proof (per-chunk or group-level).
 * Succeeded runs alone are not enough, because unmerged chunk branches leave
 * dependents branching from work they cannot see.
 */
export function cohortIsSatisfied(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
): boolean {
  const chunks = chunksOfCohort(state, cohortIndex)

  return (
    cohortRunsSucceeded(root, state, cohortIndex) &&
    chunks.every((chunk) => chunkIsMerged(state, chunk))
  )
}

/**
 * Returns every cohort index of a session in ascending order.
 */
export function cohortIndexes(state: CohortSessionState): number[] {
  return [...state.cohorts]
    .map((group) => group.index)
    .sort((left, right) => left - right)
}

/**
 * Returns the lowest cohort index that is not yet satisfied (every chunk run
 * succeeded and its merge was recorded), or null when every cohort is satisfied
 * and the session is ready for its release run.
 */
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
 * Refuse to start or advance a unit whose own predecessor units have not
 * merged.
 *
 * The refusal is computed from the session edges and merge proofs every time,
 * so it cannot be bypassed by advancing a chunk run directly, and it survives
 * a process that died mid-fan-out. An unrelated unit of the same group does
 * not block this one.
 */
export function assertChunkPredecessorsMerged(
  root: string,
  state: CohortSessionState,
  chunk: CohortChunkRecord,
): void {
  const pan = panCommand(root)
  const blocked = predecessorIds(state, chunk.id).filter((id) => {
    const predecessor = state.chunks.find((entry) => entry.id === id)

    return predecessor === undefined || !chunkIsMerged(state, predecessor)
  })

  invariant(
    blocked.length === 0,
    `Chunk '${chunk.id}' of session ${state.cohort_id} cannot proceed ` +
      `while ${blocked.join(', ')} ` +
      `${blocked.length === 1 ? 'is' : 'are'} unmerged. Finish ` +
      `${blocked.length === 1 ? 'that predecessor' : 'those predecessors'}, ` +
      `then run '${pan} cohort integrate ${state.cohort_id}'.`,
    {
      code: 'COHORT_PREDECESSOR_UNSATISFIED',
      details: {
        cohort_id: state.cohort_id,
        chunk: chunk.id,
        unmerged_predecessors: blocked,
      },
    },
  )
}

/**
 * Refuse work on a cohort group while an earlier group is unsatisfied.
 *
 * Kept for callers that still name a group. DAG scheduling uses
 * `assertChunkPredecessorsMerged` instead, so an unrelated unit of an earlier
 * group does not block a ready dependent.
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

/** Refuse a chunk run whose own predecessor units are unmerged. */
export function assertCohortRunUnblocked(root: string, state: RunState): void {
  // The release run follows every cohort, so it has no predecessor to wait on.
  if (!state.cohort || state.cohort.role === 'release') {
    return
  }

  if (!fileExists(cohortStatePath(root, state.cohort.cohort_id))) {
    return
  }

  const binding = state.cohort

  if (!('chunk' in binding)) {
    return
  }

  const session = loadCohortState(root, binding.cohort_id)
  const chunk = session.chunks.find((entry) => entry.id === binding.chunk)

  if (!chunk) {
    return
  }

  assertChunkPredecessorsMerged(root, session, chunk)
}

/**
 * Lowercases a chunk id and collapses every non-alphanumeric run into a single
 * hyphen. Throws `INVALID_COHORT_PLAN` when nothing usable remains.
 */
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

/**
 * Returns the managed worktree name of one chunk: `cohort-`, a six-character
 * hash of the cohort id, and the chunk id slug. Throws `INVALID_COHORT_PLAN`
 * when the chunk id has no usable slug.
 */
export function chunkWorktreeName(cohortId: string, chunkId: string): string {
  return `cohort-${sha256(cohortId).slice(0, 6)}-${chunkIdSlug(chunkId)}`
}

/**
 * Returns the value when it is a non-blank string and otherwise throws a
 * `PanError` naming `source`, with code `INVALID_COHORT_PLAN` unless the caller
 * supplies another.
 */
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
