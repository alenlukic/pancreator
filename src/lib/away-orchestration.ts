import path from 'node:path'

import {
  awayEvaluatorFailureLimitError,
  awayEvaluatorPrompt,
  countAwayDecisions,
  countAwayEvaluatorFailures,
  parseAwayOptions,
  recordAwayEvaluation,
  recordAwayEvaluationFailure,
  recordAwayEvaluatorExchange,
  openOperatorQuestion,
  recordDeterministicShipApproval,
  recordOperatorQuestionRefusal,
  type AwayBlocker,
  type AwayDecisionRecord,
} from './away-mode.js'
import {
  decideRunAsAway,
  resumeRunAsAway,
  setRunStageAsAway,
  waiveGate,
} from './engine.js'
import { errorMessage, PanError } from './errors.js'
import { runCursorAgentJson } from './executors/cursor-agent.js'
import { hypervisorEventsPath } from './hypervisor.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
} from './pipeline-config.js'
import { resolveRunLayout } from './run-layout.js'
import type { RunState } from './types.js'

/**
 * One away-mode evaluation and one away-mode application, shared by every
 * caller that drives a blocked run without an operator.
 *
 * The CLI and the long-horizon session both reach a pause the same way, so
 * they resolve it through one implementation. A second copy diverged on the
 * snapshotted hypervisor model, the resolved event path, and the guardrail
 * pre-checks before this module existed.
 */

function required(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

export interface AwayEvaluationOptions {
  runEvaluator?: typeof runCursorAgentJson
  recordedAt?: () => string
}

/** The hypervisor model the run snapshotted, never a later configuration edit. */
export function hypervisorModelForRun(root: string, state: RunState): string {
  if (state.pipeline_config) {
    const snapshot = loadPipelineConfigSnapshot(
      root,
      state.pipeline_config.path,
    )
    const model = snapshot.personas.hypervisor

    if (model) {
      return model
    }
  }

  const model = loadPipelineConfig(root).config.personas.hypervisor

  if (!model) {
    throw new PanError(
      "Pipeline configuration does not map persona 'hypervisor'.",
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
  }

  return model
}

export function applyAwayDecision(
  root: string,
  state: RunState,
  decision: AwayDecisionRecord,
): RunState {
  const selected = decision.selected_action

  if (!selected) {
    throw new PanError('The away decision selected no action.', {
      code: 'AWAY_DECISION_NOT_APPLICABLE',
    })
  }

  switch (selected.action) {
    case 'approve':
    case 'reject':
    case 'revise':
      return decideRunAsAway(
        root,
        state.run_id,
        selected.action,
        selected.note ?? selected.rationale,
      )
    case 'resume': {
      const stage = selected.stage ?? state.current_stage
      const note = selected.note ?? selected.rationale

      // The evaluator ranks `resume` to mean "re-attempt the stage". Only a
      // paused run can literally resume; a run awaiting the operator reaches
      // the same re-attempt through an away-authored stage set. Failing here
      // instead turned a sound ranking into a deferred task (HORIZON-001).
      if (state.status !== 'paused' && stage) {
        return setRunStageAsAway(root, state.run_id, stage, note)
      }

      return resumeRunAsAway(root, state.run_id, stage, note)
    }
    case 'set-stage':
      return setRunStageAsAway(
        root,
        state.run_id,
        required(selected.stage, 'selected stage'),
        selected.note ?? selected.rationale,
      )
    case 'waive-gate':
      // The note is the directive, and `selectAwayOption` already refused an
      // option that carries none. The waiver is recorded with away
      // authorship, so nothing in the record claims the operator wrote it.
      return waiveGate(root, state.run_id, {
        note: required(selected.note, 'selected note'),
        actor: 'away',
      }).state
    default:
      throw new PanError(
        `Unsupported away action: ${String(selected.action)}`,
        { code: 'AWAY_DECISION_NOT_APPLICABLE' },
      )
  }
}

export function evaluateAwayState(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  options: AwayEvaluationOptions = {},
): AwayDecisionRecord {
  // Every caller that can reach the evaluator reaches it through this
  // function, so the operator-question refusal sits here rather than at each
  // call site, where the next caller would have to remember it.
  //
  // The refusal reads the run rather than the blocker class. A question
  // stands against the run, and the trigger reports one class at a time, so
  // keying the refusal to `operator_question` alone would let a hypervisor
  // incident or a pending approval carry the same gate into a ranking.
  const question = openOperatorQuestion(root, state)

  if (question) {
    return recordOperatorQuestionRefusal(
      root,
      state,
      blocker,
      question,
      options.recordedAt?.(),
    )
  }

  if (
    blocker.type === 'operator_approval' &&
    blocker.stage === 'ship' &&
    state.pending_action.type === 'operator_approval' &&
    (state.pending_action.outcome ?? 'success') === 'success'
  ) {
    const evidenceReferences = [
      resolveRunLayout(root, state.run_id).state.relative,
      state.stage_history.at(-1)?.output_path,
    ].filter((item): item is string => typeof item === 'string')

    return recordDeterministicShipApproval(root, state, evidenceReferences)
  }

  // The ledger append re-checks the limit under its lock. This pre-check only
  // skips a model evaluation whose record could never be persisted.
  const budget = state.away_mode?.guardrails.max_decisions_per_run ?? 0

  if (countAwayDecisions(root, state.run_id) >= budget) {
    throw new PanError(
      'The away-mode decision limit for this run is exhausted.',
      { code: 'AWAY_DECISION_LIMIT' },
    )
  }

  const evaluatorFailures = countAwayEvaluatorFailures(root, state.run_id)

  if (evaluatorFailures >= budget) {
    throw awayEvaluatorFailureLimitError(root, state, evaluatorFailures, budget)
  }

  const prompt = awayEvaluatorPrompt(root, state, blocker, {
    hypervisorEventsPath: path
      .relative(root, hypervisorEventsPath(root))
      .split(path.sep)
      .join('/'),
  })
  const runEvaluator = options.runEvaluator ?? runCursorAgentJson
  const recordedAt = options.recordedAt ?? (() => new Date().toISOString())
  const evidenceReferences: string[] = []

  for (let attempt = 1; attempt <= 2; attempt++) {
    const evaluation = runEvaluator({
      cwd: root,
      installationRoot: root,
      model: hypervisorModelForRun(root, state),
      prompt,
    })
    let parseError: string | undefined

    if (evaluation.ok && evaluation.value !== undefined) {
      try {
        parseAwayOptions(evaluation.value)
      } catch (error) {
        parseError = errorMessage(error)
      }
    }

    const transportError =
      !evaluation.ok || evaluation.value === undefined
        ? (evaluation.error ?? 'The away evaluator returned no decision.')
        : undefined
    const evidenceReference = recordAwayEvaluatorExchange(
      root,
      state,
      prompt,
      {
        ...evaluation,
        attempt,
        ...(transportError ? { error: transportError } : {}),
        ...(parseError ? { parse_error: parseError } : {}),
      },
      recordedAt(),
    )

    evidenceReferences.push(evidenceReference)

    if (!transportError && !parseError) {
      return recordAwayEvaluation(root, state, blocker, evaluation.value)
    }
  }

  return recordAwayEvaluationFailure(root, state, blocker, evidenceReferences)
}
