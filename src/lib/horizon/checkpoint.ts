/** Session checkpoint and reconcile. */

import { errorMessage } from '../errors.js'
import { type HeadlessDriverResult, driveRun } from '../headless-driver.js'
import { withOperationMutex } from '../io.js'
import { getRunState } from '../engine.js'
import type { ArbitrateOptions } from '../horizon-arbiter.js'
import {
  fail,
  loadHorizonSession,
  mutexPath,
  persistHorizonSession,
  writeHandoff,
  type HorizonLiveRun,
  type HorizonRouteCommands,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'
import {
  sessionTerminalState,
  skipBlockedDependents,
  synchronizeLadder,
} from './next.js'
import {
  NO_ROUTE_COMMANDS,
  advanceRouteCommands,
  horizonLiveRuns,
  readRun,
  refreshTaskRoute,
  routeProgress,
} from './routes.js'
import {
  arbitrateTaskStop,
  nextDrivableRun,
  operatorOnlyStop,
  reconcileDrivenTask,
  settleSucceededRun,
  startScopedReplan,
} from './driver.js'

/** Drive the active workflow task and persist its resulting session transition. */
export function checkpointHorizonSession(
  root: string,
  sessionId: string,
  options: ArbitrateOptions = {},
): { session: HorizonSessionState; driven: HeadlessDriverResult } {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find(
      (candidate) => candidate.id === state.active_task_id,
    )

    if (!task?.run_id) {
      fail(`Horizon session '${sessionId}' has no active workflow task.`)
    }

    const target = nextDrivableRun(root, task)
    let driven: HeadlessDriverResult

    if (target.kind === 'finished') {
      const own = getRunState(root, task.run_id)

      state = settleSucceededRun(
        root,
        state,
        { ...task, route: target.route },
        own,
      )
      driven = {
        state: own,
        stop: { type: 'terminal', status: 'succeeded' },
        handoff_reason: 'the route finished',
        steps: 0,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: null,
      }
    } else if (target.kind === 'stopped') {
      const failing =
        readRun(root, target.run_id) ?? getRunState(root, task.run_id)

      state = arbitrateTaskStop(
        root,
        state,
        { ...task, route: target.route },
        failing,
        target.reason,
        [],
        options,
      )
      driven = {
        state: failing,
        stop: {
          type: 'operator_pause',
          action: 'operator_decision',
          stage: failing.current_stage ?? 'unknown',
          operator_only: true,
          reason: target.reason,
        },
        handoff_reason: target.reason,
        steps: 0,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: null,
      }
    } else {
      driven = driveRun(root, target.run_id, {
        attestSupervisorCard: state.preflight.card_attestation_authorized,
        attestedBy: `horizon:${sessionId}`,
      })

      if (
        driven.stop.type === 'operator_pause' &&
        !driven.stop.operator_only &&
        // The session owns rungs three and four for its own typed pause.
        driven.state.horizon_ladder?.pause_kind !== 'ladder_exhausted'
      ) {
        driven = operatorOnlyStop(
          driven,
          `The run waits for a supervisor away-mode decision: ${driven.handoff_reason ?? driven.stop.reason}`,
        )
      }

      state = reconcileDrivenTask(root, state, task, driven, options)
    }

    const transitioned = state.active_task_id === null

    if (transitioned) {
      state = writeHandoff(
        root,
        sessionTerminalState(skipBlockedDependents(state)),
        state.tasks.find((candidate) => candidate.id === task.id)?.status ??
          'finished',
        task.id,
      )
    }
    return {
      session: persistHorizonSession(root, state, 'task_checkpointed', {
        task_id: task.id,
        run_id: driven.state.run_id,
        stop: driven.stop.type,
      }),
      driven,
    }
  })
}

export interface HorizonReconcileResult {
  session: HorizonSessionState
  task: HorizonTask | null
  /** The task finished or left the session during this reconcile. */
  transitioned: boolean
  live_runs: HorizonLiveRun[]
  commands: HorizonRouteCommands
  /**
   * A route condition the supervisor has to reason about: a failed delivery
   * or release run, a route that never started, or a cohort that cannot
   * integrate. Null while runs are live or the route is progressing.
   */
  stopped: string | null
}

/**
 * Reconcile the active task for a live supervisor, without driving anything.
 *
 * The chat supervisor advances runs itself with the ordinary lifecycle
 * commands. After every wake it calls this to let the harness apply what is
 * mechanical: synchronize the ladder, start the one scoped re-plan when the
 * engine exhausted the ladder, record the route a plan approval opened, take
 * the cohort step a route offers, and finish the task when its route has
 * finished. Everything else is returned as the live runs and the stop the
 * supervisor reasons about. This function never writes a deferral: under
 * HORIZON-001 only the supervisor, naming a hard block, can.
 */
export function reconcileHorizonSession(
  root: string,
  sessionId: string,
): HorizonReconcileResult {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const active = state.tasks.find(
      (candidate) => candidate.id === state.active_task_id,
    )

    if (!active?.run_id) {
      return {
        session: state,
        task: null,
        transitioned: false,
        live_runs: [],
        commands: NO_ROUTE_COMMANDS,
        stopped: null,
      }
    }

    const own = getRunState(root, active.run_id)
    let task = synchronizeLadder(active, own)
    let stopped: string | null = null

    if (own.status === 'succeeded') {
      state = settleSucceededRun(root, state, task, own)
    } else if (
      own.horizon_ladder?.pause_kind === 'ladder_exhausted' &&
      task.ladder.replans_spent === 0 &&
      own.horizon_ladder.failure_record_path &&
      task.status !== 'replanning'
    ) {
      state = startScopedReplan(root, state, task, own)
    }

    task = state.tasks.find((candidate) => candidate.id === active.id) ?? task

    if (task.status === 'running' && task.route) {
      let progress = routeProgress(root, task.route)

      if (
        !progress.finished &&
        progress.live_runs.length === 0 &&
        !progress.stopped
      ) {
        try {
          advanceRouteCommands(root, progress)
          progress = routeProgress(root, refreshTaskRoute(root, progress.route))
        } catch (error) {
          stopped = `The cohort step did not apply: ${errorMessage(error)}`
        }
      }

      if (progress.finished) {
        state = settleSucceededRun(
          root,
          state,
          { ...task, route: progress.route },
          own,
        )
      } else {
        stopped = stopped ?? progress.stopped
        state = {
          ...state,
          tasks: state.tasks.map((candidate) =>
            candidate.id === task.id
              ? { ...candidate, route: progress.route }
              : candidate,
          ),
        }
      }

      task = state.tasks.find((candidate) => candidate.id === active.id) ?? task
    }

    const transitioned = state.active_task_id === null

    if (transitioned) {
      state = writeHandoff(
        root,
        sessionTerminalState(skipBlockedDependents(state)),
        task.status,
        task.id,
      )
    }

    state = persistHorizonSession(root, state, 'task_reconciled', {
      task_id: task.id,
      run_id: task.run_id,
      status: task.status,
      route: task.route ?? null,
      transitioned,
    })

    const live = transitioned
      ? { live_runs: [], commands: NO_ROUTE_COMMANDS }
      : horizonLiveRuns(root, task)

    return {
      session: state,
      task,
      transitioned,
      live_runs: live.live_runs,
      commands: live.commands,
      stopped: transitioned ? null : stopped,
    }
  })
}
