/**
 * The failure ladder a failed stage outcome climbs before its plain failure
 * transition: the long-horizon retry, route, and strategy rungs, and the
 * same-reason pause. A worker submission and a harness-recorded failure both
 * route through it, so neither can loop past the limits the other honours.
 */

import { runHasContract } from '../operator-involvement.js'
import type { RunState, StageDefinition } from '../types.js'

import {
  classifyHorizonFailure,
  isSameReasonTrackedStage,
  pauseForHorizonLadder,
  pauseForSameReasonFailure,
  recordSameReasonFailure,
} from './limits.js'
import { recordOperatorFeedback } from './recovery.js'
import { applyTransition } from './transition.js'

/**
 * Applies the failure ladder to a failed outcome with the given hard-failure
 * signature. Returns the next state when a rung handled the failure, or null
 * when the caller still owns the transition (no ladder applies to the run, or
 * a tracked failure has not yet repeated).
 */
export function routeLadderedFailure(
  root: string,
  state: RunState,
  stage: StageDefinition,
  signature: string[],
): { nextState: string | null } | null {
  if (runHasContract(state.operator_involvement, 'long_horizon')) {
    const action = classifyHorizonFailure(state, stage, signature)

    if (action.kind === 'retry') {
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: stage.slug,
      })

      return { nextState: state.current_stage }
    }

    if (action.kind === 'route') {
      applyTransition(root, state, stage, 'failure')

      return { nextState: state.current_stage }
    }

    if (action.kind === 'strategy') {
      recordOperatorFeedback(
        root,
        state,
        stage,
        action.target,
        'revise',
        state.horizon_ladder?.directive ??
          'Change strategy and do not repeat the prior approach.',
        'away',
      )
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: action.target,
      })

      return { nextState: state.current_stage }
    }

    pauseForHorizonLadder(root, state, stage, signature, action.reason)

    return { nextState: 'paused' }
  }

  if (
    isSameReasonTrackedStage(stage) &&
    recordSameReasonFailure(state, stage.slug, signature)
  ) {
    pauseForSameReasonFailure(root, state, stage)

    return { nextState: 'paused' }
  }

  return null
}
