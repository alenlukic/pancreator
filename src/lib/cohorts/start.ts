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
  chunkIsMerged,
  predecessorIds,
  chunkRunState,
  chunkWorktreeName,
  chunksOfCohort,
  cohortIndexes,
  cohortIsSatisfied,
  cohortMaxParallel,
  cohortRepositoryRoot,
  firstUnsatisfiedIndex,
  integrationBranch,
  liveChunkRuns,
  readyUnstartedChunks,
  unstartedChunksOfCohort,
} from './chunks.js'
import { readRatifiedCohortPlan, ratifiedPlanReference } from './plan.js'
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
  /** Concurrent chunk runs the session allows; defaults to three. */
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
   * Restrict the start pool to one group. Ready units of that group still
   * start once their own predecessors have merged; an unrelated unit of an
   * earlier group that is still running does not refuse the call.
   */
  cohortIndex?: number
}

/**
 * Create one worktree and one `delivery-chunk` run per ready unstarted unit,
 * up to the session's free slots.
 *
 * A unit is ready once each of its own predecessors has merged. Ready units
 * across groups share one slot pool. This performs no source-control action
 * beyond adding worktrees: the unit commit and the merge belong to the
 * integration that follows a succeeded run. Each chunk record is written
 * before its worktree exists and again after its run exists, so an interrupted
 * fan-out leaves resources the lifecycle commands can still find.
 */
export function startCohort(
  root: string,
  cohortId: string,
  options: StartCohortOptions = {},
): CohortStartResult {
  return withCohortSession(root, cohortId, (loaded) => {
    const named = options.cohortIndex

    if (named !== undefined) {
      invariant(
        cohortIndexes(loaded).includes(named),
        `Session ${cohortId} declares no cohort ${named}. Declared ` +
          `cohorts: ${cohortIndexes(loaded).join(', ')}.`,
        { code: 'COHORT_NOT_FOUND' },
      )
    } else {
      invariant(
        firstUnsatisfiedIndex(root, loaded) !== null,
        `Every cohort of session ${cohortId} is satisfied, so there is nothing ` +
          'left to start.',
        { code: 'COHORT_COMPLETE' },
      )
    }

    const pan = panCommand(root)
    const unstarted = unstartedChunksOfCohort(loaded, named)
    const ready = readyUnstartedChunks(loaded, named)
    const reportIndex =
      named ??
      ready[0]?.cohort_index ??
      unstarted[0]?.cohort_index ??
      firstUnsatisfiedIndex(root, loaded) ??
      1

    invariant(
      unstarted.length > 0,
      `Cohort ${reportIndex} of session ${cohortId} has no chunk left to ` +
        'start: every chunk is already running or abandoned. Finish the ' +
        `running chunk runs, then run '${pan} cohort integrate ` +
        `${cohortId}'.`,
      { code: 'COHORT_ALREADY_STARTED' },
    )

    if (ready.length === 0) {
      return {
        cohort_id: cohortId,
        cohort_index: reportIndex,
        deferred_chunks: unstarted.map((chunk) => chunk.id),
        max_parallel: cohortMaxParallel(loaded),
        supervise_command: `/pan-cohort ${cohortId}`,
        chunks: [],
      }
    }

    // The limit bounds concurrent chunk runs of the whole session, not one
    // group. Each call fills the slots that terminal runs freed.
    const maxParallel = cohortMaxParallel(loaded)
    const live = liveChunkRuns(root, loaded)
    const slots = Math.max(0, maxParallel - live)

    invariant(
      slots > 0,
      `Session ${cohortId} already has ${live} live chunk run(s), the ` +
        `session's parallelism limit (${maxParallel}). ${ready.length} ` +
        `ready chunk(s) wait for a slot: ` +
        `${ready.map((chunk) => chunk.id).join(', ')}. Finish or cancel a ` +
        `live chunk, then run '${pan} cohort start ${cohortId}' again.`,
      {
        code: 'COHORT_PARALLELISM_LIMIT',
        details: {
          cohort_index: reportIndex,
          live_chunk_runs: live,
          max_parallel: maxParallel,
          waiting_chunks: ready.map((chunk) => chunk.id),
        },
      },
    )

    const pending = ready.slice(0, slots)
    const deferred = [
      ...ready.slice(slots).map((chunk) => chunk.id),
      ...unstarted
        .filter((chunk) => !ready.some((entry) => entry.id === chunk.id))
        .map((chunk) => chunk.id),
    ]
    // One read for the whole fan-out: the plan run's snapshot does not change
    // across the loop, and reading it per chunk also clears that run's stale
    // operation mutex once per chunk for no reason.
    const involvement = planRunInvolvement(root, loaded)

    let state = loaded
    const started: CohortStartResult['chunks'] = []

    for (const chunk of pending) {
      const worktreeName = chunkWorktreeName(cohortId, chunk.id)
      const cohortIndex = chunk.cohort_index

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
      const workflowSlug =
        chunk.size_class === 'M'
          ? 'standard'
          : chunk.size_class
            ? 'one-shot'
            : COHORT_CHUNK_WORKFLOW_SLUG
      const run =
        existingChunkRun(root, cohortId, chunk.id, record.path) ??
        createRun(root, {
          workflowSlug,
          requestPath: chunk.child_spec_path,
          title: `${chunk.id} · ${chunk.title}`,
          workspace: record.path,
          worktree: {
            name: record.name,
            path: record.path,
            branch: record.branch,
          },
          contextReferencePath: state.parent_spec_path,
          approvedPlan: ratifiedPlanReference(root, state.plan_run_id),
          involvement,
          design:
            workflowSlug === 'one-shot' ? undefined : state.design_composition,
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
      cohort_index: pending[0]?.cohort_index ?? reportIndex,
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

/**
 * Builds the read-only status view of one cohort session: each chunk's run
 * status and stage, the active and blocked cohort indexes, the supervisor
 * bootstrap for every live chunk run, and the next applicable `pan cohort`
 * command (start, integrate, record abandonment, or release). Throws
 * `COHORT_NOT_FOUND` for an unknown session.
 */
export function cohortStatus(root: string, cohortId: string): CohortStatusView {
  const state = loadCohortState(root, cohortId)
  const activeIndex = firstUnsatisfiedIndex(root, state)
  const blockedChunk = unstartedChunksOfCohort(state).find((chunk) =>
    predecessorIds(state, chunk.id).some((id) => {
      const predecessor = state.chunks.find((entry) => entry.id === id)
      return !predecessor || !chunkIsMerged(state, predecessor)
    }),
  )
  const blockedPredecessor =
    blockedChunk &&
    predecessorIds(state, blockedChunk.id)
      .map((id) => state.chunks.find((entry) => entry.id === id))
      .find((entry) => entry && !chunkIsMerged(state, entry))

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

  const readyToIntegrate = state.chunks.some(
    (chunk) =>
      !chunk.abandoned &&
      !chunkIsMerged(state, chunk) &&
      chunkRunState(root, chunk.run_id)?.status === 'succeeded',
  )
  // HR3-010: a cohort the operator abandoned whole has no branch to merge, so
  // offering an integration describes work that cannot happen. The command
  // that does apply records the abandonment and unblocks the next cohort.
  const nothingToMerge =
    activeIndex !== null &&
    chunksOfCohort(state, activeIndex).every((chunk) => chunk.abandoned)

  const maxParallel = cohortMaxParallel(state)
  const live = liveChunkRuns(root, state)

  const pan = panCommand(root)

  return {
    cohort_id: cohortId,
    plan_run_id: state.plan_run_id,
    parent_spec_path: state.parent_spec_path,
    base_branch: state.base_branch,
    integration_branch: integrationBranch(state),
    active_cohort_index: activeIndex,
    blocked_cohort_index: blockedChunk?.cohort_index ?? null,
    blocking_predecessor_index: blockedPredecessor?.cohort_index ?? null,
    chunks,
    satisfied_cohort_indexes: cohortIndexes(state).filter((index) =>
      cohortIsSatisfied(root, state, index),
    ),
    integrate_command: readyToIntegrate
      ? `${pan} cohort integrate ${cohortId}`
      : null,
    record_abandoned_cohort_command:
      nothingToMerge && !readyToIntegrate
        ? `${pan} cohort integrate ${cohortId}`
        : null,
    start_command:
      readyUnstartedChunks(state).length > 0 && live < maxParallel
        ? `${pan} cohort start ${cohortId}`
        : null,
    max_parallel: maxParallel,
    live_chunk_runs: live,
    supervise_command: bootstrap.length > 0 ? `/pan-cohort ${cohortId}` : null,
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
