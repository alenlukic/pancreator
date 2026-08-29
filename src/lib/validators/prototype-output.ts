import path from 'node:path'

import { fileExists, isRecord, readJson } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const PRECONDITION_STATUSES = new Set(['ready', 'unavailable', 'unknown'])
const CAUSE_VALUES = new Set(['product', 'environment', 'mixed', 'none'])
const VERDICT_VALUES = new Set([
  'validated',
  'invalidated',
  'inconclusive',
  'environment_blocked',
])

/** An operator decision recorded on the run's operator-feedback ledger. */
interface OperatorDecision {
  path: string
  note: string
}

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

/**
 * The operator decisions this run has recorded. The ledger is the authority
 * for exclusion claims: the harness writes its own pause records into the same
 * decisions directory, so a path that merely exists there proves nothing.
 */
function operatorDecisions(input: HandlerInput): OperatorDecision[] {
  const feedback = Array.isArray(input.runState?.operator_feedback)
    ? input.runState.operator_feedback
    : []
  const decisions: OperatorDecision[] = []

  for (const item of feedback) {
    if (
      !isRecord(item) ||
      typeof item.path !== 'string' ||
      typeof item.note !== 'string'
    ) {
      continue
    }

    // Records written before decision actors were stored carry no source;
    // only an operator could have authored them.
    if (item.source !== undefined && item.source !== 'operator') {
      continue
    }

    decisions.push({ path: item.path, note: item.note })
  }

  return decisions
}

/**
 * Why an exclusion claim fails to match the operator ledger, or null when the
 * cited decision is an operator's and its note names every excluded question.
 */
function exclusionAuthorityFailure(
  decisions: OperatorDecision[],
  exclusion: Record<string, unknown>,
): string | null {
  const decisionPath = exclusion.operator_decision_path

  if (!nonEmptyString(decisionPath)) {
    return 'MUST cite operator_decision_path'
  }

  const decision = decisions.find((entry) => entry.path === decisionPath)

  if (!decision) {
    return `operator_decision_path ${decisionPath} does not name an operator decision recorded on this run`
  }

  const unnamed = stringArray(exclusion.excluded_questions).filter(
    (questionId) => !decision.note.includes(questionId),
  )

  if (unnamed.length > 0) {
    return `operator decision ${decisionPath} does not name excluded question(s) ${unnamed.join(', ')}`
  }

  return null
}

function excludedQuestions(
  decisions: OperatorDecision[],
  precondition: Record<string, unknown>,
): Set<string> {
  const excluded = new Set<string>()
  const exclusions = Array.isArray(precondition.exclusions)
    ? precondition.exclusions
    : []

  for (const entry of exclusions) {
    if (!isRecord(entry) || exclusionAuthorityFailure(decisions, entry)) {
      continue
    }

    for (const questionId of stringArray(entry.excluded_questions)) {
      excluded.add(questionId)
    }
  }

  return excluded
}

function liveQuestions(
  decisions: OperatorDecision[],
  precondition: Record<string, unknown>,
): string[] {
  const affected = stringArray(precondition.affected_questions)
  const excluded = excludedQuestions(decisions, precondition)

  return affected.filter((questionId) => !excluded.has(questionId))
}

function preconditionBlocksApproach(
  decisions: OperatorDecision[],
  precondition: Record<string, unknown>,
): boolean {
  const status =
    typeof precondition.status === 'string' ? precondition.status : ''

  if (status === 'ready') {
    return false
  }

  return liveQuestions(decisions, precondition).length > 0
}

/**
 * Volatile preconditions the build owes a recheck: those still carrying a
 * question no operator decision excluded. An excluded precondition may stay
 * unavailable without trapping the build.
 */
function includedVolatilePreconditions(
  decisions: OperatorDecision[],
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
      liveQuestions(decisions, precondition).length > 0,
  )
}

function validatePreconditionEntry(
  decisions: OperatorDecision[],
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
    'volatile',
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

    if (field === 'volatile') {
      if (typeof value !== 'boolean') {
        issues.push(
          issue(`${prefix}.volatile`, `${prefix}.volatile MUST be a boolean`),
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

    const failure = exclusionAuthorityFailure(decisions, exclusion)

    if (failure) {
      issues.push(
        issue(
          'prototype.exclusion_authority',
          `${prefix}.exclusions[${index}] ${failure}`,
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
  const decisions = operatorDecisions(input)

  let blocking = false

  for (const [index, entry] of preconditions.entries()) {
    const precondition = validatePreconditionEntry(
      decisions,
      issues,
      `technical_approach.preconditions[${index}]`,
      entry,
    )

    if (precondition && preconditionBlocksApproach(decisions, precondition)) {
      blocking = true
    }
  }

  // A blocked approach needs no precondition cause: blocked is the
  // harness-wide pause route and an operator question may block it as well.
  if (value.result === 'success' && blocking) {
    issues.push(
      issue(
        'prototype.approach_blocked',
        'Approach success is incompatible with a blocking precondition',
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
  const success = value.result === 'success'
  const approachData = readPriorStageData(input, 'approach')
  const volatilePreconditions = includedVolatilePreconditions(
    operatorDecisions(input),
    approachData,
  )

  if (success && approachData === null) {
    issues.push(
      issue(
        'prototype.approach_unresolved',
        'Build success requires readable approach output for precondition traceability',
      ),
    )
  }

  if (success && checks.length === 0 && volatilePreconditions.length > 0) {
    issues.push(
      issue(
        'prototype.precondition_checks_missing',
        'spike.precondition_checks MUST record volatile precondition rechecks',
      ),
    )
  }

  const checkById = new Map<string, Record<string, unknown>>()
  let unreadyCheck = false

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
    } else if (status !== 'ready') {
      unreadyCheck = true
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

  // PROTO-001 conditions the empty changed-files rule on a precondition
  // becoming unavailable. A build blocked for another reason keeps the
  // harness-wide pause route, so it is not rewritten into a failure here.
  if (value.result === 'blocked' && unreadyCheck && changedFiles.length > 0) {
    issues.push(
      issue(
        'prototype.blocked_changed_files',
        'A build blocked by an unavailable precondition MUST leave changed_files empty',
      ),
    )
  }

  if (!success) {
    return issues
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

    if (check.status !== 'ready' && changedFiles.length > 0) {
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

/**
 * The technical question ids the intake brief declared, or null when the
 * intake output cannot be resolved from the run's stage history.
 */
function declaredQuestionIds(input: HandlerInput): Set<string> | null {
  const intakeData = readPriorStageData(input, 'intake')
  const brief = isRecord(intakeData?.prototype_brief)
    ? intakeData.prototype_brief
    : null

  if (!brief || !Array.isArray(brief.technical_questions)) {
    return null
  }

  const ids = new Set<string>()

  // Only a contracted id counts. A bare string would make the identifier the
  // whole sentence, which no later stage can be expected to reproduce.
  for (const question of brief.technical_questions) {
    if (isRecord(question) && nonEmptyString(question.id)) {
      ids.add(question.id)
    }
  }

  return ids
}

/**
 * The intake brief is where the question identifier is born. Every later
 * stage names a question by id, so an entry without one fails here rather
 * than at the evaluate gate, where the evaluator could only guess.
 */
function validateIntakeOutput(
  value: Record<string, unknown>,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const data = isRecord(value.data) ? value.data : {}
  const brief = isRecord(data.prototype_brief) ? data.prototype_brief : null
  const questions = Array.isArray(brief?.technical_questions)
    ? brief.technical_questions
    : []
  const seen = new Set<string>()

  for (const [index, question] of questions.entries()) {
    if (!isRecord(question) || !nonEmptyString(question.id)) {
      issues.push(
        issue(
          'prototype.question_id',
          `data.prototype_brief.technical_questions[${index}] MUST be an object with a non-empty id (TQ-nn) and question`,
        ),
      )
      continue
    }

    if (!nonEmptyString(question.question)) {
      issues.push(
        issue(
          'prototype.question_id',
          `data.prototype_brief.technical_questions[${index}] (${question.id}) MUST carry the question text`,
        ),
      )
    }

    if (seen.has(question.id)) {
      issues.push(
        issue(
          'prototype.question_id',
          `data.prototype_brief.technical_questions[${index}] repeats id ${question.id}`,
        ),
      )
    }

    seen.add(question.id)
  }

  return issues
}

/** Question ids an environment blocker names, under either field spelling. */
function blockerQuestionIds(blocker: unknown): string[] {
  if (!isRecord(blocker)) {
    return []
  }

  const ids = stringArray(blocker.affected_questions)

  if (nonEmptyString(blocker.question_id)) {
    ids.push(blocker.question_id)
  }

  return ids
}

function validateEvaluateOutput(
  input: HandlerInput,
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

  const blockers = Array.isArray(evaluation.environment_blockers)
    ? evaluation.environment_blockers
    : null

  if (!blockers) {
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
  if (verdict === 'environment_blocked' && blockers && blockers.length === 0) {
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

  const blockedQuestionIds = new Set(
    (blockers ?? []).flatMap((blocker) => blockerQuestionIds(blocker)),
  )
  const reportedQuestionIds = new Set<string>()
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

    const questionId = nonEmptyString(entry.question_id)
      ? entry.question_id
      : ''

    if (questionId.length > 0) {
      reportedQuestionIds.add(questionId)
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

    if (
      entry.readiness_question !== undefined &&
      typeof entry.readiness_question !== 'boolean'
    ) {
      issues.push(
        issue(
          'prototype.readiness_question',
          `evaluation.question_results[${index}].readiness_question MUST be a boolean`,
        ),
      )
    }

    // The explicit-readiness exemption lets an environment failure count as
    // product evidence. The evaluator claims it with readiness_question so a
    // blocker-named question cannot silently become a product cause.
    if (
      cause === 'product' &&
      blockedQuestionIds.has(questionId) &&
      entry.readiness_question !== true
    ) {
      issues.push(
        issue(
          'prototype.readiness_claim',
          `evaluation.question_results[${index}] names a product cause for ${questionId} while an environment blocker names it; set readiness_question: true when the brief tests readiness`,
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

  const declared = declaredQuestionIds(input)

  // Without a readable intake output there is no declared set to cover;
  // mirror the build stage, which only demands traceability it can resolve.
  if (declared) {
    for (const questionId of declared) {
      if (!reportedQuestionIds.has(questionId)) {
        issues.push(
          issue(
            'prototype.question_coverage',
            `evaluation.question_results MUST answer declared question ${questionId}`,
          ),
        )
      }
    }

    for (const questionId of reportedQuestionIds) {
      if (!declared.has(questionId)) {
        issues.push(
          issue(
            'prototype.question_coverage',
            `evaluation.question_results names ${questionId}, which the brief did not declare`,
          ),
        )
      }
    }
  }

  return issues
}

export function validatePrototypeOutput(input: HandlerInput): HandlerResult {
  if (workflowSlug(input) !== 'prototype') {
    return { status: 'passed', issues: [] }
  }

  const slug = stageSlug(input)
  const value = readJson(path.join(input.root, input.targetPath))

  if (!isRecord(value)) {
    return {
      status: 'failed',
      issues: [issue('prototype.shape', 'Stage output MUST be an object')],
    }
  }

  let issues: HandlerResult['issues'] = []

  switch (slug) {
    case 'intake':
      issues = validateIntakeOutput(value)
      break
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
