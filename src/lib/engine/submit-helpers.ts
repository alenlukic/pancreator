/**
 * Pieces of a stage submission: materializing the submitted output, rendering
 * its operator brief, deciding its effective outcome, and the intake items it
 * emits.
 */

import path from 'node:path'

import { renderBrief } from '../briefs/render.js'
import { errorMessage, invariant } from '../errors.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  writeTextAtomic,
} from '../io.js'
import { queueInboxRelativePath } from '../inbox.js'
import { applyJsonMergePatch } from '../json-merge-patch.js'
import { FAST_WALL_CRITERION_ID } from '../fast-wall-series.js'
import { isTargetInstallation } from '../project-config.js'
import type {
  DeterministicResult,
  Invocation,
  RunState,
  StageDefinition,
  StageHistoryItem,
  StageOutcome,
  StageOutput,
} from '../types.js'
import type { StageOutputValidation } from '../validation.js'

/**
 * Append advisories to run state so `pan status` recovers them after a resume.
 * The caller must persist the state.
 */
export function emitSuiteCostInboxItem(
  root: string,
  state: RunState,
  message: string,
  evidencePath?: string,
): string {
  const relative = queueInboxRelativePath(
    `${state.run_id}-fast-wall-advisory.md`,
  )
  const absolute = resolveInside(root, relative)

  if (fileExists(absolute)) {
    return relative
  }

  ensureDir(path.dirname(absolute))
  writeTextAtomic(
    absolute,
    [
      '# Fast-lane suite-cost advisory',
      '',
      '**State:** The qualified rolling fast-lane wall average exceeded its soft ceiling.',
      '**Outcome:** The release remains unblocked. The observation is queued for performance tuning.',
      '**Blockers:** None.',
      isTargetInstallation(root)
        ? '**Next action:** Review the cost of the `fast` profile and `fast_wall.ceiling_ms` in the harness `config.json`.'
        : '**Next action:** Run `/pan-tune-harness` to review the suite cost and configured ceiling.',
      '**Category:** Performance (`perf`)',
      '',
      '## Observation',
      '',
      message,
      '',
      `- Run: \`${state.run_id}\``,
      `- Criterion: \`${FAST_WALL_CRITERION_ID}\``,
      ...(evidencePath ? [`- Evidence: \`${evidencePath}\``] : []),
      '',
    ].join('\n'),
  )

  return relative
}

/**
 * Returns the `invocation_id` string of a submitted output document, or null
 * when the value is not a record or carries no string id.
 */
export function submittedInvocationId(value: unknown): string | null {
  return isRecord(value) && typeof value.invocation_id === 'string'
    ? value.invocation_id
    : null
}

/**
 * Renders the operator brief the invocation's output contract declares from its
 * source file to its rendered path. Returns a list of error messages instead of
 * throwing: empty when the contract declares no brief or the render succeeded,
 * and one message when the source is missing or the render failed.
 */
export function materializeOperatorBrief(
  root: string,
  invocation: Invocation,
): string[] {
  const contract = invocation.output.operator_brief

  if (!contract) {
    return []
  }

  const source = resolveInside(root, contract.source_path)

  if (!fileExists(source)) {
    return [`operator brief source does not exist: ${contract.source_path}`]
  }

  try {
    renderBrief(root, contract.source_path, contract.rendered_path)
    return []
  } catch (error) {
    return [`operator brief render failed: ${errorMessage(error)}`]
  }
}

/**
 * Decides a submission's stage outcome. Validation errors force failure (or
 * blocked when a blocking validator routed there), then a validator's routed
 * outcome wins, then the worker's own blocked or failure result; otherwise any
 * failed hard self-evaluated criterion or failed hard deterministic check that
 * is not disabled yields failure, and everything else yields success.
 */
export function effectiveOutcome(
  stage: StageDefinition,
  output: StageOutput,
  validationErrors: string[],
  deterministic: DeterministicResult[],
  validatorOutcome: StageOutcome | null = null,
): StageOutcome {
  if (validationErrors.length > 0) {
    return validatorOutcome === 'blocked' ? 'blocked' : 'failure'
  }

  if (validatorOutcome) {
    return validatorOutcome
  }

  if (output.result === 'blocked') {
    return 'blocked'
  }

  if (output.result === 'failure') {
    return 'failure'
  }

  const selfEvaluations = new Map(
    output.criteria.map((item) => [item.id, item]),
  )
  const failedHardCriterion = stage.criteria.some(
    (criterion) =>
      criterion.hard && selfEvaluations.get(criterion.id)?.result === 'fail',
  )

  if (failedHardCriterion) {
    return 'failure'
  }

  if (
    deterministic.some((item) => item.hard && !item.passed && !item.disabled)
  ) {
    return 'failure'
  }

  return 'success'
}

/**
 * Returns the messages of the output validation issues that must block a
 * submission because a criterion was left unevaluated or skipped on a
 * successful outcome.
 */
export function blockingCriterionStateErrors(
  issues: StageOutputValidation['issues'],
): string[] {
  const blockingCodes = new Set([
    'criterion.unevaluated',
    'criterion.skipped_on_success',
  ])

  return issues
    .filter((issue) => blockingCodes.has(issue.code))
    .map((issue) => issue.message)
}

export interface MaterializedSubmission {
  value: unknown
  revisedFrom?: StageHistoryItem
}

/**
 * Materialize a full output document from either accepted submission form.
 *
 * The caller supplies `expectedInvocationId` from the run's active card, and
 * `null` when the run has none. The expectation is never derived from the
 * submitted document, because a check whose expected value comes from the
 * value it is checking proves nothing.
 */
export function materializeOutputSubmission(
  root: string,
  state: RunState,
  submittedValue: unknown,
  expectedInvocationId: string | null,
): MaterializedSubmission {
  if (!isRecord(submittedValue) || !('revises' in submittedValue)) {
    return { value: submittedValue }
  }

  invariant(
    expectedInvocationId !== null,
    'A revision submission MUST be made against an active invocation, and ' +
      'this run has none.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    typeof submittedValue.revises === 'string' &&
      submittedValue.revises.length > 0,
    'A revision submission MUST name the prior invocation in revises.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    isRecord(submittedValue.patch),
    'A revision submission MUST carry an object merge patch in patch.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    typeof submittedValue.patch.invocation_id === 'string' &&
      submittedValue.patch.invocation_id.length > 0 &&
      submittedValue.patch.invocation_id !== submittedValue.revises &&
      submittedValue.patch.invocation_id === expectedInvocationId,
    `A revision patch MUST set invocation_id to the current card's ` +
      `invocation id, not the revised attempt's.`,
    { code: 'INVALID_REVISION' },
  )

  const revisedFrom = state.stage_history.find(
    (item) => item.invocation_id === submittedValue.revises,
  )

  invariant(
    revisedFrom,
    `Revision names invocation '${submittedValue.revises}', which this run ` +
      `has no submitted attempt for.`,
    { code: 'INVALID_REVISION' },
  )

  return {
    value: applyJsonMergePatch(
      readJson(resolveInside(root, revisedFrom.output_path)),
      submittedValue.patch,
    ),
    revisedFrom,
  }
}

/**
 * Persist non-blocking verify findings as an operator inbox item. A
 * pass-with-warnings verdict advances the run because QA demonstrated the
 * change works, but the demoted findings must not evaporate: the inbox file is
 * the durable follow-up record VERIFY-001 promises. Returns the written
 * repo-relative path, or null when the output carries no demoted findings.
 */
export function emitVerifyWarningsInboxItem(
  root: string,
  state: RunState,
  output: StageOutput,
): string | null {
  const verify = isRecord(output.data.verify) ? output.data.verify : null

  if (!verify || verify.verdict !== 'pass_with_warnings') {
    return null
  }

  const findings = Array.isArray(verify.findings)
    ? verify.findings.filter(isRecord)
    : []
  const warnings = findings.filter((finding) => finding.severity !== 'blocker')

  if (warnings.length === 0) {
    return null
  }

  const lines: string[] = [
    `# Verify warnings from run ${state.run_id}`,
    '',
    `The verify stage passed with warnings (invocation ${output.invocation_id}).`,
    'QA confirmed the change works, so these findings did not block the run.',
    'Schedule follow-up work for each finding, or record a decision to accept it.',
    '',
  ]

  for (const finding of warnings) {
    const id = typeof finding.id === 'string' ? finding.id : 'finding'
    const severity =
      typeof finding.severity === 'string' ? finding.severity : 'unknown'
    const statement =
      typeof finding.statement === 'string' ? finding.statement : ''
    const evidence = Array.isArray(finding.evidence)
      ? finding.evidence.filter((entry) => typeof entry === 'string')
      : []

    lines.push(`## ${id} (${severity})`, '')

    if (statement) {
      lines.push(statement, '')
    }

    if (evidence.length > 0) {
      lines.push('Evidence:', ...evidence.map((entry) => `- ${entry}`), '')
    }
  }

  const relativePath = queueInboxRelativePath(
    `${state.run_id}-verify-warnings.md`,
  )
  const absolutePath = resolveInside(root, relativePath)

  writeTextAtomic(absolutePath, `${lines.join('\n').trimEnd()}\n`)

  return relativePath
}
