/**
 * Aborting a run, reading its status, and recording a long-horizon replan.
 */

import { invariant } from '../errors.js'
import { withOperationMutex } from '../io.js'
import { finishInboxRequest } from '../inbox.js'
import { buildSuiteProfileSummary } from '../suite-profile.js'
import { registryHealthForRun } from '../hypervisor.js'
import { runHasContract } from '../operator-involvement.js'
import { renderStatus } from '../render.js'
import { operationMutexPath, loadState } from '../state.js'
import type { RunState } from '../types.js'
import { loadInvocationValidationStatus } from '../validation.js'

import { dirtyWorkspaceExit, persistRun } from './core.js'
import { recordStoppedPrefetches } from './prefetch.js'

interface StatusOptions {
  json?: boolean
}

export function abortRun(root: string, runId: string, note = ''): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    const moved = finishInboxRequest(
      root,
      state.request.source_path,
      'canceled',
      state.request.stored_path,
    )

    if (moved) {
      state.request.source_path = moved
    }

    state.status = 'canceled'
    state.current_stage = null
    state.pending_action = { type: 'none' }
    state.current_invocation = null
    state.operator_pause = null

    const leftBehind = dirtyWorkspaceExit(root, state)

    if (leftBehind) {
      state.dirty_exit = leftBehind
    }

    persistRun(root, state, 'run_canceled', {
      note,
      ...(leftBehind ? { dirty_exit: leftBehind } : {}),
    })
    recordStoppedPrefetches(root, state)

    return state
  })
}

export function getRunStatus(
  root: string,
  runId: string,
  options: StatusOptions = {},
): RunState | string {
  const state = loadState(root, runId)
  const health = registryHealthForRun(root, runId, state.current_invocation?.id)
  const statusState = health ? { ...state, agent_health: health } : state

  if (options.json) {
    return statusState
  }

  const validationStatus = state.current_invocation
    ? loadInvocationValidationStatus(root, runId, state.current_invocation.id)
    : null

  return renderStatus(
    statusState,
    validationStatus,
    buildSuiteProfileSummary(root, state),
  )
}

export function getRunState(root: string, runId: string): RunState {
  return loadState(root, runId)
}

/** Record the session-owned re-plan rung on the task run. */
export function recordHorizonReplan(root: string, runId: string): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      runHasContract(state.operator_involvement, 'long_horizon'),
      `Run '${runId}' does not carry the long_horizon contract.`,
      { code: 'HORIZON_CONTRACT_REQUIRED' },
    )

    const ladder = (state.horizon_ladder ??= {
      retries_spent: 0,
      strategy_switches_spent: 0,
      replans_spent: 0,
      last_failure_signature: [],
      approaches_tried: [],
    })
    ladder.replans_spent += 1
    ladder.approaches_tried.push(`scoped re-plan ${ladder.replans_spent}`)

    persistRun(root, state, 'horizon_replan_started', {
      session_id: state.horizon?.session_id ?? null,
      task_id: state.horizon?.task_id ?? null,
      replans_spent: ladder.replans_spent,
      failure_record_path: ladder.failure_record_path ?? null,
    })

    return state
  })
}
