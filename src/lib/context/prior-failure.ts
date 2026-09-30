/**
 * The prior-failure summary: the operator stage-repair note, the stage's own
 * failed attempts, and the failed supervisor assessment.
 */

import { readJson, resolveInside, isRecord } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import type {
  RunState,
  StageDefinition,
  OperatorStageRepairContext,
  PriorAttemptFailure,
  StageHistoryItem,
} from '../types.js'

/**
 * The operator stage-repair note that explains why this attempt exists, when
 * it is newer than every recorded attempt of the stage.
 *
 * `HR3-014`: `summarizePriorFailure` reads the stage's own history, so an
 * operator return to an earlier stage resolved no reason at all. The card
 * then left the superseded output of the stage the run came from as the only
 * failure-shaped context, and a worker read a verdict about work the operator
 * had already moved past. The repair note is the operator's own statement of
 * the reason, so it is the truthful one.
 */
export function operatorStageRepairContext(
  state: RunState,
  stage: StageDefinition,
): OperatorStageRepairContext | null {
  const repair = [...(state.operator_feedback ?? [])]
    .reverse()
    .find(
      (item) => item.decision === 'set-stage' && item.to_stage === stage.slug,
    )

  if (!repair) {
    return null
  }

  const recorded = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === stage.slug)

  // An attempt of this stage recorded after the repair is the newer reason,
  // and the retry contract already carries it.
  if (recorded && recorded.submitted_at > repair.timestamp) {
    return null
  }

  return {
    from_stage: repair.from_stage,
    to_stage: repair.to_stage,
    actor: repair.source ?? 'operator',
    note: repair.note,
    path: repair.path,
    recorded_at: repair.timestamp,
  }
}

/**
 * Summarize the most recent failed attempt of `stage` for inline rendering on the
 * retry card. Returns null when the previous attempt succeeded or none exists.
 */
export function summarizePriorFailure(
  state: RunState,
  stage: StageDefinition,
  root?: string,
): PriorAttemptFailure | null {
  const previous = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === stage.slug)

  if (!previous) {
    return null
  }

  // A supervisor-gated stage records the submission as `success` and fails at
  // the assessment instead, so the retry card previously carried no reason at
  // all: the worker was left to re-guess what the supervisor rejected. Fold
  // the failing assessment into the prior-failure block.
  const supervisorAssessment =
    root === undefined
      ? null
      : failedSupervisorAssessment(root, state, previous)

  if (previous.outcome === 'success' && !supervisorAssessment) {
    return null
  }

  const hardCriteria = new Map(
    stage.criteria
      .filter((criterion) => criterion.hard)
      .map((criterion) => [criterion.id, criterion]),
  )
  const failedHardCriteria = (previous.self_criteria ?? [])
    .filter(
      (evaluation) =>
        evaluation.result !== 'pass' && hardCriteria.has(evaluation.id),
    )
    .map((evaluation) => {
      const criterion = hardCriteria.get(evaluation.id)

      return {
        id: evaluation.id,
        type: criterion?.type ?? 'judgment',
        statement: criterion?.statement ?? '',
        explanation: evaluation.explanation,
      }
    })
  // An acceptance criterion is not a hard stage criterion, so a worker that
  // reported one failing left the retry card with no reason of any kind. The
  // declared failure is a recorded reason in its own right.
  const declaredCriteriaFailures = (previous.self_criteria ?? [])
    .filter(
      (evaluation) =>
        evaluation.result !== 'pass' && !hardCriteria.has(evaluation.id),
    )
    .map((evaluation) => ({
      id: evaluation.id,
      result: evaluation.result,
      explanation: evaluation.explanation,
    }))
  const failedDeterministic = previous.deterministic
    .filter((item) => !item.passed && !item.disabled)
    .map((item) => ({
      id: item.id,
      ...(item.command ? { command: item.command } : {}),
      ...(item.exit_code !== undefined ? { exit_code: item.exit_code } : {}),
      ...(item.timed_out ? { timed_out: item.timed_out } : {}),
      ...(item.evidence_path ? { evidence_path: item.evidence_path } : {}),
    }))

  return {
    stage: previous.stage,
    attempt: previous.attempt,
    invocation_id: previous.invocation_id,
    outcome: previous.outcome,
    output_path: previous.output_path,
    failed_hard_criteria: failedHardCriteria,
    declared_criteria_failures: declaredCriteriaFailures,
    failed_deterministic: failedDeterministic,
    validation_errors: previous.validation_errors,
    governance_artifact_warnings: previous.governance_artifact_warnings ?? [],
    ...(supervisorAssessment
      ? { supervisor_assessment: supervisorAssessment }
      : {}),
  }
}

/**
 * The failing supervisor assessment for a stage-history item, when one exists
 * on disk. Returns null for passing assessments and unreadable artifacts.
 */
function failedSupervisorAssessment(
  root: string,
  state: RunState,
  item: StageHistoryItem,
): PriorAttemptFailure['supervisor_assessment'] | null {
  const assessmentPath = resolveRunLayout(root, state.run_id).assessment(
    `${item.invocation_id}.assessment.json`,
  ).relative

  let value: unknown

  try {
    value = readJson(resolveInside(root, assessmentPath))
  } catch {
    return null
  }

  if (!isRecord(value) || value.verdict === 'pass') {
    return null
  }

  return {
    verdict: typeof value.verdict === 'string' ? value.verdict : 'fail',
    summary: typeof value.summary === 'string' ? value.summary : '',
    action_items: Array.isArray(value.action_items)
      ? value.action_items.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  }
}
