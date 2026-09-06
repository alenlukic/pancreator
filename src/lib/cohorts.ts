import { readdirSync } from 'node:fs'
import path from 'node:path'

import { createRun } from './engine.js'
import { errorMessage, invariant } from './errors.js'
import {
  gitBranchExists,
  gitBranchNameIsValid,
  gitCreateBranch,
  gitCurrentBranch,
  gitConflictedPaths,
  gitHead,
  gitIsAncestor,
  gitMergeAbort,
  gitMergeBranch,
  gitRevParse,
  gitWorktreeIsDirty,
  isGitRepository,
} from './git.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import { keywordRunSuffixFrom } from './naming.js'
import { panCommand } from './project-config.js'
import {
  eventPath,
  listRunStatesWhere,
  loadState,
  makeUniqueRunId,
  now,
  operationMutexPath,
  persist,
  runIsLive,
  statePath,
} from './state.js'
import type {
  CohortChunkRecord,
  CohortDependencyEdge,
  CohortGroupRecord,
  CohortSessionState,
  DeliveryHandoff,
  RunState,
  RunStatus,
} from './types.js'
import {
  createWorktree,
  materializeBranchCheckout,
  reconcileWorktrees,
  removeWorktree,
  resolveRepositoryRoot,
  readWorktreeIndex,
  workspaceRepositoryRoot,
} from './worktrees.js'

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
const COHORT_ID_PATTERN =
  /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/u
const TERMINAL_STATUSES = new Set<RunStatus>([
  'succeeded',
  'failed',
  'canceled',
])

export interface CohortChunkView extends CohortChunkRecord {
  status: RunStatus | 'not_started'
  current_stage: string | null
  resume_command: string | null
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
  integrate_command: string | null
  start_command: string | null
  /** Concurrent chunk runs the session allows. */
  max_parallel: number
  /** Chunk runs of the active cohort that are started and not terminal. */
  live_chunk_runs: number
  /** Operator command that supervises every live chunk run at once, or null when none is live. */
  supervise_command: string | null
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

function cohortStatePath(root: string, cohortId: string): string {
  return path.join(cohortDir(root, cohortId), 'state.json')
}

/** Mutex that serializes every mutating command of one cohort session. */
export function cohortMutexPath(root: string, cohortId: string): string {
  return path.join(cohortDir(root, cohortId), '.operation-mutex')
}

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

function persistCohortState(
  root: string,
  state: CohortSessionState,
): CohortSessionState {
  const next = { ...state, updated_at: now() }

  writeJsonAtomic(cohortStatePath(root, state.cohort_id), next)

  return next
}

function withCohortSession<T>(
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

function chunkRunState(
  root: string,
  runId: string | undefined,
): RunState | null {
  if (!runId || !fileExists(statePath(root, runId))) {
    return null
  }

  return loadState(root, runId)
}

function chunksOfCohort(
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
function liveChunkRuns(
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
function cohortRepositoryRoot(
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
function integrationBranch(
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
function unstartedChunksOfCohort(
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
function cohortRunsSucceeded(
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

function cohortIndexes(state: CohortSessionState): number[] {
  return [...state.cohorts]
    .map((group) => group.index)
    .sort((left, right) => left - right)
}

function firstUnsatisfiedIndex(
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
function assertPredecessorsSatisfied(
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

function chunkIdSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')

  invariant(slug.length > 0, `Chunk id has no usable name: ${value}`, {
    code: 'INVALID_COHORT_PLAN',
  })

  return slug
}

function chunkWorktreeName(cohortId: string, chunkId: string): string {
  return `cohort-${sha256(cohortId).slice(0, 6)}-${chunkIdSlug(chunkId)}`
}

function requireString(
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

interface ParsedCohortPlan {
  parent_spec_path: string
  chunks: CohortChunkRecord[]
  edges: CohortDependencyEdge[]
  cohorts: CohortGroupRecord[]
}

/**
 * Read the cohort plan out of a ratified planning stage output.
 *
 * Shape is checked here rather than trusted, because the fan-out creates
 * worktrees and runs from these values. Graph and traceability rules stay with
 * the planning-stage validator, which reports them while the plan can still be
 * corrected.
 */
export function parseCohortPlan(
  value: unknown,
  source: string,
): ParsedCohortPlan {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_COHORT_PLAN',
  })

  const parentSpecPath = requireString(
    value.parent_spec_path,
    `${source}.parent_spec_path`,
  )

  invariant(
    Array.isArray(value.chunks) && value.chunks.length > 0,
    `${source}.chunks MUST list at least one chunk.`,
    { code: 'INVALID_COHORT_PLAN' },
  )
  invariant(
    Array.isArray(value.cohorts) && value.cohorts.length > 0,
    `${source}.cohorts MUST list at least one cohort.`,
    { code: 'INVALID_COHORT_PLAN' },
  )

  const chunks = value.chunks.map((chunk, index) => {
    const chunkSource = `${source}.chunks[${index}]`

    invariant(isRecord(chunk), `${chunkSource} MUST be an object.`, {
      code: 'INVALID_COHORT_PLAN',
    })

    const cohortIndex = chunk.cohort_index

    invariant(
      Number.isInteger(cohortIndex) && Number(cohortIndex) >= 1,
      `${chunkSource}.cohort_index MUST be an integer of at least 1.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    const dependsOn = chunk.depends_on ?? []

    invariant(
      Array.isArray(dependsOn) &&
        dependsOn.every((item) => typeof item === 'string'),
      `${chunkSource}.depends_on MUST be an array of chunk ids.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    return {
      id: requireString(chunk.id, `${chunkSource}.id`),
      title:
        typeof chunk.title === 'string' && chunk.title.trim().length > 0
          ? chunk.title
          : requireString(chunk.id, `${chunkSource}.id`),
      cohort_index: Number(cohortIndex),
      child_spec_path: requireString(
        chunk.child_spec_path,
        `${chunkSource}.child_spec_path`,
      ),
      depends_on: dependsOn as string[],
    }
  })

  const edges = (Array.isArray(value.edges) ? value.edges : []).map(
    (edge, index) => {
      const edgeSource = `${source}.edges[${index}]`

      invariant(isRecord(edge), `${edgeSource} MUST be an object.`, {
        code: 'INVALID_COHORT_PLAN',
      })

      return {
        from: requireString(edge.from, `${edgeSource}.from`),
        to: requireString(edge.to, `${edgeSource}.to`),
      }
    },
  )

  const cohorts = value.cohorts.map((group, index) => {
    const groupSource = `${source}.cohorts[${index}]`

    invariant(isRecord(group), `${groupSource} MUST be an object.`, {
      code: 'INVALID_COHORT_PLAN',
    })
    invariant(
      Number.isInteger(group.index) && Number(group.index) >= 1,
      `${groupSource}.index MUST be an integer of at least 1.`,
      { code: 'INVALID_COHORT_PLAN' },
    )
    invariant(
      Array.isArray(group.chunks) &&
        group.chunks.every((item) => typeof item === 'string'),
      `${groupSource}.chunks MUST be an array of chunk ids.`,
      { code: 'INVALID_COHORT_PLAN' },
    )
    // An empty cohort has no chunk run that could ever succeed, so it would
    // stay unsatisfied forever and block every cohort after it.
    invariant(
      group.chunks.length > 0,
      `${groupSource}.chunks MUST list at least one chunk id.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    return { index: Number(group.index), chunks: group.chunks as string[] }
  })

  // The two views of membership must agree, because the fan-out iterates
  // `cohorts` while satisfaction reads `chunks[].cohort_index`.
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]))

  for (const group of cohorts) {
    for (const chunkId of group.chunks) {
      const chunk = chunkById.get(chunkId)

      invariant(
        chunk && chunk.cohort_index === group.index,
        `${source}.cohorts[index ${group.index}] names chunk '${chunkId}', ` +
          `which ${chunk ? `claims cohort ${chunk.cohort_index}` : 'the plan does not declare'}.`,
        { code: 'INVALID_COHORT_PLAN' },
      )
    }
  }

  return { parent_spec_path: parentSpecPath, chunks, edges, cohorts }
}

function ratifiedPlanOutputPath(root: string, planRunId: string): string {
  const state = loadState(root, planRunId)

  invariant(
    state.workflow_slug === COHORT_PLAN_WORKFLOW_SLUG,
    `Run ${planRunId} runs workflow '${state.workflow_slug}', not ` +
      `'${COHORT_PLAN_WORKFLOW_SLUG}', so it holds no cohort plan.`,
    { code: 'COHORT_PLAN_RUN_INVALID' },
  )

  const ratified = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === 'plan' && item.outcome === 'success')

  invariant(
    ratified,
    `Run ${planRunId} has no successful plan stage, so its cohort plan is ` +
      'not ratified yet.',
    { code: 'COHORT_PLAN_NOT_RATIFIED' },
  )

  return ratified.output_path
}

/** Cohort plan recorded by a ratified planning run. */
export function readRatifiedCohortPlan(
  root: string,
  planRunId: string,
): ParsedCohortPlan {
  const outputPath = ratifiedPlanOutputPath(root, planRunId)
  const output = readJson(resolveInside(root, outputPath))

  invariant(
    isRecord(output) && isRecord(output.data),
    `${outputPath} MUST contain a stage output with a data object.`,
    { code: 'INVALID_COHORT_PLAN' },
  )

  return parseCohortPlan(
    output.data.cohort_plan,
    `${outputPath} data.cohort_plan`,
  )
}

export interface InitCohortOptions {
  planRunId: string
  /** Branch every chunk worktree starts from and integrates back into. */
  from?: string | null
  /** Concurrent chunk runs the session allows; defaults to four. */
  maxParallel?: number | null
}

/**
 * Open one cohort session against a ratified planning run.
 *
 * Nothing is created here beyond the record: worktrees and runs belong to
 * `startCohort`, so an operator can inspect the carve-up before any workspace
 * exists.
 */
export function initCohortSession(
  root: string,
  options: InitCohortOptions,
): CohortSessionState {
  // The repository is the plan run's workspace, not the harness's: an embedded
  // or detached installation fans out worktrees of the target repository, and
  // a plan run started against another workspace (an eval fixture, an explicit
  // --workspace) fans out into that repository.
  const planState = loadState(root, options.planRunId)
  const planWorkspace = path.resolve(root, planState.workspace_root || '.')
  const existing = cohortSessionForPlanRun(root, options.planRunId)
  const pan = panCommand(root)

  // One plan fans out once. A second session would create a second set of
  // worktrees and runs for the same chunks, so the existing session is named
  // together with the command that continues it.
  invariant(
    !existing,
    `Plan run ${options.planRunId} already opened cohort session ` +
      `${existing?.cohort_id}. Continue it with '${pan} cohort start ` +
      `${existing?.cohort_id}'.`,
    {
      code: 'COHORT_SESSION_EXISTS',
      details: { cohort_id: existing?.cohort_id },
    },
  )
  invariant(
    isGitRepository(planWorkspace),
    `Cohort fan-out requires a Git repository workspace; the plan run's ` +
      `workspace ${planWorkspace} is not one, because each chunk runs in a ` +
      'worktree.',
    { code: 'COHORT_REQUIRES_GIT' },
  )

  const repositoryRoot = resolveRepositoryRoot(planWorkspace)
  const maxParallel = options.maxParallel ?? DEFAULT_COHORT_MAX_PARALLEL

  invariant(
    Number.isInteger(maxParallel) && maxParallel >= 1,
    '--max-parallel MUST be an integer of at least 1.',
    { code: 'INVALID_ARGUMENT' },
  )

  const plan = readRatifiedCohortPlan(root, options.planRunId)
  const baseBranch = options.from?.trim() || gitCurrentBranch(repositoryRoot)

  invariant(
    baseBranch,
    'Cohort fan-out requires a named base branch. The workspace is on a ' +
      'detached HEAD, so pass --from <branch>.',
    { code: 'COHORT_BASE_BRANCH_REQUIRED' },
  )

  invariant(
    fileExists(resolveInside(root, plan.parent_spec_path)),
    `Parent specification does not exist: ${plan.parent_spec_path}`,
    { code: 'COHORT_PARENT_SPEC_NOT_FOUND' },
  )

  for (const chunk of plan.chunks) {
    invariant(
      fileExists(resolveInside(root, chunk.child_spec_path)),
      `Child specification for chunk '${chunk.id}' does not exist: ` +
        chunk.child_spec_path,
      { code: 'COHORT_CHILD_SPEC_NOT_FOUND' },
    )
  }

  const base = path.join(root, 'runtime', 'logs', 'cohorts')
  // The parent specification is always named parent-specification.md, so its
  // basename would give every cohort the same suffix. The plan run's own
  // suffix names the request; the specification text is the fallback.
  const planRunSuffix = options.planRunId.split('_').slice(2).join('_')
  const cohortId = makeUniqueRunId(
    base,
    keywordRunSuffixFrom(
      planRunSuffix || path.basename(plan.parent_spec_path),
      readText(resolveInside(root, plan.parent_spec_path)),
    ),
  )

  ensureDir(cohortDir(root, cohortId))

  const session = persistCohortState(root, {
    schema_version: 1,
    cohort_id: cohortId,
    plan_run_id: options.planRunId,
    parent_spec_path: plan.parent_spec_path,
    base_branch: baseBranch,
    repository_root: repositoryRoot,
    max_parallel: maxParallel,
    created_at: now(),
    updated_at: now(),
    chunks: plan.chunks,
    edges: plan.edges,
    cohorts: plan.cohorts,
    satisfaction: [],
  })

  // The plan run names where its plan went, whether the approval hook or the
  // operator opened the session. This replaces a `failed` route record, so a
  // manual init after a failed route also clears the failure.
  recordDeliveryHandoff(root, planState, {
    kind: 'cohort',
    cohort_id: session.cohort_id,
    recorded_at: now(),
  })

  return session
}

export interface StartCohortOptions {
  /**
   * Cohort to start instead of the next unsatisfied one. The predecessor
   * ordering still applies, so naming a later cohort is refused with
   * `COHORT_PREDECESSOR_UNSATISFIED` rather than started early.
   */
  cohortIndex?: number
}

/**
 * Create one worktree and one `delivery-chunk` run per chunk of the next
 * unsatisfied cohort, or of the cohort the operator names.
 *
 * This performs no source-control action beyond adding worktrees: committing a
 * chunk branch and integrating a finished cohort stay operator-owned. Each
 * chunk record is written before its worktree exists and again after its run
 * exists, so an interrupted fan-out leaves resources the lifecycle commands can
 * still find.
 */
export function startCohort(
  root: string,
  cohortId: string,
  options: StartCohortOptions = {},
): CohortStartResult {
  return withCohortSession(root, cohortId, (loaded) => {
    const cohortIndex =
      options.cohortIndex ?? firstUnsatisfiedIndex(root, loaded)

    invariant(
      cohortIndex !== null,
      `Every cohort of session ${cohortId} is satisfied, so there is nothing ` +
        'left to start.',
      { code: 'COHORT_COMPLETE' },
    )
    invariant(
      cohortIndexes(loaded).includes(cohortIndex),
      `Session ${cohortId} declares no cohort ${cohortIndex}. Declared ` +
        `cohorts: ${cohortIndexes(loaded).join(', ')}.`,
      { code: 'COHORT_NOT_FOUND' },
    )

    assertPredecessorsSatisfied(root, loaded, cohortIndex)

    const pan = panCommand(root)
    const unstarted = unstartedChunksOfCohort(loaded, cohortIndex)

    invariant(
      unstarted.length > 0,
      `Cohort ${cohortIndex} of session ${cohortId} has no chunk left to ` +
        'start: every chunk is already running or abandoned. Finish the ' +
        `running chunk runs, then run '${pan} cohort integrate ` +
        `${cohortId}'.`,
      { code: 'COHORT_ALREADY_STARTED' },
    )

    // The limit bounds concurrent chunk runs, not cohort size. A wide cohort
    // starts in batches: each call fills the slots that terminal runs freed,
    // so the same command both starts a cohort and tops it up.
    const maxParallel = cohortMaxParallel(loaded)
    const live = liveChunkRuns(root, loaded, cohortIndex)
    const slots = Math.max(0, maxParallel - live)

    invariant(
      slots > 0,
      `Cohort ${cohortIndex} of session ${cohortId} already has ${live} live ` +
        `chunk run(s), the session's parallelism limit (${maxParallel}). ` +
        `${unstarted.length} chunk(s) wait for a slot: ` +
        `${unstarted.map((chunk) => chunk.id).join(', ')}. Finish or abandon a ` +
        `live chunk, then run '${pan} cohort start ${cohortId}' again.`,
      {
        code: 'COHORT_PARALLELISM_LIMIT',
        details: {
          cohort_index: cohortIndex,
          live_chunk_runs: live,
          max_parallel: maxParallel,
          waiting_chunks: unstarted.map((chunk) => chunk.id),
        },
      },
    )

    const pending = unstarted.slice(0, slots)
    const deferred = unstarted.slice(slots).map((chunk) => chunk.id)

    let state = loaded
    const started: CohortStartResult['chunks'] = []

    for (const chunk of pending) {
      const worktreeName = chunkWorktreeName(cohortId, chunk.id)

      state = updateChunk(root, state, chunk.id, { worktree: worktreeName })

      // The worktree name derives from the session and the chunk, so a retry
      // after a crash between worktree creation and the run record finds the
      // worktree it already made instead of refusing a second one, and a
      // retry after a crash between run creation and the run_id write adopts
      // the live run bound to that worktree instead of binding a second run
      // to the same checkout.
      const record =
        readWorktreeIndex(root).worktrees.find(
          (entry) => entry.name === worktreeName,
        ) ??
        createWorktree(root, worktreeName, {
          from: integrationBranch(state),
          description: `Cohort ${cohortIndex} chunk '${chunk.id}'`,
          repositoryRoot: cohortRepositoryRoot(root, state),
        })

      state = updateChunk(root, state, chunk.id, {
        worktree: worktreeName,
        branch: record.branch,
      })

      // The run is bound to its worktree exactly as `pan init --worktree`
      // binds one, so `--worktree <name>` is accepted on every lifecycle
      // command and the identity check guards against a swapped checkout.
      const run =
        existingChunkRun(root, cohortId, chunk.id, record.path) ??
        createRun(root, {
          workflowSlug: COHORT_CHUNK_WORKFLOW_SLUG,
          requestPath: chunk.child_spec_path,
          title: `${chunk.id} · ${chunk.title}`,
          workspace: record.path,
          worktree: {
            name: record.name,
            path: record.path,
            branch: record.branch,
          },
          contextReferencePath: state.parent_spec_path,
          cohort: {
            cohort_id: cohortId,
            cohort_index: cohortIndex,
            chunk: chunk.id,
          },
        })

      state = updateChunk(root, state, chunk.id, { run_id: run.run_id })
      started.push({
        chunk: chunk.id,
        run_id: run.run_id,
        worktree: record.path,
        resume_command: `/pan-resume ${run.run_id}`,
      })
    }

    return {
      cohort_id: cohortId,
      cohort_index: cohortIndex,
      deferred_chunks: deferred,
      max_parallel: maxParallel,
      supervise_command: `/pan-cohort ${cohortId}`,
      chunks: started,
    }
  })
}

/**
 * The live chunk run an earlier fan-out attempt created for one chunk: a
 * chunk-workflow run whose cohort binding names the session and the chunk and
 * that works in the chunk's worktree. Two live runs on one worktree would edit
 * the same checkout, so a matching live run is adopted rather than duplicated.
 * A finished run is not: it no longer occupies the worktree.
 */
function existingChunkRun(
  root: string,
  cohortId: string,
  chunkId: string,
  worktreePath: string,
): RunState | null {
  const workspace = path.resolve(root, worktreePath)
  const matches = (run: RunState): boolean =>
    run.workflow_slug === COHORT_CHUNK_WORKFLOW_SLUG &&
    run.cohort !== undefined &&
    run.cohort.role !== 'release' &&
    run.cohort.cohort_id === cohortId &&
    run.cohort.chunk === chunkId &&
    path.resolve(root, run.workspace_root) === workspace

  return (
    newestRun(
      listRunStatesWhere(root, matches).filter(
        (run) => runIsLive(run) && matches(run),
      ),
    ) ?? null
  )
}

/** The caller holds the session mutex. */
function updateChunk(
  root: string,
  state: CohortSessionState,
  chunkId: string,
  patch: Partial<CohortChunkRecord>,
): CohortSessionState {
  return persistCohortState(root, {
    ...state,
    chunks: state.chunks.map((chunk) =>
      chunk.id === chunkId ? { ...chunk, ...patch } : chunk,
    ),
  })
}

export function cohortStatus(root: string, cohortId: string): CohortStatusView {
  const state = loadCohortState(root, cohortId)
  const activeIndex = firstUnsatisfiedIndex(root, state)
  const blockedIndex =
    activeIndex === null
      ? null
      : (cohortIndexes(state).find(
          (index) =>
            index > activeIndex && chunksOfCohort(state, index).length > 0,
        ) ?? null)
  const chunks = state.chunks.map((chunk) => {
    const run = chunkRunState(root, chunk.run_id)

    return {
      ...chunk,
      status: chunk.run_id
        ? (run?.status ?? 'failed')
        : ('not_started' as const),
      current_stage: run?.current_stage ?? null,
      resume_command: chunk.run_id ? `/pan-resume ${chunk.run_id}` : null,
    }
  })
  const readyToIntegrate =
    activeIndex !== null &&
    cohortRunsSucceeded(root, state, activeIndex) &&
    !state.satisfaction.some((entry) => entry.cohort_index === activeIndex)
  const maxParallel = cohortMaxParallel(state)
  const live =
    activeIndex === null ? 0 : liveChunkRuns(root, state, activeIndex)

  const pan = panCommand(root)

  return {
    cohort_id: cohortId,
    plan_run_id: state.plan_run_id,
    parent_spec_path: state.parent_spec_path,
    base_branch: state.base_branch,
    integration_branch: integrationBranch(state),
    active_cohort_index: activeIndex,
    blocked_cohort_index: blockedIndex,
    blocking_predecessor_index: blockedIndex === null ? null : activeIndex,
    chunks,
    satisfied_cohort_indexes: cohortIndexes(state).filter((index) =>
      cohortIsSatisfied(root, state, index),
    ),
    integrate_command: readyToIntegrate
      ? `${pan} cohort integrate ${cohortId}`
      : null,
    start_command:
      activeIndex !== null &&
      unstartedChunksOfCohort(state, activeIndex).length > 0 &&
      live < maxParallel
        ? `${pan} cohort start ${cohortId}`
        : null,
    max_parallel: maxParallel,
    live_chunk_runs: live,
    supervise_command: live > 0 ? `/pan-cohort ${cohortId}` : null,
    release_run_id: state.release_run_id ?? null,
    release_resume_command: state.release_run_id
      ? `/pan-resume ${state.release_run_id}`
      : null,
    release_command:
      activeIndex === null && !state.release_run_id
        ? `${pan} cohort release ${cohortId}`
        : null,
  }
}

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
 * Merge the committed chunk branches of the active cohort into the base branch
 * and record the satisfaction entry.
 *
 * The satisfaction entry is the only signal that unblocks the next cohort, and
 * it is written only after a clean merge. An unsucceeded chunk run, a dirty
 * chunk worktree, or a conflict therefore leaves the next cohort blocked rather
 * than letting it branch from work that never landed. A cohort whose every
 * chunk the operator abandoned has nothing to merge and is recorded satisfied.
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
  const integrated = integrateActiveCohort(root, cohortId, options)

  return {
    ...integrated,
    autostart: continueAfterIntegration(root, cohortId),
  }
}

type IntegratedCohort = Omit<CohortIntegrationResult, 'autostart'>

function integrateActiveCohort(
  root: string,
  cohortId: string,
  options: { intoBranch?: string | null },
): IntegratedCohort {
  return withCohortSession(root, cohortId, (initial) => {
    const loaded = options.intoBranch
      ? retargetIntegration(root, initial, options.intoBranch)
      : initial
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

    assertPredecessorsSatisfied(root, loaded, cohortIndex)

    const chunks = chunksOfCohort(loaded, cohortIndex).filter(
      (chunk) => !chunk.abandoned,
    )

    if (chunks.length === 0) {
      return recordAbandonedCohort(root, loaded, cohortIndex)
    }

    const index = readWorktreeIndex(root)
    const pan = panCommand(root)

    for (const chunk of chunks) {
      const run = chunkRunState(root, chunk.run_id)

      invariant(
        run?.status === 'succeeded',
        `Chunk '${chunk.id}' run '${chunk.run_id ?? '(not started)'}' reports ` +
          `'${run?.status ?? 'not_started'}', not 'succeeded', so cohort ` +
          `${cohortIndex} cannot be integrated.`,
        {
          code: 'COHORT_INTEGRATION_INCOMPLETE',
          details: { chunk: chunk.id, status: run?.status ?? 'not_started' },
        },
      )

      const record = index.worktrees.find(
        (entry) => entry.name === chunk.worktree,
      )

      invariant(
        record,
        `Chunk '${chunk.id}' has no recorded worktree, so there is nothing to ` +
          'merge.',
        { code: 'COHORT_INTEGRATION_INCOMPLETE', details: { chunk: chunk.id } },
      )
      invariant(
        !gitWorktreeIsDirty(resolveInside(root, record.path)),
        `Chunk '${chunk.id}' has uncommitted work in ${record.path}. Commit ` +
          `it, then run '${pan} cohort integrate ${cohortId}' again.`,
        { code: 'COHORT_INTEGRATION_INCOMPLETE', details: { chunk: chunk.id } },
      )
    }

    const merged =
      chunks.length >= 2
        ? mergeThroughReconcile(root, loaded, cohortIndex, chunks)
        : mergeSingleChunkBranch(root, loaded, cohortIndex, chunks[0])

    persistCohortState(root, {
      ...loaded,
      satisfaction: [
        ...loaded.satisfaction,
        {
          cohort_index: cohortIndex,
          recorded_at: now(),
          base_branch: loaded.base_branch,
          integration_branch: integrationBranch(loaded),
          merge_commit: merged.merge_commit,
          evidence_path: merged.evidence_path,
        },
      ],
    })

    return {
      cohort_id: cohortId,
      cohort_index: cohortIndex,
      base_branch: loaded.base_branch,
      integration_branch: integrationBranch(loaded),
      merge_commit: merged.merge_commit,
      merged_chunks: chunks.map((chunk) => chunk.id),
      evidence_path: merged.evidence_path,
    }
  })
}

/**
 * The recorded merge proof of the last cohort that landed. The satisfaction
 * entry is the proof itself, so the report is rebuilt from it rather than from
 * a second merge.
 */
function lastIntegratedCohort(state: CohortSessionState): IntegratedCohort {
  const last = [...state.satisfaction].sort(
    (left, right) => right.cohort_index - left.cohort_index,
  )[0]

  invariant(last, `Session ${state.cohort_id} records no integrated cohort.`, {
    code: 'INVALID_COHORT_STATE',
  })

  return {
    cohort_id: state.cohort_id,
    cohort_index: last.cohort_index,
    base_branch: last.base_branch,
    integration_branch: last.integration_branch ?? integrationBranch(state),
    merge_commit: last.merge_commit,
    merged_chunks: chunksOfCohort(state, last.cohort_index)
      .filter((chunk) => !chunk.abandoned)
      .map((chunk) => chunk.id),
    evidence_path: last.evidence_path,
  }
}

interface MergeOutcome {
  merge_commit: string
  evidence_path: string
}

function integrationRecordPath(cohortId: string, cohortIndex: number): string {
  return `runtime/logs/cohorts/${cohortId}/integration-${cohortIndex}.json`
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
    abandoned?: Array<{ chunk: string; note: string; recorded_at: string }>
    base_commit_before_merge: string
    merge_commit: string
    reconcile_evidence_path?: string
  },
): string {
  const repositoryRoot = cohortRepositoryRoot(root, state)
  const evidencePath = integrationRecordPath(state.cohort_id, cohortIndex)

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
  )

  if (result.status === 'conflict') {
    const landed = result.merged_sources.map(chunkOfWorktree)
    const conflicted = chunkOfWorktree(result.conflicted_source ?? '')
    const recordPath = incompleteIntegrationPath(state.cohort_id, cohortIndex)

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
      base_commit_before_merge: baseBefore,
      merge_commit: mergeCommit,
      reconcile_evidence_path: result.evidence_path,
    }),
  }
}

function incompleteIntegrationPath(
  cohortId: string,
  cohortIndex: number,
): string {
  return `runtime/logs/cohorts/${cohortId}/integration-${cohortIndex}-incomplete.json`
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

  invariant(
    !gitWorktreeIsDirty(checkout),
    `The checkout that holds '${target}' has uncommitted work. Commit or ` +
      'stash it, or integrate again with --into-branch <branch> to merge ' +
      'into a dedicated integration branch.',
    { code: 'COHORT_INTEGRATION_INCOMPLETE' },
  )

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
      base_commit_before_merge: baseBefore,
      merge_commit: mergeCommit,
    }),
  }
}

/**
 * Record an operator-directed exclusion of one chunk.
 *
 * Exclusion is operator-owned, so the note is required evidence. An abandoned
 * chunk stops blocking its cohort, which is exactly why nobody but the operator
 * may record one.
 */
export function abandonChunk(
  root: string,
  cohortId: string,
  chunkId: string,
  note: string,
): CohortSessionState {
  invariant(note.trim().length > 0, '--note is required to abandon a chunk.', {
    code: 'INVALID_ARGUMENT',
  })

  return withCohortSession(root, cohortId, (state) => {
    invariant(
      state.chunks.some((chunk) => chunk.id === chunkId),
      `Cohort session ${cohortId} has no chunk '${chunkId}'.`,
      { code: 'COHORT_CHUNK_NOT_FOUND' },
    )

    return updateChunk(root, state, chunkId, {
      abandoned: { note, recorded_at: now() },
    })
  })
}

export interface CleanCohortResult {
  cohort_id: string
  removed_worktrees: string[]
}

/**
 * Remove the chunk worktrees of one cohort session.
 *
 * Chunk work is committed on its own branch, and branch deletion stays
 * operator-owned, so removal keeps every branch. A live or dirty chunk is
 * refused unless the operator forces it. Every chunk is checked before any
 * worktree is removed, so a refusal on one chunk leaves the session intact
 * rather than half-cleaned.
 */
export function cleanCohortSession(
  root: string,
  cohortId: string,
  options: { force?: boolean } = {},
): CleanCohortResult {
  return withCohortSession(root, cohortId, (state) => {
    const index = readWorktreeIndex(root)
    const removable: string[] = []

    for (const chunk of state.chunks) {
      const record = index.worktrees.find(
        (entry) => entry.name === chunk.worktree,
      )

      if (!record) {
        continue
      }

      const run = chunkRunState(root, chunk.run_id)

      invariant(
        options.force || !run || TERMINAL_STATUSES.has(run.status),
        `WARNING: chunk '${chunk.id}' run '${chunk.run_id}' is still ` +
          `'${run?.status}'. Cleaning now removes its workspace mid-run. ` +
          'Finish or abort the run first, or pass --force to discard it.',
        { code: 'COHORT_RUN_ACTIVE' },
      )
      invariant(
        options.force || !gitWorktreeIsDirty(resolveInside(root, record.path)),
        `WARNING: chunk '${chunk.id}' has uncommitted work in ` +
          `${record.path}. Removing it discards that work. Pass --force to ` +
          'remove it anyway.',
        { code: 'COHORT_WORKTREE_DIRTY' },
      )

      removable.push(record.name)
    }

    for (const name of removable) {
      removeWorktree(root, name, { force: options.force ?? false })
    }

    return { cohort_id: cohortId, removed_worktrees: removable.sort() }
  })
}

export function cohortSessionIds(root: string): string[] {
  const directory = path.join(root, 'runtime', 'logs', 'cohorts')

  if (!fileExists(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && COHORT_ID_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
}

/** Cohort session a planning run already opened, when one exists. */
export function cohortSessionForPlanRun(
  root: string,
  planRunId: string,
): CohortSessionState | null {
  for (const cohortId of cohortSessionIds(root)) {
    try {
      const state = loadCohortState(root, cohortId)

      if (state.plan_run_id === planRunId) {
        return state
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Route a ratified plan into delivery when its gate is approved.
 *
 * The plan gate is the routing point and the harness owns the route: exactly
 * one chunk starts one `delivery` run bound to a fresh worktree, and two or
 * more chunks open a cohort session and start cohort 1. The approval that
 * triggers it may come from the operator or from away mode acting on the
 * operator's behalf, because the routing is a recorded property of the run,
 * not a judgment made at approval time.
 *
 * `autostart_delivery` is recorded on every planning run since routing became
 * the default; `autostart_cohort` is the flag older runs recorded when only
 * the cohort fan-out was automatic. `false` on either is the operator's
 * opt-out and starts nothing. A run that recorded neither predates routing:
 * silence there would leave the operator believing something started, so the
 * hook reports a failed route whose one manual command is the retry, which
 * reads the operator's invocation as the opt-in.
 *
 * The hook runs after the decision is durable and never rewrites it. A second
 * approval finds the handoff already recorded and reports `already_started`,
 * because nothing failed. A failure reports the concrete error with the
 * manual command, because the approval and the ratified plan remain valid
 * whatever happened to the route. Every path here adds only worktrees,
 * branches, and run records, the actions `AWAY-001` and `COHORT-001` permit
 * for an autostart.
 */
export function maybeStartDelivery(
  root: string,
  state: RunState,
  decision: { actor: 'operator' | 'away'; action: string },
): DeliveryAutostartResult | null {
  if (
    decision.action !== 'approve' ||
    state.workflow_slug !== COHORT_PLAN_WORKFLOW_SLUG ||
    state.status !== 'succeeded'
  ) {
    return null
  }

  const requested = state.autostart_delivery ?? state.autostart_cohort

  if (requested === false) {
    return null
  }

  if (requested === undefined) {
    const failed = {
      status: 'failed' as const,
      error:
        'This planning run predates routing and recorded no opt-in or opt-out.',
      manual_commands: [routeRetryCommand(root, state.run_id)],
    }

    recordFailedDeliveryRoute(root, state, failed)

    return failed
  }

  return routeDelivery(root, state)
}

/**
 * Route the approved plan of a succeeded planning run again, by operator
 * command.
 *
 * The approval hook fires once, from the gate decision, so a route that
 * failed there has no second trigger: the decision is durable and cannot be
 * repeated. This is that trigger. It takes the same path the hook takes, so a
 * run or session an earlier attempt already created is adopted rather than
 * duplicated, and a successful route replaces the `failed` handoff record.
 * The operator's invocation stands in for the opt-in a run created before
 * routing never recorded.
 */
export function retryDeliveryRoute(
  root: string,
  planRunId: string,
): DeliveryAutostartResult {
  const state = loadState(root, planRunId)

  invariant(
    state.workflow_slug === COHORT_PLAN_WORKFLOW_SLUG,
    `Run ${planRunId} runs workflow '${state.workflow_slug}', not ` +
      `'${COHORT_PLAN_WORKFLOW_SLUG}', so it holds no plan to route.`,
    { code: 'COHORT_PLAN_RUN_INVALID' },
  )
  invariant(
    state.status === 'succeeded',
    `Run ${planRunId} is '${state.status}', not 'succeeded', so its plan ` +
      'gate has not approved a plan to route.',
    { code: 'COHORT_PLAN_RUN_NOT_SUCCEEDED' },
  )

  const decision = planGateDecision(root, planRunId)

  // A succeeded planning run whose plan gate recorded a decision reached that
  // status through an approval. A run with no decision event closed through a
  // waived or disabled gate, and its ratified plan stage is the record then.
  invariant(
    decision === null || decision === 'approve',
    `The recorded decision on the plan gate of run ${planRunId} is ` +
      `'${decision}', not 'approve', so its plan is not routed.`,
    { code: 'COHORT_PLAN_REJECTED' },
  )

  return routeDelivery(root, state)
}

/**
 * The last gate decision recorded on the `plan` stage of a run, read from the
 * decision events its log carries. Null when the log holds none.
 */
function planGateDecision(root: string, runId: string): string | null {
  const eventsFile = eventPath(root, runId)

  if (!fileExists(eventsFile)) {
    return null
  }

  let decision: string | null = null

  for (const line of readText(eventsFile).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let event: unknown

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      isRecord(event) &&
      (event.type === 'operator_decision_recorded' ||
        event.type === 'away_decision_applied') &&
      event.stage === 'plan' &&
      typeof event.decision === 'string'
    ) {
      decision = event.decision
    }
  }

  return decision
}

/**
 * The route itself: one `delivery` run for a single chunk, cohort 1 of a
 * cohort session for a wider plan. Shared by the approval hook and the
 * operator retry, so both adopt what an earlier attempt created.
 */
function routeDelivery(root: string, state: RunState): DeliveryAutostartResult {
  let kind: 'cohort' | 'delivery' | undefined

  try {
    const plan = readRatifiedCohortPlan(root, state.run_id)

    if (plan.chunks.length === 1) {
      kind = 'delivery'

      return startSingleDeliveryRun(root, state, plan)
    }

    kind = 'cohort'

    const existing = cohortSessionForPlanRun(root, state.run_id)

    if (existing) {
      recordDeliveryHandoff(root, state, {
        kind: 'cohort',
        cohort_id: existing.cohort_id,
        recorded_at: now(),
      })

      const started = startedChunksOfFirstCohort(root, existing)

      if (started) {
        return { status: 'already_started', kind, ...started }
      }
    }

    // Init records the cohort handoff on the plan run itself.
    const session =
      existing ??
      initCohortSession(root, {
        planRunId: state.run_id,
        maxParallel: state.autostart_max_parallel ?? null,
      })

    return { status: 'started', kind, ...startCohort(root, session.cohort_id) }
  } catch (error) {
    const failed = {
      status: 'failed' as const,
      ...(kind ? { kind } : {}),
      error: errorMessage(error),
      // The retry adopts whatever exists at failure time: a session init
      // already opened is continued, a run already created is adopted.
      manual_commands: [routeRetryCommand(root, state.run_id)],
    }

    recordFailedDeliveryRoute(root, state, failed)

    return failed
  }
}

/** The one command that completes a failed route by hand. */
function routeRetryCommand(root: string, planRunId: string): string {
  return `${panCommand(root)} cohort route --plan-run ${planRunId}`
}

function deliveryWorktreeName(planRunId: string, chunkId: string): string {
  return `delivery-${sha256(planRunId).slice(0, 6)}-${chunkIdSlug(chunkId)}`
}

/**
 * Record on the planning run where its ratified plan went, so `pan status`
 * on the plan run names the handoff. The plan run is closed, so this is a
 * bookkeeping event on a finished run rather than a workflow transition, and
 * it is skipped when the same handoff is already recorded.
 */
function recordDeliveryHandoff(
  root: string,
  planState: RunState,
  handoff: DeliveryHandoff,
  eventType = 'delivery_handoff_recorded',
): void {
  withOperationMutex(operationMutexPath(root, planState.run_id), () => {
    const current = loadState(root, planState.run_id)
    const recorded = current.delivery_handoff

    if (recorded && handoffKey(recorded) === handoffKey(handoff)) {
      planState.delivery_handoff = recorded

      return
    }

    current.delivery_handoff = handoff
    persist(root, current, eventType, { handoff })
    planState.delivery_handoff = handoff
  })
}

/**
 * Persist a failed route on the plan run so `pan status` on it names the
 * failure and the manual commands after the approval's own output is gone.
 * The failure is reported whatever happens here: a plan run whose record
 * does not exist (the route failed reading it) has nowhere to write, and a
 * write failure must not hide the routing error it would annotate.
 */
function recordFailedDeliveryRoute(
  root: string,
  planState: RunState,
  failed: {
    kind?: 'cohort' | 'delivery'
    error: string
    manual_commands: string[]
  },
): void {
  if (!fileExists(statePath(root, planState.run_id))) {
    return
  }

  try {
    recordDeliveryHandoff(
      root,
      planState,
      {
        kind: 'failed',
        ...(failed.kind ? { route: failed.kind } : {}),
        error: failed.error,
        manual_commands: failed.manual_commands,
        recorded_at: now(),
      },
      'delivery_route_failed',
    )
  } catch {
    // The routing failure is the report; the missing annotation is not.
  }
}

function handoffKey(handoff: DeliveryHandoff): string {
  switch (handoff.kind) {
    case 'delivery':
      return `delivery:${handoff.run_id}`
    case 'cohort':
      return `cohort:${handoff.cohort_id}`
    case 'failed':
      return `failed:${handoff.route ?? ''}:${handoff.error}`
  }
}

/**
 * Start the one `delivery` run a single-chunk plan hands off to.
 *
 * The run is bound to a fresh worktree exactly as a cohort chunk is, reads the
 * child specification as its request, and reaches the parent specification by
 * reference. The worktree name derives from the plan run and the chunk, so a
 * retry after a failure between worktree creation and run creation finds the
 * worktree it already made instead of refusing a second one, and a retry after
 * a failure between run creation and the handoff record adopts the run it
 * already made instead of binding a second run to the same worktree.
 */
function startSingleDeliveryRun(
  root: string,
  planState: RunState,
  plan: ParsedCohortPlan,
): DeliveryAutostartResult {
  const recorded = planState.delivery_handoff

  if (recorded?.kind === 'delivery') {
    return {
      status: 'already_started',
      kind: 'delivery',
      run_id: recorded.run_id,
      worktree: recorded.worktree,
      resume_command: `/pan-resume ${recorded.run_id}`,
    }
  }

  const planWorkspace = path.resolve(root, planState.workspace_root || '.')

  invariant(
    isGitRepository(planWorkspace),
    `Delivery handoff requires a Git repository workspace; the plan run's ` +
      `workspace ${planWorkspace} is not one, because the delivery run works ` +
      'in a worktree.',
    { code: 'COHORT_REQUIRES_GIT' },
  )

  const repositoryRoot = resolveRepositoryRoot(planWorkspace)
  const baseBranch = gitCurrentBranch(repositoryRoot)

  invariant(
    baseBranch,
    'Delivery handoff requires a named base branch. The workspace is on a ' +
      'detached HEAD.',
    { code: 'COHORT_BASE_BRANCH_REQUIRED' },
  )

  const [chunk] = plan.chunks

  invariant(
    fileExists(resolveInside(root, plan.parent_spec_path)),
    `Parent specification does not exist: ${plan.parent_spec_path}`,
    { code: 'COHORT_PARENT_SPEC_NOT_FOUND' },
  )
  invariant(
    fileExists(resolveInside(root, chunk.child_spec_path)),
    `Child specification for chunk '${chunk.id}' does not exist: ` +
      chunk.child_spec_path,
    { code: 'COHORT_CHILD_SPEC_NOT_FOUND' },
  )

  const worktreeName = deliveryWorktreeName(planState.run_id, chunk.id)
  const record =
    readWorktreeIndex(root).worktrees.find(
      (entry) => entry.name === worktreeName,
    ) ??
    createWorktree(root, worktreeName, {
      from: baseBranch,
      description: `Delivery of plan ${planState.run_id} chunk '${chunk.id}'`,
      repositoryRoot,
    })
  const adopted = existingDeliveryRun(root, chunk.child_spec_path, record.path)
  const run =
    adopted ??
    createRun(root, {
      workflowSlug: DELIVERY_WORKFLOW_SLUG,
      requestPath: chunk.child_spec_path,
      title: `${chunk.id} · ${chunk.title}`,
      workspace: record.path,
      worktree: {
        name: record.name,
        path: record.path,
        branch: record.branch,
      },
      contextReferencePath: plan.parent_spec_path,
    })

  recordDeliveryHandoff(root, planState, {
    kind: 'delivery',
    run_id: run.run_id,
    worktree: record.path,
    recorded_at: now(),
  })

  return {
    status: adopted ? 'already_started' : 'started',
    kind: 'delivery',
    run_id: run.run_id,
    worktree: record.path,
    resume_command: `/pan-resume ${run.run_id}`,
  }
}

/**
 * The `delivery` run an earlier handoff attempt created for one chunk: it
 * reads the chunk's child specification as its request and works in the
 * chunk's derived worktree. Two live runs on one worktree would edit the same
 * checkout, so a matching live run is adopted rather than duplicated. A
 * finished run is not: it no longer occupies the worktree.
 */
function existingDeliveryRun(
  root: string,
  childSpecPath: string,
  worktreePath: string,
): RunState | null {
  const workspace = path.resolve(root, worktreePath)
  const matches = (run: RunState): boolean =>
    run.workflow_slug === DELIVERY_WORKFLOW_SLUG &&
    run.request.source_path === childSpecPath &&
    path.resolve(root, run.workspace_root) === workspace

  return (
    newestRun(
      listRunStatesWhere(root, matches).filter(
        (run) => runIsLive(run) && matches(run),
      ),
    ) ?? null
  )
}

function newestRun(runs: RunState[]): RunState | undefined {
  return [...runs].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  )[0]
}

/**
 * Continue the plan after one cohort's merge proof landed: start the next
 * cohort, or the release run when no cohort is left.
 *
 * Both branches add only worktrees, branches, and run records. The merge that
 * preceded them was the operator's explicit `cohort integrate`, so the
 * continuation stays inside the no-commit bound every autostart keeps.
 */
function continueAfterIntegration(
  root: string,
  cohortId: string,
): CohortContinuationResult {
  const pan = panCommand(root)
  const state = loadCohortState(root, cohortId)

  if (firstUnsatisfiedIndex(root, state) !== null) {
    try {
      return {
        status: 'started',
        kind: 'cohort',
        ...startCohort(root, cohortId),
      }
    } catch (error) {
      return {
        status: 'failed',
        kind: 'cohort',
        error: errorMessage(error),
        manual_commands: [`${pan} cohort start ${cohortId}`],
      }
    }
  }

  try {
    return startReleaseRun(root, cohortId)
  } catch (error) {
    // Every merge proof landed, so the retry is the merge-free `cohort
    // release`, which runs only this continuation. A hand-built `pan init`
    // would carry no start-stage record or cohort binding, and neither
    // release nor integrate would adopt it.
    return {
      status: 'failed',
      kind: 'release',
      error: errorMessage(error),
      manual_commands: [`${pan} cohort release ${cohortId}`],
    }
  }
}

/**
 * The release run reads the operator's original request, which the plan run
 * stored, and reaches the parent specification by reference. When the plan
 * run's record is gone, the parent specification itself stands in.
 */
function releaseRunRequestPath(
  root: string,
  state: CohortSessionState,
): string {
  if (fileExists(statePath(root, state.plan_run_id))) {
    return loadState(root, state.plan_run_id).request.stored_path
  }

  return state.parent_spec_path
}

/**
 * Start the release run of a fully integrated cohort session: one `delivery`
 * run that begins at `verify` on the integrated result, so release
 * preparation happens once, on the integrated result, never per unit.
 *
 * The run is bound to the worktree that holds the integration branch when the
 * harness recorded one, which is the case after `--into-branch`. Otherwise the
 * branch is held by the operator's own checkout, which Git will not check out a
 * second time, so the run gets a managed worktree of its own, branched from
 * the integration head. Every `pan release` subcommand needs `--worktree`, so a
 * run without one could only prepare release metadata.
 *
 * Run creation and the session record are two writes, so a crash between them
 * leaves a release run the session does not name. The next attempt adopts a
 * release run already bound to the release worktree, exactly as the worktree
 * lookup adopts a recorded worktree, instead of starting a second one.
 */
function startReleaseRun(
  root: string,
  cohortId: string,
): CohortContinuationResult {
  return withCohortSession(root, cohortId, (state) => {
    if (
      state.release_run_id &&
      fileExists(statePath(root, state.release_run_id))
    ) {
      return releaseRunHandoff(
        'already_started',
        loadState(root, state.release_run_id),
      )
    }

    const target = integrationBranch(state)
    const repositoryRoot = cohortRepositoryRoot(root, state)
    const index = readWorktreeIndex(root)
    const releaseWorktree = releaseWorktreeName(cohortId)
    const record =
      index.worktrees.find((entry) => entry.branch === target) ??
      index.worktrees.find((entry) => entry.name === releaseWorktree) ??
      createWorktree(root, releaseWorktree, {
        from: target,
        description: `Release of cohort session ${cohortId}`,
        repositoryRoot,
      })
    const adopted = existingReleaseRun(root, cohortId, record.path)

    if (adopted) {
      persistCohortState(root, { ...state, release_run_id: adopted.run_id })

      return releaseRunHandoff('already_started', adopted)
    }

    const run = createRun(root, {
      workflowSlug: DELIVERY_WORKFLOW_SLUG,
      startStage: RELEASE_RUN_START_STAGE,
      requestPath: releaseRunRequestPath(root, state),
      title: `Release · cohort ${cohortId}`,
      workspace: record.path,
      worktree: { name: record.name, path: record.path, branch: record.branch },
      contextReferencePath: state.parent_spec_path,
      // The chunk runs are the implementation record of this run, so the
      // binding names the session and the final merge proof that lists them.
      cohort: {
        cohort_id: cohortId,
        role: 'release',
        integration_record: lastIntegratedCohort(state).evidence_path,
      },
    })

    persistCohortState(root, { ...state, release_run_id: run.run_id })

    return releaseRunHandoff('started', run)
  })
}

function releaseWorktreeName(cohortId: string): string {
  return `release-${sha256(cohortId).slice(0, 6)}`
}

function releaseRunHandoff(
  status: 'started' | 'already_started',
  run: RunState,
): CohortContinuationResult {
  return {
    status,
    kind: 'release',
    run_id: run.run_id,
    worktree: run.workspace_root,
    resume_command: `/pan-resume ${run.run_id}`,
  }
}

/**
 * A live release run of this session bound to the integration checkout: a
 * `delivery` run whose cohort binding names the session in the release role
 * and that works in that checkout. The binding is what separates it from a
 * chunk-shaped delivery run that happens to share the workspace, and liveness
 * is what separates it from the release run of an earlier, finished session
 * on the same branch.
 */
function existingReleaseRun(
  root: string,
  cohortId: string,
  workspace: string,
): RunState | null {
  const expected = path.resolve(root, workspace)
  const matches = (run: RunState): boolean =>
    run.workflow_slug === DELIVERY_WORKFLOW_SLUG &&
    run.cohort?.role === 'release' &&
    run.cohort.cohort_id === cohortId &&
    path.resolve(root, run.workspace_root) === expected

  return (
    newestRun(
      listRunStatesWhere(root, matches).filter(
        (run) => runIsLive(run) && matches(run),
      ),
    ) ?? null
  )
}

/**
 * The chunk runs of the first cohort when at least one already exists, or null
 * when the cohort has not been started at all.
 */
function startedChunksOfFirstCohort(
  root: string,
  state: CohortSessionState,
): CohortStartResult | null {
  const [firstIndex] = cohortIndexes(state)
  const chunks = chunksOfCohort(state, firstIndex).filter(
    (chunk) => chunk.run_id,
  )

  // The autostart fires the first batch only. A cohort wider than the
  // parallelism limit legitimately keeps unstarted chunks, which the operator
  // starts with `pan cohort start` as slots free up, so any started chunk
  // means the hook already did its work.
  if (chunks.length === 0) {
    return null
  }

  const index = readWorktreeIndex(root)

  return {
    cohort_id: state.cohort_id,
    cohort_index: firstIndex,
    deferred_chunks: unstartedChunksOfCohort(state, firstIndex).map(
      (chunk) => chunk.id,
    ),
    max_parallel: cohortMaxParallel(state),
    supervise_command: `/pan-cohort ${state.cohort_id}`,
    chunks: chunks.map((chunk) => ({
      chunk: chunk.id,
      run_id: chunk.run_id as string,
      worktree:
        index.worktrees.find((entry) => entry.name === chunk.worktree)?.path ??
        (chunk.worktree as string),
      resume_command: `/pan-resume ${chunk.run_id}`,
    })),
  }
}
