/** Operator task deferral and reinstatement, and session abandonment. */

import { withOperationMutex } from '../io.js'
import {
  type HorizonHardBlock,
  appendArbiterRecord,
  type ArbiterAction,
  applyArbiterAction,
} from '../horizon-arbiter.js'
import {
  fail,
  loadHorizonSession,
  mutexPath,
  persistHorizonSession,
  writeHandoff,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'
import { transitiveHorizonDependents } from './queue.js'
import { sessionTerminalState, skipBlockedDependents } from './next.js'
import { taskRunState } from './routes.js'
import { writeDeferral, type HorizonDeferralClassification } from './driver.js'

/**
 * Who is deferring, and on what authority.
 *
 * A supervisor defers only by naming the hard block it confirmed; the reason
 * it gives becomes the arbiter reasoning on the record. The operator's own
 * directive needs no hard block, because the operator defines the objective
 * the hard blocks protect. A deferral with neither is refused: under
 * HORIZON-001 no one else may end a task.
 */
export type HorizonDeferralAuthority =
  | { kind: 'hard_block'; hard_block: HorizonHardBlock }
  | { kind: 'operator_directive' }

export function deferHorizonTask(
  root: string,
  sessionId: string,
  taskId: string,
  reason: string,
  evidence: string[] = [],
  authority: HorizonDeferralAuthority = { kind: 'operator_directive' },
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find((candidate) => candidate.id === taskId)

    if (!task) {
      fail(`Unknown horizon task: ${taskId}`)
    }

    if (reason.trim().length === 0) {
      fail('Deferring a task requires a non-empty reason.')
    }

    const classification: HorizonDeferralClassification =
      authority.kind === 'hard_block'
        ? {
            kind: 'hard_block',
            hard_block: authority.hard_block,
            reasoning: reason,
          }
        : { kind: 'operator' }
    const recordedReason =
      authority.kind === 'hard_block'
        ? `[${authority.hard_block}] ${reason}`
        : reason

    if (authority.kind === 'hard_block') {
      appendArbiterRecord(root, {
        session_id: sessionId,
        task_id: taskId,
        run_id: task.run_id,
        stop_reason: 'supervisor deferral',
        round: 0,
        verdict: {
          verdict: 'hard_block',
          hard_block: authority.hard_block,
          reasoning: reason,
        },
        result: 'hard_block',
        exchange_path: null,
        actor: 'supervisor',
      })
    }

    state = writeDeferral(
      root,
      state,
      task,
      recordedReason,
      evidence,
      classification,
    )
    state = writeHandoff(root, sessionTerminalState(state), 'deferred', taskId)
    return persistHorizonSession(root, state, 'task_deferred', {
      task_id: taskId,
      reason: recordedReason,
      classification,
    })
  })
}

/**
 * Reinstate a deferred task on the supervisor's own reasoning.
 *
 * A deferral record names which authority ended the task. When the
 * supervisor reading the post-run record does not confirm the hard block, or
 * finds a harness failure, this is the override: the action applies to the
 * task's run (or the task reopens from its request), its dependents come back
 * to `pending`, and the session returns to `running` so `horizon start`
 * drives it again. The decision and its reasoning join the arbiter ledger
 * under the `supervisor` actor.
 */
export function reinstateHorizonTask(
  root: string,
  sessionId: string,
  taskId: string,
  action: ArbiterAction,
  reasoning: string,
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find((candidate) => candidate.id === taskId)

    if (!task) {
      fail(`Unknown horizon task: ${taskId}`)
    }

    if (task.status !== 'deferred' && task.status !== 'failed') {
      fail(
        `Horizon task '${taskId}' is '${task.status}'; only a deferred or failed task can be reinstated.`,
      )
    }

    if (reasoning.trim().length === 0) {
      fail(
        'Reinstating a task requires --reason with the supervisor reasoning.',
      )
    }

    if (state.active_task_id && state.active_task_id !== taskId) {
      fail(
        `Horizon session '${sessionId}' already runs task '${state.active_task_id}'.`,
      )
    }

    const run = taskRunState(root, task)
    const runAcceptsAction =
      run !== null && run.status !== 'succeeded' && run.status !== 'failed'
    const restart = action.type === 'restart-task' || !runAcceptsAction

    if (!restart && run) {
      applyArbiterAction(root, run, action, reasoning)
    }

    appendArbiterRecord(root, {
      session_id: sessionId,
      task_id: taskId,
      run_id: run?.run_id ?? null,
      stop_reason: 'supervisor reinstatement of a deferred task',
      round: 0,
      verdict: { verdict: 'override', action, reasoning },
      result: 'applied',
      exchange_path: null,
      actor: 'supervisor',
    })

    const dependentIds = transitiveHorizonDependents(state, taskId)
    const reinstated: HorizonTask = restart
      ? { ...task, status: 'pending', run_id: null, replan_run_id: null }
      : { ...task, status: 'running' }

    state = {
      ...state,
      status: 'running',
      active_task_id: restart ? null : taskId,
      tasks: state.tasks.map((candidate) => {
        if (candidate.id === taskId) {
          return reinstated
        }

        if (
          dependentIds.includes(candidate.id) &&
          candidate.status === 'blocked'
        ) {
          return { ...candidate, status: 'pending' }
        }

        return candidate
      }),
    }
    // A dependent whose other dependency is still deferred goes back to
    // `blocked` here, so only the work this reinstatement actually frees
    // becomes eligible.
    state = skipBlockedDependents(state)
    state = writeHandoff(root, state, 'reinstated', taskId)

    return persistHorizonSession(root, state, 'task_reinstated', {
      task_id: taskId,
      run_id: run?.run_id ?? null,
      action,
      reasoning,
    })
  })
}

export function abandonHorizonSession(
  root: string,
  sessionId: string,
  reason: string,
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    const state = loadHorizonSession(root, sessionId)
    const abandoned = writeHandoff(
      root,
      { ...state, status: 'abandoned', active_task_id: null },
      'abandoned',
      state.active_task_id,
    )
    return persistHorizonSession(root, abandoned, 'session_abandoned', {
      reason,
    })
  })
}
