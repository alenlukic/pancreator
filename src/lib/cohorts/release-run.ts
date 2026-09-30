/** The release run that follows the last integrated cohort. */

import path from 'node:path'

import { createRun } from '../engine.js'
import { fileExists, sha256 } from '../io.js'
import {
  statePath,
  loadState,
  listRunStatesWhere,
  runIsLive,
} from '../state.js'
import type { RunState, CohortSessionState } from '../types.js'
import { readWorktreeIndex, createWorktree } from '../worktrees.js'
import {
  DELIVERY_WORKFLOW_SLUG,
  RELEASE_RUN_START_STAGE,
  persistCohortState,
  withCohortSession,
  type CohortContinuationResult,
  type CohortStartResult,
} from './state.js'
import {
  chunksOfCohort,
  cohortIndexes,
  cohortMaxParallel,
  cohortRepositoryRoot,
  integrationBranch,
  unstartedChunksOfCohort,
} from './chunks.js'
import { lastIntegratedCohort } from './integration.js'
import {
  newestRun,
  planRunInvolvement,
  releaseRunRequestPath,
} from './delivery.js'

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
export function startReleaseRun(
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
      involvement: planRunInvolvement(root, state),
      design: state.design_composition,
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
export function startedChunksOfFirstCohort(
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
