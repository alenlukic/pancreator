/**
 * Arbiter and driver interplay: deferral records, scoped replans, succeeded-run
 * settlement, stop arbitration, and the next drivable run.
 */

import path from 'node:path'

import { errorMessage } from '../errors.js'
import type { HeadlessDriverResult } from '../headless-driver.js'
import { appendJsonLine, writeTextAtomic, resolveInside } from '../io.js'
import { pauseRun } from '../engine/pause-resume.js'
import { recordHorizonReplan } from '../engine/run-status.js'
import {
  type HorizonHardBlock,
  type ArbitrateOptions,
  arbitrateHorizonStop,
} from '../horizon-arbiter.js'
import type { RunState } from '../types.js'
import {
  horizonDir,
  now,
  persistHorizonSession,
  type HorizonSessionState,
  type HorizonTask,
  type HorizonTaskRoute,
} from './session.js'
import { transitiveHorizonDependents } from './queue.js'
import { startWorkflowTask, synchronizeLadder } from './next.js'
import {
  ADVANCING_RUN_STATUSES,
  advanceRouteCommands,
  readRun,
  refreshTaskRoute,
  resolveTaskRoute,
  routeProgress,
  taskRunState,
} from './routes.js'

/**
 * Stop a deferred task's run before the session releases its slot.
 *
 * Rung four is reachable from the operator's `defer` escape hatch, where the
 * run is still in flight. Clearing `active_task_id` without stopping it would
 * let the next task open a second run against the same workspace. A run that
 * already rests in a pause keeps it, because its pending action still carries
 * the decision the operator owns.
 */
function stopRunForDeferral(
  root: string,
  task: HorizonTask,
  reason: string,
): void {
  const run = taskRunState(root, task)

  if (!run || !ADVANCING_RUN_STATUSES.has(run.status)) {
    return
  }

  pauseRun(
    root,
    run.run_id,
    `The horizon session deferred this task: ${reason}`,
    {
      actor: 'supervisor',
    },
  )
}

/**
 * Why a task left the session. Only three writers exist: the arbiter naming
 * one of the four hard blocks, the arbiter and its fallback both failing to
 * act (a harness condition, never an operator-owned block), and the
 * operator's own `defer` command. A deferral with no classification is not
 * possible, so a post-run review always knows which authority ended the task.
 */
export type HorizonDeferralClassification =
  | { kind: 'hard_block'; hard_block: HorizonHardBlock; reasoning: string }
  | { kind: 'harness_unrecoverable' }
  | { kind: 'operator' }

export function writeDeferral(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  reason: string,
  evidence: string[],
  classification: HorizonDeferralClassification,
): HorizonSessionState {
  stopRunForDeferral(root, task, reason)
  const dependentIds = transitiveHorizonDependents(state, task.id)
  const record = {
    schema_version: 1,
    task: task.id,
    reason,
    classification,
    rung_history: task.ladder,
    evidence_paths: evidence,
    dependents: dependentIds,
    recorded_at: now(),
  }
  appendJsonLine(
    path.join(horizonDir(root, state.session_id), 'deferred.jsonl'),
    record,
  )
  const inboxPath = path.posix.join(
    'runtime',
    'inbox',
    'queue',
    `horizon-${state.session_id}-${task.id}-deferred.md`,
  )
  writeTextAtomic(
    resolveInside(root, inboxPath),
    `# Deferred horizon task ${task.id}\n\n` +
      `Reason: ${reason}\n\n` +
      `Classification: ${classification.kind}` +
      (classification.kind === 'hard_block'
        ? ` (${classification.hard_block})\n\nArbiter reasoning: ${classification.reasoning}\n\n`
        : '\n\n') +
      `Dependents: ${dependentIds.join(', ') || 'none'}\n\n` +
      `Evidence:\n${evidence.map((item) => `- ${item}`).join('\n')}\n`,
  )

  return {
    ...state,
    // Only the deferred task releases the session. Clearing the slot for a
    // task that is not the active one would let a second run start beside
    // the one still running.
    active_task_id:
      state.active_task_id === task.id ? null : state.active_task_id,
    tasks: state.tasks.map((candidate) => {
      if (candidate.id === task.id) {
        return { ...task, status: 'deferred' }
      }

      if (
        dependentIds.includes(candidate.id) &&
        candidate.status === 'pending'
      ) {
        return { ...candidate, status: 'blocked' }
      }

      return candidate
    }),
  }
}

/**
 * Rung three: start the one scoped planning run for a task whose ladder the
 * engine exhausted, and hold the task on it.
 */
export function startScopedReplan(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState,
): HorizonSessionState {
  const failureRecord = run.horizon_ladder?.failure_record_path as string
  const recorded = recordHorizonReplan(root, run.run_id)
  const replanning = {
    ...synchronizeLadder(task, recorded),
    status: 'replanning' as const,
    result_path: failureRecord,
  }
  const replan = startWorkflowTask(root, state, replanning, 'replan')

  return {
    ...state,
    active_task_id: task.id,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...replanning,
            replan_run_id: replan.run_id,
            run_id: replan.run_id,
          }
        : candidate,
    ),
  }
}

/**
 * Apply one run's terminal success to its task.
 *
 * A re-plan that succeeded returns the task to `pending` so the session
 * reopens it. The task's own run that succeeded finishes the task only when
 * it routed nowhere; when approving its plan started a delivery run or a
 * cohort, the route is recorded and the task stays `running` until the route
 * finishes. A routed run that succeeded finishes the task only when the whole
 * route has. Before routes were tracked, the planning run's success ended the
 * task and orphaned every run it had started.
 */
export function settleSucceededRun(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState,
): HorizonSessionState {
  const replace = (next: HorizonTask): HorizonSessionState => ({
    ...state,
    active_task_id: next.status === 'running' ? state.active_task_id : null,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id ? next : candidate,
    ),
  })

  if (task.status === 'replanning' && run.run_id === task.run_id) {
    return replace({ ...task, status: 'pending', run_id: null })
  }

  const route =
    task.route ??
    (run.run_id === task.run_id ? resolveTaskRoute(root, run) : null)

  if (!route) {
    return replace({ ...task, status: 'succeeded' })
  }

  const progress = routeProgress(root, route)

  if (progress.finished) {
    return replace({ ...task, status: 'succeeded', route: progress.route })
  }

  return replace({ ...task, status: 'running', route: progress.route })
}

/**
 * Put one stop before the arbiter and apply its outcome to the session.
 *
 * This is the only path from a stop to the deferral ledger that the harness
 * itself takes. The arbiter overrides by default; a task defers only when the
 * arbiter names a hard block or when neither it nor its fallback could act.
 * `continued` leaves the task running so the next checkpoint drives the run
 * it just nudged; `restart` returns the task to `pending` so the session
 * reopens it from its stored request.
 */
export function arbitrateTaskStop(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState | null,
  stopReason: string,
  evidence: string[],
  options: ArbitrateOptions,
): HorizonSessionState {
  const outcome = arbitrateHorizonStop(
    root,
    {
      sessionId: state.session_id,
      taskId: task.id,
      taskTitle: task.title,
      run,
      stopReason,
    },
    options,
  )

  switch (outcome.outcome) {
    case 'continued':
      return persistHorizonSession(root, state, 'task_stop_overridden', {
        task_id: task.id,
        run_id: run?.run_id ?? null,
        stop_reason: stopReason,
        action: outcome.action,
        reasoning: outcome.reasoning,
      })
    case 'restart': {
      if (run) {
        stopRunForDeferral(
          root,
          task,
          `restarted by the arbiter: ${stopReason}`,
        )
      }

      const reopened: HorizonTask = {
        ...task,
        status: 'pending',
        run_id: null,
        replan_run_id: null,
      }

      return persistHorizonSession(
        root,
        {
          ...state,
          active_task_id:
            state.active_task_id === task.id ? null : state.active_task_id,
          tasks: state.tasks.map((candidate) =>
            candidate.id === task.id ? reopened : candidate,
          ),
        },
        'task_restarted',
        {
          task_id: task.id,
          run_id: run?.run_id ?? null,
          stop_reason: stopReason,
          reasoning: outcome.reasoning,
        },
      )
    }
    case 'hard_block':
      return writeDeferral(
        root,
        state,
        task,
        `[${outcome.hard_block}] ${stopReason}`,
        evidence,
        {
          kind: 'hard_block',
          hard_block: outcome.hard_block,
          reasoning: outcome.reasoning,
        },
      )
    case 'harness_unrecoverable':
      return writeDeferral(root, state, task, outcome.reason, evidence, {
        kind: 'harness_unrecoverable',
      })
    default:
      return state
  }
}

export function reconcileDrivenTask(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  driven: HeadlessDriverResult,
  options: ArbitrateOptions = {},
): HorizonSessionState {
  const run = driven.state
  task = synchronizeLadder(task, run)

  if (driven.stop.type === 'terminal' && driven.stop.status === 'succeeded') {
    return settleSucceededRun(root, state, task, run)
  }

  const operatorOnly =
    driven.stop.type === 'operator_pause' && driven.stop.operator_only
  const ladderExhausted = run.horizon_ladder?.pause_kind === 'ladder_exhausted'

  if (ladderExhausted && task.ladder.replans_spent === 0) {
    if (!run.horizon_ladder?.failure_record_path) {
      return arbitrateTaskStop(
        root,
        state,
        task,
        run,
        driven.handoff_reason ?? 'ladder exhausted',
        [],
        options,
      )
    }

    return startScopedReplan(root, state, task, run)
  }

  if (operatorOnly || ladderExhausted || driven.stop.type === 'terminal') {
    return arbitrateTaskStop(
      root,
      state,
      task,
      run,
      driven.handoff_reason ?? run.pause_reason ?? 'task could not continue',
      [
        ...(run.horizon_ladder?.failure_record_path
          ? [run.horizon_ladder.failure_record_path]
          : []),
      ],
      options,
    )
  }

  return state
}

/**
 * Convert a gate pause the headless session cannot clear into the fourth rung.
 *
 * `reconcileDrivenTask` keys rung four on an operator-only stop, and the
 * session arbiter is the only supervisor a headless session has. Letting an
 * ordinary gate pause escape the checkpoint ends the whole session instead of
 * the one task it belongs to.
 */
export function operatorOnlyStop(
  driven: HeadlessDriverResult,
  reason: string,
): HeadlessDriverResult {
  return {
    ...driven,
    handoff_reason: reason,
    stop: {
      type: 'operator_pause',
      action: 'operator_decision',
      stage: driven.state.current_stage ?? 'unknown',
      operator_only: true,
      reason,
    },
  }
}

/**
 * Which run the headless driver advances next for a task, after taking any
 * cohort step the route offers. A task without a route drives its own run.
 * A routed task drives the first live run on the route; when nothing is live
 * the route is either finished, stopped on a failed run the arbiter has to
 * reason about, or waiting on a step nothing here can take.
 */
export function nextDrivableRun(
  root: string,
  task: HorizonTask,
):
  | { kind: 'run'; run_id: string }
  | { kind: 'finished'; route: HorizonTaskRoute }
  | {
      kind: 'stopped'
      route: HorizonTaskRoute
      reason: string
      run_id: string | null
    } {
  if (!task.route) {
    return { kind: 'run', run_id: task.run_id as string }
  }

  let progress = routeProgress(root, task.route)

  if (progress.finished) {
    return { kind: 'finished', route: progress.route }
  }

  if (progress.live_runs.length === 0 && !progress.stopped) {
    try {
      advanceRouteCommands(root, progress)
    } catch (error) {
      return {
        kind: 'stopped',
        route: progress.route,
        reason: `The cohort step did not apply: ${errorMessage(error)}`,
        run_id: null,
      }
    }

    progress = routeProgress(root, refreshTaskRoute(root, progress.route))

    if (progress.finished) {
      return { kind: 'finished', route: progress.route }
    }
  }

  const live = progress.live_runs[0]

  if (live) {
    return { kind: 'run', run_id: live.run_id }
  }

  const failing =
    progress.route.kind === 'delivery'
      ? progress.route.run_id
      : (readRun(root, progress.route.release_run_id)?.run_id ?? null)

  return {
    kind: 'stopped',
    route: progress.route,
    reason:
      progress.stopped ??
      'The route has no live run, is not finished, and offers no step.',
    run_id: failing,
  }
}
