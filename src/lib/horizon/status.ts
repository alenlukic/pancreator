/** Session status and the latest handoff. */

import { readJson, resolveInside } from '../io.js'
import { getRunState } from '../engine/run-status.js'
import { panCommand } from '../project-config.js'
import {
  loadHorizonSession,
  type HorizonLiveRun,
  type HorizonRouteCommands,
  type HorizonSessionState,
} from './session.js'
import { eligibleHorizonTask } from './queue.js'
import { synchronizeLadder } from './next.js'
import { NO_ROUTE_COMMANDS, horizonLiveRuns } from './routes.js'

export interface HorizonStatusView extends HorizonSessionState {
  /**
   * Every run the active task holds the supervisor's attention on, each with
   * its bootstrap command set, so the supervisor rebuilds nothing by hand.
   */
  live_runs: HorizonLiveRun[]
  /** Cohort commands the active task's route offers right now. */
  route_commands: HorizonRouteCommands
  /** The next session command a supervisor takes, in the harness's vocabulary. */
  next_command: string | null
}

/**
 * Builds the read-only status view of a horizon session: tasks with ladders
 * synchronized from their runs, the active task's live runs and cohort route
 * commands, and the next session command, which is null unless the session is
 * running.
 */
export function horizonStatus(
  root: string,
  sessionId: string,
): HorizonStatusView {
  const state = loadHorizonSession(root, sessionId)
  const tasks = state.tasks.map((task) => {
    if (!task.run_id) {
      return task
    }

    try {
      return synchronizeLadder(task, getRunState(root, task.run_id))
    } catch {
      return task
    }
  })
  const active = tasks.find((task) => task.id === state.active_task_id)
  const live = active
    ? horizonLiveRuns(root, active)
    : { live_runs: [], commands: NO_ROUTE_COMMANDS }
  const pan = panCommand(root)
  const nextCommand =
    state.status !== 'running'
      ? null
      : active
        ? `${pan} horizon reconcile ${sessionId} --json`
        : eligibleHorizonTask({ ...state, tasks })
          ? `${pan} horizon next ${sessionId} --json`
          : null

  return {
    ...state,
    tasks,
    live_runs: live.live_runs,
    route_commands: live.commands,
    next_command: nextCommand,
  }
}

/**
 * Reads the latest handoff record of a horizon session, or returns null when
 * the session has none. Throws `INVALID_HORIZON_STATE` for an unknown session.
 */
export function latestHorizonHandoff(
  root: string,
  sessionId: string,
): unknown | null {
  const state = loadHorizonSession(root, sessionId)
  return state.latest_handoff
    ? readJson(resolveInside(root, state.latest_handoff))
    : null
}
