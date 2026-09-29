import { randomUUID } from 'node:crypto'

import {
  appendSupervisorDecision,
  awayModeTrigger,
  openOperatorQuestion,
  type SupervisorDecisionRecord,
} from './away-mode.js'
import {
  decideRunAsAway,
  resumeRunAsAway,
  setRunStageAsAway,
  waiveGate,
} from './engine.js'
import { errorMessage, invariant, PanError } from './errors.js'
import { resolveRunLayout } from './run-layout.js'
import type { AwayModeAction, RunState } from './types.js'

const NOTE_MAX = 3_000

function bounded(text: string): string {
  return text.length <= NOTE_MAX
    ? text
    : `${text.slice(0, NOTE_MAX)}\n[truncated]`
}

function required(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

export interface DecideAwayRequest {
  action: string
  note: string | null
  stage?: string | null
}

/**
 * Apply one supervisor away-mode decision to the run, append the immutable
 * ledger record, and return the updated run state.
 *
 * Refusals throw a `PanError`, write no ledger record, and leave the run state
 * unchanged. They run in this order:
 *   1. Away mode disabled (`AWAY_MODE_DISABLED`)
 *   2. Open operator question (`AWAY_OPERATOR_QUESTION_OPEN`)
 *   3. No permitted blocker (`AWAY_TRIGGER_UNAVAILABLE`)
 *   4. Action outside allowed_actions (`AWAY_ACTION_FORBIDDEN`)
 *   5. Missing or empty note (`INVALID_ARGUMENT`)
 *   6. `set-stage` without `--stage` (`INVALID_ARGUMENT`)
 */
export function decideAwayAsSupervisor(
  root: string,
  state: RunState,
  request: DecideAwayRequest,
  recordedAt = new Date().toISOString(),
): { state: RunState; record: SupervisorDecisionRecord } {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })

  const question = openOperatorQuestion(root, state)

  if (question) {
    throw new PanError(
      `An unanswered operator question stands on this run: ${question}`,
      { code: 'AWAY_OPERATOR_QUESTION_OPEN' },
    )
  }

  const blocker = awayModeTrigger(state, root)

  if (!blocker) {
    throw new PanError('The run has no blocker that away mode can clear.', {
      code: 'AWAY_TRIGGER_UNAVAILABLE',
    })
  }

  const action = request.action
  const allowedActions = awayMode.guardrails.allowed_actions

  if (
    typeof action !== 'string' ||
    !allowedActions.includes(action as AwayModeAction)
  ) {
    throw new PanError(
      `Action '${action}' is outside operator guardrails. Allowed: ${allowedActions.join(', ')}.`,
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )
  }

  const note = request.note

  if (!note || note.trim().length === 0) {
    throw new PanError(
      '--note or --note-file is required for pan away decide.',
      { code: 'INVALID_ARGUMENT' },
    )
  }

  if (action === 'set-stage' && !request.stage) {
    throw new PanError('--stage is required for set-stage.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const boundedNote = bounded(note)

  // Resolve evidence references: run state and last stage output.
  const layout = resolveRunLayout(root, state.run_id)
  const evidenceReferences = [
    layout.state.relative,
    state.stage_history.at(-1)?.output_path,
  ].filter((item): item is string => typeof item === 'string')

  // Apply the action through the existing engine functions.
  let next: RunState
  let applyError: string | undefined

  try {
    switch (action as AwayModeAction) {
      case 'approve':
      case 'reject':
      case 'revise':
        next = decideRunAsAway(
          root,
          state.run_id,
          action as AwayModeAction,
          boundedNote,
        )
        break
      case 'resume': {
        const stage = request.stage ?? state.current_stage

        if (state.status !== 'paused' && stage) {
          next = setRunStageAsAway(root, state.run_id, stage, boundedNote)
        } else {
          next = resumeRunAsAway(
            root,
            state.run_id,
            stage ?? undefined,
            boundedNote,
          )
        }
        break
      }
      case 'set-stage':
        next = setRunStageAsAway(
          root,
          state.run_id,
          required(request.stage, 'stage'),
          boundedNote,
        )
        break
      case 'waive-gate':
        next = waiveGate(root, state.run_id, {
          note: boundedNote,
          actor: 'away',
        }).state
        break
      default:
        throw new PanError(`Unsupported away action: ${String(action)}`, {
          code: 'AWAY_ACTION_FORBIDDEN',
        })
    }
  } catch (error) {
    applyError = errorMessage(error)

    // Build a failed record and append it, then rethrow.
    const failedRecord: SupervisorDecisionRecord = {
      schema_version: 1,
      decision_id: randomUUID(),
      author: 'supervisor',
      run_id: state.run_id,
      invocation_id: state.current_invocation?.id ?? null,
      blocker,
      action: action as AwayModeAction,
      ...(request.stage ? { stage: request.stage } : {}),
      reason: boundedNote,
      guardrails: { allowed_actions: [...allowedActions] as AwayModeAction[] },
      result: 'failed',
      error: bounded(applyError),
      evidence_references: evidenceReferences,
      recorded_at: recordedAt,
    }

    appendSupervisorDecision(root, failedRecord)

    throw error
  }

  const record: SupervisorDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    author: 'supervisor',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker,
    action: action as AwayModeAction,
    ...(request.stage ? { stage: request.stage } : {}),
    reason: boundedNote,
    guardrails: { allowed_actions: [...allowedActions] as AwayModeAction[] },
    result: 'applied',
    evidence_references: evidenceReferences,
    recorded_at: recordedAt,
  }

  appendSupervisorDecision(root, record)

  return { state: next, record }
}
