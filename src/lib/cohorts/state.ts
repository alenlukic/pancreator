/**
 * Cohort workflow constants, the public result shapes, and the cohort session
 * state file with its mutex-guarded read-modify-write helper.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import type { SupervisorBootstrap } from '../governance/supervisor-card.js'
import {
  fileExists,
  readJson,
  isRecord,
  writeJsonAtomic,
  withOperationMutex,
} from '../io.js'
import { now } from '../state.js'
import type {
  RunStatus,
  CohortChunkRecord,
  CohortSessionState,
} from '../types.js'

/** Workflow whose ratified artifact a cohort fan-out reads. */
export const COHORT_PLAN_WORKFLOW_SLUG = 'planning'
/**
 * Workflow each chunk run executes. It ends at a verified implementation on the
 * chunk branch; release preparation belongs to the integrated result, not to
 * every chunk, so the chunk workflow carries no ship stage.
 */
export const COHORT_CHUNK_WORKFLOW_SLUG = 'delivery-chunk'
/**
 * Workflow a single-chunk plan hands off to, and the workflow of the release
 * run that follows the last cohort. It carries the ship stage the chunk
 * workflow omits.
 */
export const DELIVERY_WORKFLOW_SLUG = 'delivery'
/**
 * Stage the release run starts at. The chunk runs already implemented the
 * work, so the integrated result owes only verification, remediation, and
 * release preparation.
 */
export const RELEASE_RUN_START_STAGE = 'verify'
/** Concurrent chunk runs one cohort session allows unless the operator sets another limit. */
export const DEFAULT_COHORT_MAX_PARALLEL = 4
/** Occasion a cohort supervisor declares in each run's redline record. */
export const COHORT_REDLINE_OCCASION = 'pan-cohort'
export const COHORT_ID_PATTERN =
  /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/u
export const TERMINAL_STATUSES = new Set<RunStatus>([
  'succeeded',
  'failed',
  'canceled',
])

export interface CohortChunkView extends CohortChunkRecord {
  status: RunStatus | 'not_started'
  current_stage: string | null
  resume_command: string | null
}

/** The bootstrap command set of one live chunk run of a session. */
export interface CohortChunkBootstrap extends SupervisorBootstrap {
  chunk: string
  /** Worktree name every lifecycle command of this run carries. */
  worktree: string | null
}

export interface CohortStatusView {
  cohort_id: string
  plan_run_id: string
  parent_spec_path: string
  base_branch: string
  /** Branch cohorts merge into and later cohorts branch from. */
  integration_branch: string
  /** Lowest cohort index that is not satisfied yet, or null when all are. */
  active_cohort_index: number | null
  /** Cohort index whose start is refused, with the predecessor that blocks it. */
  blocked_cohort_index: number | null
  blocking_predecessor_index: number | null
  chunks: CohortChunkView[]
  satisfied_cohort_indexes: number[]
  /** Merge command for the active cohort, or null when it has nothing to merge. */
  integrate_command: string | null
  /**
   * Command that records the satisfaction of an active cohort whose every
   * chunk the operator abandoned. Nothing merges, so the session offers this
   * instead of an integration it cannot perform.
   */
  record_abandoned_cohort_command: string | null
  start_command: string | null
  /** Concurrent chunk runs the session allows. */
  max_parallel: number
  /** Chunk runs of the active cohort that are started and not terminal. */
  live_chunk_runs: number
  /** Operator command that supervises every live chunk run at once, or null when none is live. */
  supervise_command: string | null
  /**
   * Per-run bootstrap command set of every live chunk run of the session, so
   * one read replaces the four commands a supervisor rebuilds for each run.
   */
  bootstrap: CohortChunkBootstrap[]
  /** Release run the last integration started, or null until then. */
  release_run_id: string | null
  release_resume_command: string | null
  /**
   * Command that starts the release run once every cohort is satisfied and no
   * release run is recorded: the merge-free `cohort release`. Null otherwise.
   */
  release_command: string | null
}

export interface CohortStartResult {
  cohort_id: string
  cohort_index: number
  /** Chunks of the cohort left unstarted because the parallelism limit was reached. */
  deferred_chunks: string[]
  max_parallel: number
  /** Operator command that supervises every live chunk run of the cohort at once. */
  supervise_command: string
  chunks: Array<{
    chunk: string
    run_id: string
    worktree: string
    resume_command: string
  }>
}

export interface CohortIntegrationResult {
  cohort_id: string
  cohort_index: number
  base_branch: string
  /** Branch the cohort merged into; `base_branch` unless retargeted. */
  integration_branch: string
  merge_commit: string
  merged_chunks: string[]
  evidence_path: string
  /**
   * Transition the harness took once the merge proof landed: the next cohort
   * for a non-final cohort, the release run for the final one.
   */
  autostart: CohortContinuationResult
}

/** Operator choices that shape a plan route. */
export interface DeliveryRouteOptions {
  /**
   * Existing worktree the single-chunk delivery run occupies, instead of the
   * one the route would derive and create.
   */
  worktreeName?: string
}

/** One run the harness started on the operator's behalf. */
export interface StartedRunHandoff {
  run_id: string
  /** Harness-relative workspace the run is bound to. */
  worktree: string
  resume_command: string
}

/**
 * What approving a ratified plan started. A single-chunk plan starts one
 * `delivery` run; a wider plan starts cohort 1 of a cohort session. `failed`
 * keeps the approval and the plan intact and names the manual commands.
 */
export type DeliveryAutostartResult =
  | ({
      status: 'started' | 'already_started'
      kind: 'cohort'
    } & CohortStartResult)
  | ({
      status: 'started' | 'already_started'
      kind: 'delivery'
    } & StartedRunHandoff)
  | {
      status: 'failed'
      kind?: 'cohort' | 'delivery'
      error: string
      manual_commands: string[]
    }

/**
 * What the completion of one chunk run advanced. `null` from the hook means
 * the group is not finished yet, or a sibling submission already advanced it.
 */
export type CohortAdvanceResult =
  | ({ status: 'integrated' } & CohortIntegrationResult)
  | {
      status: 'failed'
      cohort_id: string
      cohort_index: number
      error: string
      manual_commands: string[]
    }

/** What integrating one cohort started next. */
export type CohortContinuationResult =
  | ({ status: 'started'; kind: 'cohort' } & CohortStartResult)
  | ({
      status: 'started' | 'already_started'
      kind: 'release'
    } & StartedRunHandoff)
  | {
      status: 'failed'
      kind: 'cohort' | 'release'
      error: string
      manual_commands: string[]
    }

/**
 * Returns the session directory `runtime/logs/cohorts/<cohortId>`. Throws
 * `INVALID_COHORT_ID` when the id does not match the cohort id pattern, which
 * keeps a caller-supplied id from escaping the directory.
 */
export function cohortDir(root: string, cohortId: string): string {
  invariant(
    COHORT_ID_PATTERN.test(cohortId),
    `Invalid cohort id: ${cohortId}`,
    {
      code: 'INVALID_COHORT_ID',
    },
  )

  return path.join(root, 'runtime', 'logs', 'cohorts', cohortId)
}

/**
 * Returns the path of one cohort session's `state.json`. Throws
 * `INVALID_COHORT_ID` for a malformed id.
 */
export function cohortStatePath(root: string, cohortId: string): string {
  return path.join(cohortDir(root, cohortId), 'state.json')
}

/** Mutex that serializes every mutating command of one cohort session. */
export function cohortMutexPath(root: string, cohortId: string): string {
  return path.join(cohortDir(root, cohortId), '.operation-mutex')
}

/**
 * Reads and shape-checks one cohort session's state record. Throws
 * `COHORT_NOT_FOUND` when the session has no state file and
 * `INVALID_COHORT_STATE` when the record is not schema version 1 or lacks its
 * chunks, cohorts, or satisfaction arrays.
 */
export function loadCohortState(
  root: string,
  cohortId: string,
): CohortSessionState {
  const filePath = cohortStatePath(root, cohortId)

  invariant(fileExists(filePath), `Unknown cohort session: ${cohortId}`, {
    code: 'COHORT_NOT_FOUND',
  })

  const value = readJson(filePath)

  invariant(
    isRecord(value) && value.schema_version === 1,
    `${cohortId} state MUST be a schema version 1 record.`,
    { code: 'INVALID_COHORT_STATE' },
  )
  invariant(
    Array.isArray(value.chunks) &&
      Array.isArray(value.cohorts) &&
      Array.isArray(value.satisfaction),
    `${cohortId} state MUST record chunks, cohorts, and satisfaction arrays.`,
    { code: 'INVALID_COHORT_STATE' },
  )

  return value as unknown as CohortSessionState
}

/**
 * Stamps `updated_at` and atomically writes the cohort session's state record,
 * returning the record as written. It takes no lock; mutating callers hold the
 * session mutex through `withCohortSession`.
 */
export function persistCohortState(
  root: string,
  state: CohortSessionState,
): CohortSessionState {
  const next = { ...state, updated_at: now() }

  writeJsonAtomic(cohortStatePath(root, state.cohort_id), next)

  return next
}

/**
 * Runs an operation against a freshly loaded cohort session state while holding
 * that session's operation mutex, and returns the operation's result. Throws
 * `COHORT_NOT_FOUND` for an unknown session and `RUN_OPERATION_IN_PROGRESS`
 * when another process holds the mutex.
 */
export function withCohortSession<T>(
  root: string,
  cohortId: string,
  operation: (state: CohortSessionState) => T,
): T {
  invariant(
    fileExists(cohortStatePath(root, cohortId)),
    `Unknown cohort session: ${cohortId}`,
    { code: 'COHORT_NOT_FOUND' },
  )

  return withOperationMutex(cohortMutexPath(root, cohortId), () =>
    operation(loadCohortState(root, cohortId)),
  )
}
