/** Stage-output normalization and validation against the stage contract. */

import { errorMessage } from '../errors.js'
import { isRecord, resolveInside, fileExists } from '../io.js'
import type {
  StageOutput,
  JsonTypeName,
  ArtifactReference,
  CriterionEvaluation,
  Invocation,
  StageOutcome,
  StageDefinition,
} from '../types.js'

export interface StageOutputValidation {
  issues: StageOutputIssue[]
  errors: string[]
  output: StageOutput
}

export interface StageOutputIssue {
  code: string
  message: string
}

export interface StageOutputValidationOptions {
  /** Artifacts the harness writes later. Absence is not a defect. */
  pendingArtifactPaths?: string[]
}

function valueAt(object: Record<string, unknown>, dottedPath: string): unknown {
  let value: unknown = object

  for (const key of dottedPath.split('.')) {
    if (!isRecord(value)) {
      return undefined
    }

    value = value[key]
  }

  return value
}

function hasType(value: unknown, expected: JsonTypeName): boolean {
  if (expected === 'array') {
    return Array.isArray(value)
  }

  if (expected === 'object') {
    return isRecord(value)
  }

  return typeof value === expected
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeArtifacts(value: unknown): ArtifactReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.path !== 'string' ||
      typeof item.description !== 'string'
    ) {
      return []
    }

    return [{ path: item.path, description: item.description }]
  })
}

function normalizeCriteria(value: unknown): CriterionEvaluation[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return []
    }

    const result =
      item.result === 'pass' ||
      item.result === 'fail' ||
      item.result === 'not_applicable' ||
      item.result === 'skipped'
        ? item.result
        : item.result === 'unevaluated'
          ? 'unevaluated'
          : 'fail'

    return [
      {
        id: item.id,
        result,
        evidence: normalizeStringArray(item.evidence),
        explanation:
          typeof item.explanation === 'string' ? item.explanation : '',
      },
    ]
  })
}

function normalizeStageOutput(
  value: unknown,
  invocation: Invocation,
): StageOutput {
  const record = isRecord(value) ? value : {}
  const result: StageOutcome =
    record.result === 'success' ||
    record.result === 'failure' ||
    record.result === 'blocked'
      ? record.result
      : 'failure'

  return {
    schema_version: 1,
    invocation_id:
      typeof record.invocation_id === 'string'
        ? record.invocation_id
        : invocation.invocation_id,
    result,
    summary:
      typeof record.summary === 'string' && record.summary.trim().length > 0
        ? record.summary
        : 'Submitted output failed structural validation.',
    artifacts: normalizeArtifacts(record.artifacts),
    criteria: normalizeCriteria(record.criteria),
    risks: normalizeStringArray(record.risks),
    unknowns: normalizeStringArray(record.unknowns),
    ...(Array.isArray(record.platform_guidance_conflicts)
      ? {
          platform_guidance_conflicts: record.platform_guidance_conflicts
            .filter(isRecord)
            .map((entry) => ({
              guidance:
                typeof entry.guidance === 'string' ? entry.guidance : '',
              covered_step:
                typeof entry.covered_step === 'string'
                  ? entry.covered_step
                  : '',
              authority_followed:
                typeof entry.authority_followed === 'string'
                  ? entry.authority_followed
                  : '',
            })),
        }
      : {}),
    ...(isRecord(record.workspace_changes)
      ? {
          workspace_changes: {
            attribution:
              record.workspace_changes.attribution === 'internal' ||
              record.workspace_changes.attribution === 'external' ||
              record.workspace_changes.attribution === 'mixed'
                ? record.workspace_changes.attribution
                : 'unknown',
            paths: normalizeStringArray(record.workspace_changes.paths),
            explanation:
              typeof record.workspace_changes.explanation === 'string'
                ? record.workspace_changes.explanation
                : '',
          },
        }
      : {}),
    data: isRecord(record.data) ? record.data : {},
  }
}

/**
 * The shape a result owes, which a blocked result can redeclare. A stage that
 * reports the precondition it lacked never reached the work its product fields
 * describe, so requiring them makes the honest report unsubmittable. The stage
 * definition names the replacement, so the prompt a worker reads and the
 * contract the harness enforces come from one declaration.
 *
 * A blocked declaration the operator cannot act on is no declaration, so a
 * string it declares must carry text. An empty supplying command passes a type
 * check and still leaves the run without the command that unblocks it.
 */
function requiredDataErrors(
  stage: StageDefinition,
  output: StageOutput,
): string[] {
  const blocked = output.result === 'blocked' && stage.blocked_required_data
  const required = blocked
    ? stage.blocked_required_data
    : (stage.required_data ?? {})

  return Object.entries(required ?? {}).flatMap(([dataPath, expectedType]) => {
    const dataValue = valueAt(output.data, dataPath)

    if (blocked && expectedType === 'string') {
      return typeof dataValue === 'string' && dataValue.trim().length > 0
        ? []
        : [
            `data.${dataPath} MUST be a non-empty string when the ` +
              `${stage.slug} result is blocked`,
          ]
    }

    return hasType(dataValue, expectedType)
      ? []
      : [`data.${dataPath} MUST be ${expectedType}`]
  })
}

export function validateStageOutput(
  root: string,
  stage: StageDefinition,
  invocation: Invocation,
  value: unknown,
  { pendingArtifactPaths = [] }: StageOutputValidationOptions = {},
): StageOutputValidation {
  // Each site names its own code. A lookup keyed by message text tied the
  // identifier to the wording, so rewording an error silently degraded it to
  // the generic code, and no code survived a reword it did not anticipate.
  const issues: StageOutputIssue[] = []
  const addIssue = (code: string, message: string): void => {
    issues.push({ code, message })
  }
  const output = normalizeStageOutput(value, invocation)
  const record = isRecord(value) ? value : {}

  if (!isRecord(value)) {
    addIssue('stage_output.shape', 'output MUST be an object')
  }

  if (record.schema_version !== 1) {
    addIssue('stage_output.schema_version', 'schema_version MUST be 1')
  }

  if (record.invocation_id !== invocation.invocation_id) {
    addIssue(
      'stage_output.invocation_id',
      'invocation_id MUST match the active invocation',
    )
  }

  if (
    record.result !== 'success' &&
    record.result !== 'failure' &&
    record.result !== 'blocked'
  ) {
    addIssue(
      'stage_output.result',
      'result MUST be success, failure, or blocked',
    )
  }

  if (
    typeof record.summary !== 'string' ||
    record.summary.trim().length === 0
  ) {
    addIssue('stage_output.summary', 'summary MUST be a non-empty string')
  }

  for (const key of ['artifacts', 'criteria']) {
    if (!Array.isArray(record[key])) {
      addIssue(`stage_output.${key}`, `${key} MUST be an array`)
    }
  }

  // Risks and unknowns are honest-disclosure fields, not paperwork: absent
  // means none to report, exactly like an empty array.
  for (const key of ['risks', 'unknowns']) {
    if (record[key] !== undefined && !Array.isArray(record[key])) {
      addIssue(`stage_output.${key}`, `${key} MUST be an array when present`)
    }
  }

  // OPERATOR-001: an entry must name all three parts to be auditable.
  if (record.platform_guidance_conflicts !== undefined) {
    if (!Array.isArray(record.platform_guidance_conflicts)) {
      addIssue(
        'stage_output.platform_guidance_conflicts',
        'platform_guidance_conflicts MUST be an array when present',
      )
    } else {
      for (const [
        index,
        entry,
      ] of record.platform_guidance_conflicts.entries()) {
        const complete =
          isRecord(entry) &&
          (['guidance', 'covered_step', 'authority_followed'] as const).every(
            (field) =>
              typeof entry[field] === 'string' &&
              (entry[field] as string).trim().length > 0,
          )

        if (!complete) {
          addIssue(
            'stage_output.platform_guidance_conflict_shape',
            `platform_guidance_conflicts[${index}] MUST name guidance, ` +
              'covered_step, and authority_followed as non-empty strings',
          )
        }
      }
    }
  }

  if (!isRecord(record.data)) {
    addIssue('stage_output.data', 'data MUST be an object')
  }

  for (const message of requiredDataErrors(stage, output)) {
    addIssue('stage_output.required_data', message)
  }

  // Report an unrecognized criterion verdict explicitly. `normalizeCriteria`
  // coerces one to `fail`, which is the safe default but silently converts a
  // one-token vocabulary mistake into an unexplained stage failure. Naming the
  // offending value is what lets the retry fix the actual problem.
  if (Array.isArray(record.criteria)) {
    for (const item of record.criteria) {
      if (!isRecord(item) || typeof item.id !== 'string') {
        addIssue(
          'criterion.entry',
          'each criteria entry MUST be an object with a string id naming a ' +
            'rubric criterion',
        )
        continue
      }

      if (
        item.result !== 'pass' &&
        item.result !== 'fail' &&
        item.result !== 'not_applicable' &&
        item.result !== 'unevaluated' &&
        item.result !== 'skipped'
      ) {
        addIssue(
          'criterion.result',
          `criteria '${item.id}' result MUST be pass, fail, not_applicable, ` +
            `unevaluated, or skipped (got ${JSON.stringify(item.result)})`,
        )
      }
    }
  }

  const criteria = new Map<string, CriterionEvaluation>()

  for (const item of output.criteria) {
    if (criteria.has(item.id)) {
      addIssue('criterion.duplicate', `duplicate criteria result: ${item.id}`)
    }

    // An explanation is required only where it carries information: why a
    // criterion failed, or why it does not apply. Demanding prose on every
    // passing entry produced boilerplate nobody read.
    if (
      (item.result === 'fail' || item.result === 'not_applicable') &&
      item.explanation.length === 0
    ) {
      addIssue(
        'criterion.explanation_required',
        `criteria '${item.id}' ${item.result} verdict MUST carry an explanation`,
      )
    }

    criteria.set(item.id, item)
  }

  for (const criterion of stage.criteria) {
    const evaluation = criteria.get(criterion.id)

    if (!evaluation) {
      addIssue(
        'criterion.missing',
        `missing self-evaluation for criterion '${criterion.id}'`,
      )
      continue
    }

    if (criterion.hard && evaluation.result === 'not_applicable') {
      addIssue(
        'criterion.hard_not_applicable',
        `hard criterion '${criterion.id}' MUST NOT be not_applicable`,
      )
    }

    if (evaluation.result === 'skipped') {
      if (output.result === 'success') {
        addIssue(
          'criterion.skipped_on_success',
          `A success result cannot skip criterion '${criterion.id}'`,
        )
      } else if (output.result === 'failure' && criterion.type !== 'shell') {
        addIssue(
          'criterion.skipped_on_failure',
          `criteria '${criterion.id}' MUST NOT be skipped on a failure ` +
            'result unless it is a shell criterion',
        )
      }

      if (evaluation.explanation.length === 0) {
        addIssue(
          'criterion.skipped_explanation',
          `criteria '${criterion.id}' skipped verdict MUST carry an explanation`,
        )
      }
    }

    if (evaluation.result === 'unevaluated') {
      addIssue(
        'criterion.unevaluated',
        `Criterion '${criterion.id}' remains unevaluated and cannot be submitted`,
      )
    }

    if (
      criterion.hard &&
      evaluation.result === 'pass' &&
      evaluation.evidence.length === 0
    ) {
      addIssue(
        'criterion.pass_evidence',
        `criteria '${criterion.id}' pass claim MUST include evidence`,
      )
    }
  }

  if (output.result === 'success') {
    const failedSelf = output.criteria.some((item) => item.result === 'fail')

    if (failedSelf) {
      addIssue(
        'criterion.contradicts_result',
        'result success contradicts failed criterion self-evaluation',
      )
    }
  }

  const knownCriterionIds = new Set(stage.criteria.map((item) => item.id))

  for (const item of output.criteria) {
    if (!knownCriterionIds.has(item.id)) {
      addIssue('criterion.unknown', `unknown criteria result: ${item.id}`)
    }
  }

  const briefContract = invocation.output.operator_brief
  const declaredArtifacts = invocation.output.artifacts

  if (declaredArtifacts) {
    if (output.artifacts.length !== declaredArtifacts.length) {
      addIssue(
        'artifact.declared_count',
        `artifacts MUST contain exactly ${declaredArtifacts.length} declared entries`,
      )
    }

    for (const [index, artifact] of declaredArtifacts.entries()) {
      if (output.artifacts[index]?.path !== artifact.path) {
        addIssue(
          'artifact.declared_path',
          `artifacts[${index}].path MUST equal declared path '${artifact.path}'`,
        )
      }
    }
  }

  if (briefContract) {
    const primaryArtifact = output.artifacts[0]
    const sourceTransient =
      briefContract.source_lifecycle === 'transient' ||
      briefContract.source_transient === true

    if (primaryArtifact?.path !== briefContract.rendered_path) {
      addIssue(
        'artifact.brief_rendered_path',
        `artifacts[0].path MUST equal rendered operator brief path '${briefContract.rendered_path}'`,
      )
    }

    if (
      sourceTransient &&
      output.artifacts.some(
        (artifact) => artifact.path === briefContract.source_path,
      )
    ) {
      addIssue(
        'artifact.brief_transient_source',
        `artifacts MUST NOT list transient operator brief source '${briefContract.source_path}'`,
      )
    } else if (
      !declaredArtifacts &&
      !sourceTransient &&
      output.artifacts[1]?.path !== briefContract.source_path
    ) {
      addIssue(
        'artifact.brief_source_path',
        `artifacts[1].path MUST equal operator brief source path '${briefContract.source_path}'`,
      )
    }
  }

  // Compare resolved paths so a pending artifact is exempt however spelled.
  const pendingAbsolutePaths = new Set(
    pendingArtifactPaths.map((pendingPath) => resolveInside(root, pendingPath)),
  )

  for (const artifact of output.artifacts) {
    try {
      const absolute = resolveInside(root, artifact.path)

      if (!pendingAbsolutePaths.has(absolute) && !fileExists(absolute)) {
        addIssue(
          'artifact.missing',
          `artifact does not exist: ${artifact.path}`,
        )
      }
    } catch (error) {
      addIssue('artifact.unresolvable_path', errorMessage(error))
    }

    if (artifact.description.length === 0) {
      addIssue(
        'artifact.description',
        `artifact '${artifact.path}' description MUST be non-empty`,
      )
    }
  }

  return {
    issues,
    errors: issues.map((item) => item.message),
    output,
  }
}
