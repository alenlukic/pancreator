import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  writeJsonAtomic,
} from '../io.js'
import type { Invocation, JsonTypeName, StageOutput } from '../types.js'

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

export function scaffoldStageOutput(
  root: string,
  invocation: Invocation,
  outputPath: string,
  force = false,
): StageOutput {
  const absolute = path.join(root, outputPath)

  if (fileExists(absolute) && !force) {
    const existing = readText(absolute).trim()

    if (existing.length > 0) {
      throw new Error(
        `Output already exists at ${outputPath}; pass --force to overwrite.`,
      )
    }
  }

  const scaffold: StageOutput = {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    summary: '',
    artifacts: [],
    criteria: invocation.rubric.map((criterion) => ({
      id: criterion.id,
      result: 'not_applicable',
      evidence: [],
      explanation: '',
    })),
    risks: [],
    unknowns: [],
    data: scaffoldDataFromRequiredData(invocation.output.required_data),
  }

  writeJsonAtomic(absolute, scaffold)

  return scaffold
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
