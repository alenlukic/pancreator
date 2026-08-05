import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  writeJsonAtomic,
} from '../io.js'
import type {
  Invocation,
  InvocationAttestation,
  JsonTypeName,
  StageOutput,
} from '../types.js'

function defaultValueForType(type: JsonTypeName): unknown {
  switch (type) {
    case 'string':
      return ''
    case 'array':
      return []
    case 'object':
      return {}
    case 'number':
      return 0
    case 'boolean':
      return false
    default:
      return null
  }
}

/** Build nested data objects from dotted required_data paths. */
export function scaffoldDataFromRequiredData(
  requiredData: Record<string, JsonTypeName>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const paths = Object.keys(requiredData).sort(
    (left, right) => left.split('.').length - right.split('.').length,
  )

  for (const dottedPath of paths) {
    const type = requiredData[dottedPath]
    const keys = dottedPath.split('.')

    if (keys.length === 1) {
      if (!(dottedPath in data)) {
        data[dottedPath] = defaultValueForType(type)
      } else if (type === 'object' && !isRecord(data[dottedPath])) {
        data[dottedPath] = {}
      }

      continue
    }

    let current = data

    for (let index = 0; index < keys.length - 1; index += 1) {
      const key = keys[index]

      if (!isRecord(current[key])) {
        current[key] = {}
      }

      current = current[key] as Record<string, unknown>
    }

    const leafKey = keys[keys.length - 1]
    current[leafKey] = defaultValueForType(type)
  }

  return data
}

/**
 * Whether an existing output is still an untouched scaffold: every criterion
 * unevaluated and no summary written. Re-scaffolding one of these is a no-op, so
 * it must not be an error — a required automation whose ordinary second
 * invocation throws forces the agent to argue that a failure was really success.
 */
function isUntouchedScaffold(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''

  if (summary.length > 0) {
    return false
  }

  if (!Array.isArray(value.criteria)) {
    return false
  }

  return value.criteria.every(
    (item) =>
      isRecord(item) &&
      item.result === 'not_applicable' &&
      (typeof item.explanation !== 'string' ||
        item.explanation.trim().length === 0),
  )
}

export interface StageOutputScaffoldResult {
  status: 'scaffolded' | 'already_scaffolded'
  output: StageOutput
}

export function scaffoldStageOutput(
  root: string,
  invocation: Invocation,
  outputPath: string,
  force = false,
): StageOutputScaffoldResult {
  const absolute = path.join(root, outputPath)

  if (fileExists(absolute) && !force) {
    const existing = readText(absolute).trim()

    if (existing.length > 0) {
      let parsed: unknown = null

      try {
        parsed = JSON.parse(existing)
      } catch {
        parsed = null
      }

      if (isUntouchedScaffold(parsed)) {
        return {
          status: 'already_scaffolded',
          output: parsed as StageOutput,
        }
      }

      throw new Error(
        `Output already exists at ${outputPath} and contains work; pass --force to overwrite.`,
      )
    }
  }

  const operatorBrief = invocation.output.operator_brief as
    | Invocation['output']['operator_brief']
    | undefined
  const manifest = invocation.contract_manifest
  // Copying the manifest here keeps the worker's job honest rather than clerical:
  // the digests it must confirm are already in place, so a mismatch means the
  // contract on disk changed, not that a digest was mistyped. The status stays
  // `pending` because only the worker can say that it read the contract, and
  // submission rejects the prefilled value.
  const attestation: InvocationAttestation | undefined = manifest
    ? {
        invocation_id: invocation.invocation_id,
        contract_path: manifest.contract_path,
        contract_sha256: manifest.contract_sha256,
        status: 'pending',
        sections: manifest.sections.map((section) => ({
          id: section.id,
          sha256: section.sha256,
        })),
      }
    : undefined

  const scaffold: StageOutput = {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    summary: '',
    artifacts: operatorBrief
      ? [
          {
            path: operatorBrief.rendered_path,
            description: 'Primary self-contained HTML brief for the operator.',
          },
          {
            path: operatorBrief.source_path,
            description: 'Schema-valid JSON source for the operator brief.',
          },
        ]
      : [],
    criteria: invocation.rubric.map((criterion) => ({
      id: criterion.id,
      result: 'not_applicable',
      evidence: [],
      explanation: '',
    })),
    risks: [],
    unknowns: [],
    data: scaffoldDataFromRequiredData(invocation.output.required_data),
    ...(attestation ? { invocation_attestation: attestation } : {}),
  }

  writeJsonAtomic(absolute, scaffold)

  return { status: 'scaffolded', output: scaffold }
}

export function scaffoldAssessment(
  root: string,
  invocationId: string,
  assessmentPath: string,
  judgmentCriteria: string[],
  force = false,
): Record<string, unknown> {
  const absolute = path.join(root, assessmentPath)

  if (fileExists(absolute) && !force) {
    const existing = readText(absolute).trim()

    if (existing.length > 0) {
      throw new Error(
        `Assessment already exists at ${assessmentPath}; pass --force to overwrite.`,
      )
    }
  }

  const scaffold = {
    schema_version: 1,
    assessment_id: `assessment-${invocationId}`,
    invocation_id: invocationId,
    verdict: 'pass',
    summary: '',
    criteria: judgmentCriteria.map((id) => ({
      id,
      result: 'not_applicable',
      evidence: [],
      explanation: '',
    })),
    action_items: [],
  }

  writeJsonAtomic(absolute, scaffold)

  return scaffold
}

export function readInvocationFromPath(
  root: string,
  invocationPath: string,
): Invocation {
  const value = readJson(path.join(root, invocationPath))

  if (!isRecord(value)) {
    throw new Error(`Invalid invocation at ${invocationPath}`)
  }

  return value as unknown as Invocation
}
