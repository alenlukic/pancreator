import path from 'node:path'

import { fileExists, isRecord, readJson, resolveInside } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const PRECONDITION_STATUSES = new Set(['ready', 'unavailable', 'unknown'])
const CAUSE_VALUES = new Set(['product', 'environment', 'mixed', 'none'])
const VERDICT_VALUES = new Set([
  'validated',
  'invalidated',
  'inconclusive',
  'environment_blocked',
])

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function stageSlug(input: HandlerInput): string {
  const stage = isRecord(input.stage) ? input.stage : null

  if (stage && typeof stage.slug === 'string') {
    return stage.slug
  }

  const invocationStage = isRecord(input.invocation?.stage)
    ? input.invocation.stage
    : null

  return invocationStage && typeof invocationStage.slug === 'string'
    ? invocationStage.slug
    : ''
}

function workflowSlug(input: HandlerInput): string {
  const invocationWorkflow = isRecord(input.invocation?.workflow)
    ? input.invocation.workflow
    : null

  return invocationWorkflow && typeof invocationWorkflow.slug === 'string'
    ? invocationWorkflow.slug
    : ''
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => nonEmptyString(entry))
}

function latestSuccessfulStageOutputPath(
  input: HandlerInput,
  targetStage: string,
): string | null {
  const stageHistory = Array.isArray(input.runState?.stage_history)
    ? input.runState.stage_history
    : []
  let latestSuccess: string | null = null

  for (const item of stageHistory) {
    if (
      !isRecord(item) ||
      item.stage !== targetStage ||
      item.outcome !== 'success' ||
      typeof item.output_path !== 'string'
    ) {
      continue
    }

    if (!fileExists(path.join(input.root, item.output_path))) {
      continue
    }

    latestSuccess = item.output_path
  }

  return latestSuccess
}

function readPriorStageData(
  input: HandlerInput,
  targetStage: string,
): Record<string, unknown> | null {
  const outputPath = latestSuccessfulStageOutputPath(input, targetStage)

  if (!outputPath) {
    return null
  }

  const value = readJson(path.join(input.root, outputPath))

  return isRecord(value) && isRecord(value.data) ? value.data : null
}

function runIdFromInput(input: HandlerInput): string | null {
  return typeof input.runState?.run_id === 'string'
    ? input.runState.run_id
    : null
}

function operatorDecisionsPrefix(runId: string): string {
  return `runtime/logs/workflows/${runId}/agent/decisions/`
}

function isAuthorizedOperatorDecisionPath(
  root: string,
  runId: string | null,
  decisionPath: string,
): boolean {
  if (!runId || decisionPath.length === 0) {
    return false
  }

  const prefix = operatorDecisionsPrefix(runId)

  if (!decisionPath.startsWith(prefix)) {
    return false
  }

  try {
    const absolute = resolveInside(root, decisionPath)
    const decisionsDir = resolveInside(root, prefix)
    const relative = path.relative(decisionsDir, absolute)

    return (
      relative !== '..' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      fileExists(absolute)
    )
  } catch {
    return false
  }
}

function excludedQuestions(
  root: string,
  runId: string | null,
  precondition: Record<string, unknown>,
): Set<string> {
  const excluded = new Set<string>()
  const exclusions = Array.isArray(precondition.exclusions)
    ? precondition.exclusions
    : []

  for (const entry of exclusions) {
    if (!isRecord(entry)) {
      continue
    }

    const decisionPath =
      typeof entry.operator_decision_path === 'string'
        ? entry.operator_decision_path
        : ''

    if (!isAuthorizedOperatorDecisionPath(root, runId, decisionPath)) {
      continue
    }

    for (const questionId of stringArray(entry.excluded_questions)) {
      excluded.add(questionId)
    }
  }

  return excluded
}

function preconditionBlocksApproach(
  root: string,
  runId: string | null,
  precondition: Record<string, unknown>,
): boolean {
  const status =
    typeof precondition.status === 'string' ? precondition.status : ''

  if (status === 'ready') {
    return false
  }

  const affected = stringArray(precondition.affected_questions)
  const excluded = excludedQuestions(root, runId, precondition)

  return affected.some((questionId) => !excluded.has(questionId))
}

function includedVolatilePreconditions(
  root: string,
  runId: string | null,
  approachData: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const approach = isRecord(approachData?.technical_approach)
    ? approachData.technical_approach
    : null
  const preconditions = Array.isArray(approach?.preconditions)
    ? approach.preconditions.filter(isRecord)
    : []

  return preconditions.filter(
    (precondition) =>
      precondition.volatile === true &&
      !preconditionBlocksApproach(root, runId, precondition),
  )
}

function validatePreconditionEntry(
  root: string,
  runId: string | null,
  issues: HandlerResult['issues'],
  prefix: string,
  entry: unknown,
): Record<string, unknown> | null {
  if (!isRecord(entry)) {
    issues.push(issue(`${prefix}.shape`, `${prefix} MUST be an object`))

    return null
  }

  for (const field of [
    'id',
    'affected_questions',
    'check',
    'status',
    'evidence',
  ] as const) {
    const value = entry[field]

    if (field === 'affected_questions' || field === 'evidence') {
      if (!Array.isArray(value) || value.length === 0) {
        issues.push(
          issue(
            `${prefix}.${field}`,
            `${prefix}.${field} MUST be a non-empty array`,
          ),
        )
      }

      continue
    }

    if (!nonEmptyString(value)) {
      issues.push(
        issue(
          `${prefix}.${field}`,
          `${prefix}.${field} MUST be a non-empty string`,
        ),
      )
    }
  }

  const status = typeof entry.status === 'string' ? entry.status : ''

  if (!PRECONDITION_STATUSES.has(status)) {
    issues.push(
      issue(
        `${prefix}.status`,
        `${prefix}.status MUST be ready, unavailable, or unknown`,
      ),
    )
  }

  if (entry.volatile !== undefined && typeof entry.volatile !== 'boolean') {
    issues.push(
      issue(`${prefix}.volatile`, `${prefix}.volatile MUST be a boolean`),
    )
  }

  const exclusions = Array.isArray(entry.exclusions) ? entry.exclusions : []

  for (const [index, exclusion] of exclusions.entries()) {
    if (!isRecord(exclusion)) {
      issues.push(
        issue(
          `${prefix}.exclusions`,
          `${prefix}.exclusions[${index}] MUST be an object`,
        ),
      )
      continue
    }

    const decisionPath = exclusion.operator_decision_path

    if (!nonEmptyString(decisionPath)) {
      issues.push(
        issue(
          `${prefix}.exclusions`,
          `${prefix}.exclusions[${index}] MUST cite operator_decision_path`,
        ),
      )
      continue
    }

    if (!isAuthorizedOperatorDecisionPath(root, runId, decisionPath)) {
      issues.push(
        issue(
          'prototype.exclusion_authority',
          `${prefix}.exclusions[${index}] operator_decision_path MUST name a run decision file`,
        ),
      )
    }
  }

  return entry
}

function validateApproachOutput(
  input: HandlerInput,
  value: Record<string, unknown>,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const data = isRecord(value.data) ? value.data : {}
  const approach = isRecord(data.technical_approach)
    ? data.technical_approach
    : null

  if (!approach) {
    issues.push(
      issue(
        'prototype.approach_missing',
        'data.technical_approach is required',
      ),
    )

    return issues
  }

  if (!Array.isArray(approach.preconditions)) {
    issues.push(
      issue(
        'prototype.preconditions_missing',
        'technical_approach.preconditions MUST be an array',
      ),
    )

    return issues
  }

  const preconditions = approach.preconditions
  const runId = runIdFromInput(input)

  let blocking = false

  for (const [index, entry] of preconditions.entries()) {
    const precondition = validatePreconditionEntry(
      input.root,
      runId,
      issues,
      `technical_approach.preconditions[${index}]`,
      entry,
    )

    if (
      precondition &&
      preconditionBlocksApproach(input.root, runId, precondition)
    ) {
      blocking = true
    }
  }

  if (value.result === 'success' && blocking) {
    issues.push(
      issue(
        'prototype.approach_blocked',
        'Approach success is incompatible with a blocking precondition',
      ),
    )
  }

  if (value.result === 'blocked' && !blocking) {
    issues.push(
      issue(
        'prototype.approach_unblocked',
        'Approach blocked result requires at least one blocking precondition',
      ),
    )
  }

  return issues
}

function validateBuildOutput(
  input: HandlerInput,
  value: Record<string, unknown>,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const data = isRecord(value.data) ? value.data : {}
  const spike = isRecord(data.spike) ? data.spike : null

  if (!spike) {
    issues.push(issue('prototype.spike_missing', 'data.spike is required'))

    return issues
  }

  if (!Array.isArray(spike.precondition_checks)) {
    issues.push(
      issue(
        'prototype.precondition_checks_shape',
        'spike.precondition_checks MUST be an array',
      ),
    )

    return issues
  }

  const checks = spike.precondition_checks

  const approachData = readPriorStageData(input, 'approach')
  const runId = runIdFromInput(input)
  const volatilePreconditions = includedVolatilePreconditions(
    input.root,
    runId,
    approachData,
  )

  if (value.result === 'success' && approachData === null) {
    issues.push(
      issue(
        'prototype.approach_unresolved',
        'Build success requires readable approach output for precondition traceability',
      ),
    )
  }

  if (checks.length === 0 && volatilePreconditions.length > 0) {
    issues.push(
      issue(
        'prototype.precondition_checks_missing',
        'spike.precondition_checks MUST record volatile precondition rechecks',
      ),
    )
  }

  const checkById = new Map<string, Record<string, unknown>>()

  for (const [index, entry] of checks.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'prototype.precondition_check_shape',
          `spike.precondition_checks[${index}] MUST be an object`,
        ),
      )
      continue
    }

    if (!nonEmptyString(entry.precondition_id)) {
      issues.push(
        issue(
          'prototype.precondition_check_id',
          `spike.precondition_checks[${index}].precondition_id MUST be non-empty`,
        ),
      )
    } else {
      checkById.set(entry.precondition_id, entry)
    }

    const status = typeof entry.status === 'string' ? entry.status : ''

    if (!PRECONDITION_STATUSES.has(status)) {
      issues.push(
        issue(
          'prototype.precondition_check_status',
          `spike.precondition_checks[${index}].status MUST be ready, unavailable, or unknown`,
        ),
      )
    }

    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      issues.push(
        issue(
          'prototype.precondition_check_evidence',
          `spike.precondition_checks[${index}].evidence MUST be a non-empty array`,
        ),
      )
    }
  }

  const changedFiles = Array.isArray(spike.changed_files)
    ? spike.changed_files
    : []

  // The rule reads unconditionally and applies unconditionally: a blocked
  // build left no source edits behind, whatever blocked it.
  if (value.result === 'blocked' && changedFiles.length > 0) {
    issues.push(
      issue(
        'prototype.blocked_changed_files',
        'Blocked build MUST leave changed_files empty',
      ),
    )
  }

  for (const precondition of volatilePreconditions) {
    const id = typeof precondition.id === 'string' ? precondition.id : ''
    const check = checkById.get(id)

    if (!check) {
      issues.push(
        issue(
          'prototype.volatile_check_missing',
          `Build MUST recheck volatile precondition ${id}`,
        ),
      )
      continue
    }

    if (
      check.status !== 'ready' &&
      value.result === 'success' &&
      changedFiles.length > 0
    ) {
      issues.push(
        issue(
          'prototype.volatile_check_unready',
          `Volatile precondition ${id} is not ready before source edits`,
        ),
      )
    }
  }

  return issues
}

function validateEvaluateOutput(
  _input: HandlerInput,
  value: Record<string, unknown>,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const data = isRecord(value.data) ? value.data : {}
  const evaluation = isRecord(data.evaluation) ? data.evaluation : null

  if (!evaluation) {
    issues.push(
      issue('prototype.evaluation_missing', 'data.evaluation is required'),
    )

    return issues
  }

  if (!Array.isArray(evaluation.environment_blockers)) {
    issues.push(
      issue(
        'prototype.environment_blockers',
        'evaluation.environment_blockers MUST be an array',
      ),
    )
  }

  const verdict =
    typeof evaluation.verdict === 'string' ? evaluation.verdict : ''

  if (!VERDICT_VALUES.has(verdict)) {
    issues.push(
      issue(
        'prototype.verdict',
        'evaluation.verdict MUST be validated, invalidated, inconclusive, or environment_blocked',
      ),
    )
  }

  // An environment_blocked verdict asserts that named gaps prevented a
  // decision; a verdict with no named blocker asserts nothing checkable.
  if (
    verdict === 'environment_blocked' &&
    Array.isArray(evaluation.environment_blockers) &&
    evaluation.environment_blockers.length === 0
  ) {
    issues.push(
      issue(
        'prototype.environment_blockers_empty',
        'An environment_blocked verdict MUST name at least one environment blocker',
      ),
    )
  }

  const questionResults = Array.isArray(evaluation.question_results)
    ? evaluation.question_results
    : []

  if (questionResults.length === 0) {
    issues.push(
      issue(
        'prototype.question_results',
        'evaluation.question_results MUST be a non-empty array',
      ),
    )
  }

  let discardMet = false

  for (const [index, entry] of questionResults.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'prototype.question_result_shape',
          `evaluation.question_results[${index}] MUST be an object`,
        ),
      )
      continue
    }

    for (const field of ['question_id', 'result', 'cause'] as const) {
      if (!nonEmptyString(entry[field])) {
        issues.push(
          issue(
            'prototype.question_result_field',
            `evaluation.question_results[${index}].${field} MUST be non-empty`,
          ),
        )
      }
    }

    const cause = typeof entry.cause === 'string' ? entry.cause : ''

    if (!CAUSE_VALUES.has(cause)) {
      issues.push(
        issue(
          'prototype.question_result_cause',
          `evaluation.question_results[${index}].cause MUST be product, environment, mixed, or none`,
        ),
      )
    }

    if (typeof entry.discard_condition_met !== 'boolean') {
      issues.push(
        issue(
          'prototype.discard_condition_met',
          `evaluation.question_results[${index}].discard_condition_met MUST be a boolean`,
        ),
      )
    } else if (entry.discard_condition_met) {
      discardMet = true
    }

    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      issues.push(
        issue(
          'prototype.question_result_evidence',
          `evaluation.question_results[${index}].evidence MUST be a non-empty array`,
        ),
      )
    }
  }

  if (verdict === 'environment_blocked' && discardMet) {
    issues.push(
      issue(
        'prototype.verdict_precedence',
        'environment_blocked is incompatible with a met product discard condition',
      ),
    )
  }

  return issues
}

export function validatePrototypeOutput(input: HandlerInput): HandlerResult {
  if (workflowSlug(input) !== 'prototype') {
    return { status: 'passed', issues: [] }
  }

  const slug = stageSlug(input)

  if (slug === 'intake') {
    return { status: 'passed', issues: [] }
  }

  const value = readJson(path.join(input.root, input.targetPath))

  if (!isRecord(value)) {
    return {
      status: 'failed',
      issues: [issue('prototype.shape', 'Stage output MUST be an object')],
    }
  }

  let issues: HandlerResult['issues'] = []

  switch (slug) {
    case 'approach':
      issues = validateApproachOutput(input, value)
      break
    case 'build':
      issues = validateBuildOutput(input, value)
      break
    case 'evaluate':
      issues = validateEvaluateOutput(input, value)
      break
    default:
      return { status: 'passed', issues: [] }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
