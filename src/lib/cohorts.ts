import { readdirSync } from 'node:fs'
import path from 'node:path'

import { createRun } from './engine.js'
import { errorMessage, invariant } from './errors.js'
import {
  gitCurrentBranch,
  gitConflictedPaths,
  gitHead,
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
import { loadState, makeUniqueRunId, now, statePath } from './state.js'
import type {
  CohortChunkRecord,
  CohortDependencyEdge,
  CohortGroupRecord,
  CohortSessionState,
  RunState,
  RunStatus,
} from './types.js'
import {
  createWorktree,
  reconcileWorktrees,
  removeWorktree,
  resolveBranchCheckout,
  readWorktreeIndex,
} from './worktrees.js'

/** Workflow whose ratified artifact a cohort fan-out reads. */
export const COHORT_PLAN_WORKFLOW_SLUG = 'planning'
const CHUNK_WORKFLOW = 'delivery'
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
  /** Lowest cohort index that is not satisfied yet, or null when all are. */
  active_cohort_index: number | null
  /** Cohort index whose start is refused, with the predecessor that blocks it. */
  blocked_cohort_index: number | null
  blocking_predecessor_index: number | null
  chunks: CohortChunkView[]
  satisfied_cohort_indexes: number[]
  integrate_command: string | null
  start_command: string | null
}

export interface CohortStartResult {
  cohort_id: string
  cohort_index: number
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
  merge_commit: string
  merged_chunks: string[]
  evidence_path: string
}

export type CohortAutostartResult =
  | ({ status: 'started' } & CohortStartResult)
  | ({ status: 'already_started' } & CohortStartResult)
  | { status: 'failed'; error: string; manual_commands: string[] }

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
  for (const index of cohortIndexes(state)) {
    if (index >= cohortIndex) {
      break
    }

    invariant(
      cohortIsSatisfied(root, state, index),
      `Cohort ${cohortIndex} of session ${state.cohort_id} cannot proceed ` +
        `while cohort ${index} is unsatisfied. Finish every chunk run of ` +
        `cohort ${index}, then run './bin/pan cohort integrate ` +
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
  if (!state.cohort) {
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
  invariant(
    isGitRepository(root),
    'Cohort fan-out requires a Git repository, because each chunk runs in a ' +
      'worktree.',
    { code: 'COHORT_REQUIRES_GIT' },
  )

  const plan = readRatifiedCohortPlan(root, options.planRunId)
  const baseBranch = options.from?.trim() || gitCurrentBranch(root)

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
  const cohortId = makeUniqueRunId(
    base,
    keywordRunSuffixFrom(
      path.basename(plan.parent_spec_path),
      readText(resolveInside(root, plan.parent_spec_path)),
    ),
  )

  ensureDir(cohortDir(root, cohortId))

  return persistCohortState(root, {
    schema_version: 1,
    cohort_id: cohortId,
    plan_run_id: options.planRunId,
    parent_spec_path: plan.parent_spec_path,
    base_branch: baseBranch,
    created_at: now(),
    updated_at: now(),
    chunks: plan.chunks,
    edges: plan.edges,
    cohorts: plan.cohorts,
    satisfaction: [],
  })
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
 * Create one worktree and one delivery run per chunk of the next unsatisfied
 * cohort, or of the cohort the operator names.
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

    const pending = unstartedChunksOfCohort(loaded, cohortIndex)

    invariant(
      pending.length > 0,
      `Cohort ${cohortIndex} of session ${cohortId} has no chunk left to ` +
        'start: every chunk is already running or abandoned. Finish the ' +
        `running chunk runs, then run './bin/pan cohort integrate ` +
        `${cohortId}'.`,
      { code: 'COHORT_ALREADY_STARTED' },
    )

    let state = loaded
    const started: CohortStartResult['chunks'] = []

    for (const chunk of pending) {
      const worktreeName = chunkWorktreeName(cohortId, chunk.id)

      state = updateChunk(root, state, chunk.id, { worktree: worktreeName })

      const record = createWorktree(root, worktreeName, {
        from: state.base_branch,
        description: `Cohort ${cohortIndex} chunk '${chunk.id}'`,
      })

      state = updateChunk(root, state, chunk.id, {
        worktree: worktreeName,
        branch: record.branch,
      })

      const run = createRun(root, {
        workflowSlug: CHUNK_WORKFLOW,
        requestPath: chunk.child_spec_path,
        title: `${chunk.id} · ${chunk.title}`,
        workspace: record.path,
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

    return { cohort_id: cohortId, cohort_index: cohortIndex, chunks: started }
  })
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

  return {
    cohort_id: cohortId,
    plan_run_id: state.plan_run_id,
    parent_spec_path: state.parent_spec_path,
    base_branch: state.base_branch,
    active_cohort_index: activeIndex,
    blocked_cohort_index: blockedIndex,
    blocking_predecessor_index: blockedIndex === null ? null : activeIndex,
    chunks,
    satisfied_cohort_indexes: cohortIndexes(state).filter((index) =>
      cohortIsSatisfied(root, state, index),
    ),
    integrate_command: readyToIntegrate
      ? `./bin/pan cohort integrate ${cohortId}`
      : null,
    start_command:
      activeIndex !== null &&
      unstartedChunksOfCohort(state, activeIndex).length > 0
        ? `./bin/pan cohort start ${cohortId}`
        : null,
  }
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
 */
export function integrateCohort(
  root: string,
  cohortId: string,
): CohortIntegrationResult {
  return withCohortSession(root, cohortId, (loaded) => {
    const cohortIndex = firstUnsatisfiedIndex(root, loaded)

    invariant(
      cohortIndex !== null,
      `Every cohort of session ${cohortId} is already integrated.`,
      { code: 'COHORT_COMPLETE' },
    )

    assertPredecessorsSatisfied(root, loaded, cohortIndex)

    const chunks = chunksOfCohort(loaded, cohortIndex).filter(
      (chunk) => !chunk.abandoned,
    )

    if (chunks.length === 0) {
      return recordAbandonedCohort(root, loaded, cohortIndex)
    }

    const index = readWorktreeIndex(root)

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
          `it, then run './bin/pan cohort integrate ${cohortId}' again.`,
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
          merge_commit: merged.merge_commit,
          evidence_path: merged.evidence_path,
        },
      ],
    })

    return {
      cohort_id: cohortId,
      cohort_index: cohortIndex,
      base_branch: loaded.base_branch,
      merge_commit: merged.merge_commit,
      merged_chunks: chunks.map((chunk) => chunk.id),
      evidence_path: merged.evidence_path,
    }
  })
}

interface MergeOutcome {
  merge_commit: string
  evidence_path: string
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
): CohortIntegrationResult {
  const abandoned = chunksOfCohort(state, cohortIndex).map((chunk) => ({
    chunk: chunk.id,
    note: chunk.abandoned?.note ?? '',
    recorded_at: chunk.abandoned?.recorded_at ?? '',
  }))
  const baseHead = gitRevParse(root, state.base_branch)
  const evidencePath = `runtime/logs/cohorts/${state.cohort_id}/integration-${cohortIndex}.json`

  writeJsonAtomic(resolveInside(root, evidencePath), {
    schema_version: 1,
    cohort_id: state.cohort_id,
    cohort_index: cohortIndex,
    base_branch: state.base_branch,
    merged_chunks: [],
    abandoned_chunks: abandoned,
    merge_commit: baseHead,
    recorded_at: now(),
  })
  persistCohortState(root, {
    ...state,
    satisfaction: [
      ...state.satisfaction,
      {
        cohort_index: cohortIndex,
        recorded_at: now(),
        base_branch: state.base_branch,
        merge_commit: baseHead,
        evidence_path: evidencePath,
      },
    ],
  })

  return {
    cohort_id: state.cohort_id,
    cohort_index: cohortIndex,
    base_branch: state.base_branch,
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
  const baseBefore = gitRevParse(root, state.base_branch)
  const worktreeNames = chunks.map((chunk) => chunk.worktree as string)
  const chunkOfWorktree = (name: string): string =>
    chunks.find((chunk) => chunk.worktree === name)?.id ?? name
  const result = reconcileWorktrees(
    root,
    { into_branch: state.base_branch },
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
      base_commit_before_merge: baseBefore,
      base_commit_after_conflict: gitRevParse(root, state.base_branch),
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
        `'${state.base_branch}' conflicted on chunk '${conflicted}': ` +
        `${result.conflicted_paths.join(', ')}. ` +
        (landed.length > 0
          ? `Chunks already merged onto '${state.base_branch}': ` +
            `${landed.join(', ')} (base was ${baseBefore.slice(0, 12)} ` +
            'before integration). '
          : `No chunk was merged; '${state.base_branch}' is unchanged. `) +
        `The record is at ${recordPath}. Resolve the conflict, then run ` +
        `'./bin/pan cohort integrate ${state.cohort_id}' again.`,
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

  return {
    merge_commit: gitRevParse(root, state.base_branch),
    evidence_path: result.evidence_path,
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
 * merges directly inside the checkout that holds the base branch. A conflict is
 * aborted, which restores that checkout instead of leaving the operator's own
 * workspace in a stopped merge.
 */
function mergeSingleChunkBranch(
  root: string,
  state: CohortSessionState,
  cohortIndex: number,
  chunk: CohortChunkRecord,
): MergeOutcome {
  const branch = chunk.branch

  invariant(
    branch,
    `Chunk '${chunk.id}' has no recorded branch, so there is nothing to merge.`,
    { code: 'COHORT_INTEGRATION_INCOMPLETE', details: { chunk: chunk.id } },
  )

  const checkout = resolveBranchCheckout(root, state.base_branch)

  invariant(
    !gitWorktreeIsDirty(checkout),
    `The checkout that holds '${state.base_branch}' has uncommitted work. ` +
      'Commit or stash it, then integrate again.',
    { code: 'COHORT_INTEGRATION_INCOMPLETE' },
  )

  const merge = gitMergeBranch(checkout, branch)

  if (!merge.succeeded) {
    const conflicted = gitConflictedPaths(checkout)

    gitMergeAbort(checkout)

    invariant(
      false,
      `Merging chunk '${chunk.id}' into '${state.base_branch}' conflicted on ` +
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

  const evidencePath = `runtime/logs/cohorts/${state.cohort_id}/integration-${cohortIndex}.json`

  writeJsonAtomic(resolveInside(root, evidencePath), {
    schema_version: 1,
    cohort_id: state.cohort_id,
    cohort_index: cohortIndex,
    base_branch: state.base_branch,
    merged_branch: branch,
    merge_commit: mergeCommit,
    recorded_at: now(),
  })

  return { merge_commit: mergeCommit, evidence_path: evidencePath }
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
 * Start cohort 1 when the operator approves a ratified planning artifact on a
 * run created with `--autostart`.
 *
 * The hook is a convenience over the two commands the operator would otherwise
 * type, so it runs after the decision is already recorded and it never rewrites
 * that decision. A second approval of the same run finds the session already
 * open and reports its chunks as `already_started`, because nothing failed. A
 * failure is reported with the manual commands, because the approval and the
 * ratified plan remain valid whatever happened to the fan-out.
 */
export function maybeAutostartCohort(
  root: string,
  state: RunState,
  decision: { actor: 'operator' | 'away'; action: string },
): CohortAutostartResult | null {
  if (
    decision.actor !== 'operator' ||
    decision.action !== 'approve' ||
    state.workflow_slug !== COHORT_PLAN_WORKFLOW_SLUG ||
    state.status !== 'succeeded' ||
    state.autostart_cohort !== true
  ) {
    return null
  }

  const manualCommands = [
    `./bin/pan cohort init --plan-run ${state.run_id}`,
    './bin/pan cohort start <cohort-id>',
  ]

  try {
    const existing = cohortSessionForPlanRun(root, state.run_id)

    if (existing) {
      const started = startedChunksOfFirstCohort(root, existing)

      if (started) {
        return { status: 'already_started', ...started }
      }
    }

    const session =
      existing ?? initCohortSession(root, { planRunId: state.run_id })

    return { status: 'started', ...startCohort(root, session.cohort_id) }
  } catch (error) {
    return {
      status: 'failed',
      error: errorMessage(error),
      manual_commands: manualCommands,
    }
  }
}

/**
 * The chunk runs of the first cohort when every one of them already exists,
 * or null when at least one chunk still waits to be started.
 */
function startedChunksOfFirstCohort(
  root: string,
  state: CohortSessionState,
): CohortStartResult | null {
  const [firstIndex] = cohortIndexes(state)
  const chunks = chunksOfCohort(state, firstIndex).filter(
    (chunk) => chunk.run_id,
  )

  if (
    chunks.length === 0 ||
    unstartedChunksOfCohort(state, firstIndex).length > 0
  ) {
    return null
  }

  const index = readWorktreeIndex(root)

  return {
    cohort_id: state.cohort_id,
    cohort_index: firstIndex,
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
