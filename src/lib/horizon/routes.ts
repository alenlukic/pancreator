/**
 * Task routes: live run views, route resolution and refresh, cohort and run
 * progress, and the advance commands a route offers.
 */

import { errorMessage } from '../errors.js'
import { getRunState } from '../engine/run-status.js'
import { cohortSessionForPlanRun } from '../cohorts/delivery.js'
import { integrateCohort, releaseCohort } from '../cohorts/integration.js'
import { cohortStatus, startCohort } from '../cohorts/start.js'
import type { CohortStatusView } from '../cohorts/state.js'
import { supervisorBootstrap } from '../governance/supervisor-card.js'
import type { RunState } from '../types.js'
import type {
  HorizonLiveRun,
  HorizonLiveRunRole,
  HorizonRouteCommands,
  HorizonRouteProgress,
  HorizonSessionState,
  HorizonTask,
  HorizonTaskRoute,
} from './session.js'

/**
 * The run statuses the harness itself advances. A run resting in `paused` or
 * `awaiting_operator` waits for a decision only a human takes, so it mutates
 * nothing while the session moves on; every other non-terminal status is work
 * still in flight.
 */
export const ADVANCING_RUN_STATUSES: ReadonlySet<RunState['status']> = new Set([
  'running',
  'awaiting_supervisor',
])

/** Read a task's run, treating an unreadable record as no run at all. */
export function taskRunState(root: string, task: HorizonTask): RunState | null {
  if (!task.run_id) {
    return null
  }

  try {
    return getRunState(root, task.run_id)
  } catch {
    return null
  }
}

const TERMINAL_RUN_STATUSES: ReadonlySet<RunState['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
])

export function readRun(
  root: string,
  runId: string | null | undefined,
): RunState | null {
  if (!runId) {
    return null
  }

  try {
    return getRunState(root, runId)
  } catch {
    return null
  }
}

const HORIZON_REDLINE_OCCASION = 'pan-horizon'

function liveRunView(
  root: string,
  run: RunState,
  role: HorizonLiveRunRole,
  chunk: string | null = null,
): HorizonLiveRun {
  return {
    ...supervisorBootstrap(root, run, HORIZON_REDLINE_OCCASION),
    role,
    chunk,
    status: run.status,
    current_stage: run.current_stage,
    pending_action: run.pending_action,
    pause_reason: run.pause_reason ?? null,
    worktree: run.managed_worktree?.name ?? null,
    horizon_ladder: run.horizon_ladder ?? null,
  }
}

export const NO_ROUTE_COMMANDS: HorizonRouteCommands = {
  start_command: null,
  integrate_command: null,
  record_abandoned_cohort_command: null,
  release_command: null,
  manual_commands: [],
}

/**
 * Where a task's own run sent its work.
 *
 * Approving a ratified plan starts one delivery run or cohort 1 of a cohort
 * session, and `maybeStartDelivery` records that on the planning run as
 * `delivery_handoff`. A run whose handoff was never recorded may still own a
 * cohort session (an older record, or a route the operator completed by
 * hand), so the cohort index is the fallback. A run that routed nowhere has
 * no route and finishes the task by itself.
 */
export function resolveTaskRoute(
  root: string,
  run: RunState,
): HorizonTaskRoute | null {
  const handoff = run.delivery_handoff

  if (handoff?.kind === 'delivery') {
    return {
      kind: 'delivery',
      run_id: handoff.run_id,
      cohort_id: null,
      release_run_id: null,
      failed: null,
    }
  }

  if (handoff?.kind === 'cohort') {
    return refreshTaskRoute(root, {
      kind: 'cohort',
      run_id: null,
      cohort_id: handoff.cohort_id,
      release_run_id: null,
      failed: null,
    })
  }

  if (handoff?.kind === 'failed') {
    return {
      kind: handoff.route ?? 'delivery',
      run_id: null,
      cohort_id: null,
      release_run_id: null,
      failed: {
        error: handoff.error,
        manual_commands: handoff.manual_commands,
      },
    }
  }

  let cohort = null

  try {
    cohort = cohortSessionForPlanRun(root, run.run_id)
  } catch {
    cohort = null
  }

  if (cohort) {
    return refreshTaskRoute(root, {
      kind: 'cohort',
      run_id: null,
      cohort_id: cohort.cohort_id,
      release_run_id: cohort.release_run_id ?? null,
      failed: null,
    })
  }

  return null
}

/** Re-read the parts of a route the harness advances on its own. */
export function refreshTaskRoute(
  root: string,
  route: HorizonTaskRoute,
): HorizonTaskRoute {
  if (route.kind !== 'cohort' || !route.cohort_id) {
    return route
  }

  try {
    const view = cohortStatus(root, route.cohort_id)

    return { ...route, release_run_id: view.release_run_id }
  } catch {
    return route
  }
}

function cohortRouteProgress(
  root: string,
  route: HorizonTaskRoute,
  view: CohortStatusView,
): HorizonRouteProgress {
  const liveRuns: HorizonLiveRun[] = []

  for (const chunk of view.chunks) {
    const run = readRun(root, chunk.run_id)

    if (run && !chunk.abandoned && !TERMINAL_RUN_STATUSES.has(run.status)) {
      liveRuns.push(liveRunView(root, run, 'chunk', chunk.id))
    }
  }

  const release = readRun(root, view.release_run_id)

  if (release && !TERMINAL_RUN_STATUSES.has(release.status)) {
    liveRuns.push(liveRunView(root, release, 'release'))
  }

  const failedChunks = view.chunks.filter((chunk) => {
    const run = readRun(root, chunk.run_id)

    return (
      run !== null &&
      !chunk.abandoned &&
      (run.status === 'failed' || run.status === 'canceled')
    )
  })
  let stopped: string | null = null

  if (
    release &&
    (release.status === 'failed' || release.status === 'canceled')
  ) {
    stopped = `The release run ${release.run_id} is '${release.status}'.`
  } else if (
    liveRuns.length === 0 &&
    failedChunks.length > 0 &&
    view.integrate_command === null &&
    view.record_abandoned_cohort_command === null
  ) {
    stopped =
      `Chunk run${failedChunks.length === 1 ? '' : 's'} ` +
      failedChunks
        .map((chunk) => `${chunk.id} (${chunk.run_id ?? 'no run'})`)
        .join(', ') +
      ` ended without success and the cohort cannot integrate.`
  }

  return {
    route: { ...route, release_run_id: view.release_run_id },
    finished: release?.status === 'succeeded',
    stopped,
    live_runs: liveRuns,
    commands: {
      start_command: view.start_command,
      integrate_command: view.integrate_command,
      record_abandoned_cohort_command: view.record_abandoned_cohort_command,
      release_command: view.release_command,
      manual_commands: [],
    },
  }
}

/**
 * Whether a task's route has finished, what still runs on it, and which
 * cohort commands apply right now. This is the one place that says when a
 * routed task is done, on the chat path and the headless path alike.
 */
export function routeProgress(
  root: string,
  route: HorizonTaskRoute,
): HorizonRouteProgress {
  if (route.failed) {
    return {
      route,
      finished: false,
      stopped: `The plan route did not start: ${route.failed.error}`,
      live_runs: [],
      commands: {
        ...NO_ROUTE_COMMANDS,
        manual_commands: route.failed.manual_commands,
      },
    }
  }

  if (route.kind === 'delivery') {
    const run = readRun(root, route.run_id)

    if (!run) {
      return {
        route,
        finished: false,
        stopped: `The delivery run ${route.run_id ?? '(unknown)'} cannot be read.`,
        live_runs: [],
        commands: NO_ROUTE_COMMANDS,
      }
    }

    return {
      route,
      finished: run.status === 'succeeded',
      stopped:
        run.status === 'failed' || run.status === 'canceled'
          ? `The delivery run ${run.run_id} is '${run.status}'.`
          : null,
      live_runs: TERMINAL_RUN_STATUSES.has(run.status)
        ? []
        : [liveRunView(root, run, 'delivery')],
      commands: NO_ROUTE_COMMANDS,
    }
  }

  if (!route.cohort_id) {
    return {
      route,
      finished: false,
      stopped: 'The cohort route names no cohort session.',
      live_runs: [],
      commands: NO_ROUTE_COMMANDS,
    }
  }

  try {
    return cohortRouteProgress(root, route, cohortStatus(root, route.cohort_id))
  } catch (error) {
    return {
      route,
      finished: false,
      stopped: `The cohort session ${route.cohort_id} cannot be read: ${errorMessage(error)}`,
      live_runs: [],
      commands: NO_ROUTE_COMMANDS,
    }
  }
}

/**
 * Every run the active task holds the supervisor's attention on: its own run
 * while that run is live, then every live run on its route.
 */
export function horizonLiveRuns(
  root: string,
  task: HorizonTask,
): { live_runs: HorizonLiveRun[]; commands: HorizonRouteCommands } {
  const liveRuns: HorizonLiveRun[] = []
  const own = readRun(root, task.run_id)

  if (own && !TERMINAL_RUN_STATUSES.has(own.status)) {
    liveRuns.push(
      liveRunView(root, own, task.status === 'replanning' ? 'replan' : 'task'),
    )
  }

  if (!task.route) {
    return { live_runs: liveRuns, commands: NO_ROUTE_COMMANDS }
  }

  const progress = routeProgress(root, task.route)

  return {
    live_runs: [...liveRuns, ...progress.live_runs],
    commands: progress.commands,
  }
}

/**
 * Take the cohort step the route offers before any run is driven: start the
 * chunks a freed slot allows, or start the release run once every cohort is
 * integrated. Integration itself fires from the lifecycle command that closes
 * the last chunk run, so it is never taken here.
 */
export function advanceRouteCommands(
  root: string,
  progress: HorizonRouteProgress,
): void {
  const route = progress.route

  if (route.kind !== 'cohort' || !route.cohort_id) {
    return
  }

  if (progress.commands.start_command) {
    startCohort(root, route.cohort_id)
  } else if (
    progress.commands.integrate_command ||
    progress.commands.record_abandoned_cohort_command
  ) {
    // The lifecycle command that closed the last chunk normally integrates.
    // When the proof is still missing here, the automatic advance did not
    // fire, and this is the idempotent retry the cohort surface names.
    integrateCohort(root, route.cohort_id)
  } else if (progress.commands.release_command) {
    releaseCohort(root, route.cohort_id)
  }
}

/** Name the first task whose run the harness would still advance. */
export function advancingHorizonRun(
  root: string,
  state: HorizonSessionState,
): { task_id: string; run_id: string } | null {
  for (const task of state.tasks) {
    const run = taskRunState(root, task)

    if (run && ADVANCING_RUN_STATUSES.has(run.status)) {
      return { task_id: task.id, run_id: run.run_id }
    }

    if (task.route && task.status === 'running') {
      const routed = routeProgress(root, task.route).live_runs.find((live) =>
        ADVANCING_RUN_STATUSES.has(live.status),
      )

      if (routed) {
        return { task_id: task.id, run_id: routed.run_id }
      }
    }
  }

  return null
}
