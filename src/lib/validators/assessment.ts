import { isRecord, readJson } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import type { CriterionEvaluation, SupervisorAssessment } from '../types.js'

function expectedJudgmentCriterionIds(
  invocation: Record<string, unknown> | undefined,
): Set<string> {
  const rubric = Array.isArray(invocation?.rubric) ? invocation.rubric : []

  return new Set(
    rubric.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== 'string') {
        return []
      }

      return item.type === 'judgment' ? [item.id] : []
    }),
  )
}

export function validateAssessment(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(`${input.root}/${input.targetPath}`) as Record<
    string,
    unknown
  >

  if (!isRecord(value)) {
    return {
      status: 'invalid',
      issues: [
        { code: 'assessment.shape', message: 'Assessment MUST be an object' },
      ],
    }
  }

  const assessment = value as unknown as SupervisorAssessment
  const criteria = Array.isArray(assessment.criteria) ? assessment.criteria : []
  const seen = new Set<string>()
  const expected = expectedJudgmentCriterionIds(input.invocation)

  for (const item of criteria) {
    if (!item.id) {
      issues.push({
        code: 'assessment.criterion_id',
        message: 'Each assessment criterion MUST have an id',
      })
      continue
    }

    if (seen.has(item.id)) {
      issues.push({
        code: 'assessment.duplicate_criterion',
        message: `Duplicate criterion id: ${item.id}`,
      })
    }

    seen.add(item.id)

    if (item.explanation.trim().length === 0) {
      issues.push({
        code: 'assessment.explanation',
        message: `Criterion ${item.id} explanation MUST be non-empty`,
      })
    }

    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      issues.push({
        code: 'assessment.evidence',
        message: `Criterion ${item.id} MUST include evidence`,
      })
    }
  }

  if (expected.size > 0) {
    for (const id of expected) {
      if (!seen.has(id)) {
        issues.push({
          code: 'assessment.missing_criterion',
          message: `Missing required judgment criterion: ${id}`,
        })
      }
    }

    for (const id of seen) {
      if (!expected.has(id)) {
        issues.push({
          code: 'assessment.unknown_criterion',
          message: `Unknown criterion id: ${id}`,
        })
      }
    }
  }

  const failedCriteria = criteria.filter(
    (item: CriterionEvaluation) => item.result === 'fail',
  )

  if (assessment.verdict === 'pass' && failedCriteria.length > 0) {
    issues.push({
      code: 'assessment.verdict_inconsistent',
      message: 'pass verdict inconsistent with failed criterion',
    })
  }

  if (assessment.verdict === 'fail' && failedCriteria.length === 0) {
    issues.push({
      code: 'assessment.verdict_inconsistent',
      message: 'fail verdict requires at least one failed criterion',
    })
  }

  if (assessment.verdict === 'escalate' && failedCriteria.length === 0) {
    issues.push({
      code: 'assessment.verdict_inconsistent',
      message: 'escalate verdict requires at least one failed criterion',
    })
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
