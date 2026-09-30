/**
 * Stage transitions: following a stage outcome to the next stage, or to a
 * terminal state, pause, or limit.
 */

import { invariant } from '../errors.js'
import { finishInboxRequest } from '../inbox.js'
import { recordSuiteProfileIndexEntry } from '../suite-profile.js'
import { panCommand } from '../project-config.js'
import { writeDecision } from '../state.js'
import type { RunState, StageDefinition, StageOutcome } from '../types.js'

import { dirtyWorkspaceExit, persistRun } from './core.js'
import { recordStoppedPrefetches } from './prefetch.js'
import { pauseForLimit } from './limits.js'

/**
 * The stage a successful outcome of `stage` returns to when the stage was
 * entered from another stage's failed entry gate, or undefined when the stage
 * follows its own success transition. Answering the route closes it.
 */
function takeEntryGateReturn(
  state: RunState,
  stage: StageDefinition,
): string | undefined {
  for (const [gateStage, record] of Object.entries(state.entry_gates ?? {})) {
    if (record.routed_to === stage.slug) {
      delete record.routed_to

      return gateStage
    }
  }

  return undefined
}

interface TransitionOptions {
  overrideTarget?: string
  operatorDirected?: boolean
}

/**
 * Moves the run along a stage outcome's transition, or to `overrideTarget`, and
 * updates the transition and consecutive-failure counters. A success returns to
 * the stage whose failed entry gate routed here; a terminal target closes the
 * run (moving the inbox request, recording a dirty workspace exit, stopping
 * prefetch processes); a `paused` target writes a decision record; any other
 * stage resets the left stage's attempt budget and sets `prepare_invocation`.
 * Pauses through the circuit breaker when the transition or consecutive-failure
 * limit is exceeded, unless the move is operator-directed.
 *
 * Mutates the state and may write decision and inbox files, but persists only a
 * `run_ended_dirty` event; the caller persists the transition. Throws
 * `INVALID_TRANSITION` when the stage declares no transition for the outcome.
 */
export function applyTransition(
  root: string,
  state: RunState,
  stage: StageDefinition,
  outcome: StageOutcome,
  options: TransitionOptions = {},
): void {
  state.transition_count += 1
  state.consecutive_failures = options.operatorDirected
    ? 0
    : outcome === 'failure'
      ? state.consecutive_failures + 1
      : 0

  // A stage entered from another stage's failed entry gate returns there on
  // success instead of following its own success transition, so a repair the
  // release gate requested comes straight back to the release gate.
  const entryGateReturn =
    outcome === 'success' && options.overrideTarget === undefined
      ? takeEntryGateReturn(state, stage)
      : undefined
  const target =
    options.overrideTarget ?? entryGateReturn ?? stage.transitions[outcome]

  invariant(target, `Stage '${stage.slug}' has no '${outcome}' transition.`, {
    code: 'INVALID_TRANSITION',
  })

  if (
    !options.operatorDirected &&
    state.transition_count > state.limits.max_total_transitions
  ) {
    pauseForLimit(root, state, 'Maximum workflow transitions exceeded.')
    return
  }

  if (
    !options.operatorDirected &&
    state.consecutive_failures > state.limits.max_consecutive_failures
  ) {
    pauseForLimit(root, state, 'Maximum consecutive failures exceeded.')
    return
  }

  if (target === 'succeeded' || target === 'failed' || target === 'canceled') {
    if (target === 'succeeded' || target === 'canceled') {
      const destination = target === 'succeeded' ? 'complete' : 'canceled'
      const moved = finishInboxRequest(
        root,
        state.request.source_path,
        destination,
        state.request.stored_path,
      )

      if (moved) {
        state.request.source_path = moved
      }
    }

    state.status = target
    state.current_stage = null
    state.pending_action = { type: 'none' }

    const leftBehind = dirtyWorkspaceExit(root, state)

    if (leftBehind) {
      state.dirty_exit = leftBehind
      persistRun(root, state, 'run_ended_dirty', { ...leftBehind })
    }

    recordStoppedPrefetches(root, state)

    // The next run in this workspace compares its own profile against this
    // one. Recording the pointer here is what keeps that comparison from
    // rereading every retained run state.
    if (target === 'succeeded') {
      recordSuiteProfileIndexEntry(root, state)
    }

    return
  }

  if (target === 'paused') {
    // A `blocked` at a release-gated stage used to be marked operator-only
    // under the long-horizon contract, which carried it straight to the
    // session's deferral rung. HORIZON-001 now names four hard blocks and
    // nothing else; a stage's `blocked` is a claim the supervisor tests
    // (revise, set-stage, or a recorded waiver of a cost-backed criterion),
    // not a verdict. The release boundary itself is unchanged: away mode
    // still cannot push, publish, or deploy.
    state.status = 'paused'
    state.pause_reason = `Stage '${stage.slug}' reported ${outcome}.`
    state.pending_action = { type: 'operator_decision' }

    writeDecision(
      root,
      state,
      'Workflow needs operator input',
      state.pause_reason,
      [
        `Resume with: ${panCommand(root)} resume ${state.run_id}`,
        `Or resume with a directive the stage can act on: ${panCommand(root)} ` +
          `resume ${state.run_id} --stage ${stage.slug} --note "<directive>"`,
      ],
    )
    return
  }

  // `max_stage_attempts` bounds retries of a stage, not how many times a run
  // legitimately visits it. Leaving a stage for a different one closes that
  // stage's retry sequence, so a later return starts fresh instead of inheriting
  // a budget already spent on attempts that succeeded. Run-wide looping stays
  // bounded by max_total_transitions, max_consecutive_failures, and same-reason
  // tracking.
  if (target !== stage.slug) {
    delete state.attempts[stage.slug]
    delete state.operator_revisions?.[stage.slug]
  }

  state.status = 'running'
  state.current_stage = target
  state.pending_action = { type: 'prepare_invocation' }
  state.current_invocation = null
}
