/** Cohort session initialization, cohort fan-out start, and session status. */

import path from 'node:path'

import { createRun } from '../engine/create-run.js'
import { invariant } from '../errors.js'
import { supervisorBootstrap } from '../governance/supervisor-card.js'
import { isGitRepository, gitCurrentBranch } from '../git.js'
import { fileExists, resolveInside, readText, ensureDir } from '../io.js'
import { keywordRunSuffixFrom } from '../naming.js'
import { panCommand } from '../project-config.js'
import {
  loadState,
  makeUniqueRunId,
  now,
  listRunStatesWhere,
  runIsLive,
} from '../state.js'
import type {
  CohortSessionState,
  RunState,
  CohortChunkRecord,
} from '../types.js'
import {
  resolveRepositoryRoot,
  readWorktreeIndex,
  createWorktree,
} from '../worktrees.js'
import {
  COHORT_CHUNK_WORKFLOW_SLUG,
  COHORT_REDLINE_OCCASION,
  DEFAULT_COHORT_MAX_PARALLEL,
  TERMINAL_STATUSES,
  cohortDir,
  loadCohortState,
  persistCohortState,
  withCohortSession,
  type CohortChunkBootstrap,
  type CohortStartResult,
  type CohortStatusView,
} from './state.js'
import {
  assertPredecessorsSatisfied,
  chunkRunState,
  chunkWorktreeName,
  chunksOfCohort,
  cohortIndexes,
  cohortIsSatisfied,
  cohortMaxParallel,
  cohortRepositoryRoot,
  cohortRunsSucceeded,
  firstUnsatisfiedIndex,
  integrationBranch,
  liveChunkRuns,
  unstartedChunksOfCohort,
} from './chunks.js'
import { readRatifiedCohortPlan } from './plan.js'
import {
  cohortSessionForPlanRun,
  newestRun,
  planRunInvolvement,
  recordDeliveryHandoff,
} from './delivery.js'

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
    ...(planState.design_composition
      ? { design_composition: true as const }
      : {}),
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
 * This performs no source-control action beyond adding worktrees: the unit
 * commit and the group merge belong to the integration that follows a finished
 * group. Each chunk record is written before its worktree exists and again
 * after its run exists, so an interrupted fan-out leaves resources the
 * lifecycle commands can still find.
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
    // One read for the whole fan-out: the plan run's snapshot does not change
    // across the loop, and reading it per chunk also clears that run's stale
    // operation mutex once per chunk for no reason.
    const involvement = planRunInvolvement(root, loaded)

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
          involvement,
          design: state.design_composition,
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
export function updateChunk(
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

  const bootstrap: CohortChunkBootstrap[] = []
  const chunks = state.chunks.map((chunk) => {
    const run = chunkRunState(root, chunk.run_id)

    // One session supervises every live chunk run, so it owes each one the
    // same card, attestation, redline, and model-evidence commands.
    if (run && !chunk.abandoned && !TERMINAL_STATUSES.has(run.status)) {
      bootstrap.push({
        chunk: chunk.id,
        worktree: run.managed_worktree?.name ?? null,
        ...supervisorBootstrap(root, run, COHORT_REDLINE_OCCASION),
      })
    }

    return {
      ...chunk,
      status: chunk.run_id
        ? (run?.status ?? 'failed')
        : ('not_started' as const),
      current_stage: run?.current_stage ?? null,
      resume_command: chunk.run_id ? `/pan-resume ${chunk.run_id}` : null,
    }
  })

  const readyToAdvance =
    activeIndex !== null &&
    cohortRunsSucceeded(root, state, activeIndex) &&
    !state.satisfaction.some((entry) => entry.cohort_index === activeIndex)
  // HR3-010: a cohort the operator abandoned whole has no branch to merge, so
  // offering an integration describes work that cannot happen. The command
  // that does apply records the abandonment and unblocks the next cohort.
  const nothingToMerge =
    activeIndex !== null &&
    chunksOfCohort(state, activeIndex).every((chunk) => chunk.abandoned)
  const readyToIntegrate = readyToAdvance && !nothingToMerge

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
    record_abandoned_cohort_command:
      readyToAdvance && nothingToMerge
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
    bootstrap,
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
