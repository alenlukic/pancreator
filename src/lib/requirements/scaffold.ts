import path from 'node:path'

import { PanError } from '../errors.js'
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
 *
 * The watch reads this too. `AUTO-001` requires the worker to scaffold its
 * output `before_operation`, so the output file exists, parses, and names the
 * invocation from the first seconds of every scaffolded stage. Presence alone
 * therefore cannot mean the worker finished — it means the worker started.
 * The scaffold is what the harness itself wrote, so it is exactly knowable
 * rather than something an observer has to infer.
 */
export function isUntouchedScaffold(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  // The schema calls `pending` the scaffold value and rejects it at
  // submission; an output still carrying it has not been written yet.
  if (
    isRecord(value.invocation_attestation) &&
    value.invocation_attestation.status === 'pending'
  ) {
    return true
  }

  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''

  if (summary.length > 0) {
    return false
  }

  if (!Array.isArray(value.criteria)) {
    return false
  }

  return value.criteria.every((item) => {
    if (!isRecord(item)) {
      return false
    }

    const result = item.result
    const untouched =
      result === 'unevaluated' ||
      (result === 'not_applicable' &&
        (typeof item.explanation !== 'string' ||
          item.explanation.trim().length === 0))

    return untouched
  })
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

  const operatorBrief = invocation.output.operator_brief
  const transientBriefSource =
    operatorBrief?.source_lifecycle === 'transient' ||
    operatorBrief?.source_transient === true
  const manifest = invocation.contract_manifest
  // The attestation is one whole-contract digest plus a status flip. The
  // per-section digest echoes the scaffold used to prefill proved nothing
  // beyond the contract digest and cost every attempt kilobytes of
  // transcription, so they are no longer emitted or required. The status
  // stays `pending` because only the worker can say that it read the contract,
  // and submission rejects the prefilled value. Guidance entries return as
  // read evidence, not digest transcription: the scaffold prefills every
  // identity field mechanically, and the worker owes only the status flip and
  // the `final_line` quote its read produces.
  const attestation: InvocationAttestation | undefined = manifest
    ? {
        invocation_id: invocation.invocation_id,
        model: invocation.stage.model,
        contract_path: manifest.contract_path,
        contract_sha256: manifest.contract_sha256,
        status: 'pending',
        ...(manifest.guidance?.length
          ? {
              guidance: manifest.guidance.map((entry) => ({
                policy_id: entry.policy_id,
                source_path: entry.source_path,
                content_sha256: entry.content_sha256,
                status: 'pending' as const,
              })),
            }
          : {}),
        ...(invocation.inputs?.context_reference
          ? {
              context_references: [
                {
                  source_path: invocation.inputs.context_reference.source_path,
                  content_sha256:
                    invocation.inputs.context_reference.content_sha256,
                  status: 'pending' as const,
                },
              ],
            }
          : {}),
      }
    : undefined

  const scaffold: StageOutput = {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    summary: '',
    artifacts:
      invocation.output.artifacts ??
      (operatorBrief
        ? [
            {
              path: operatorBrief.rendered_path,
              description:
                'Primary self-contained HTML brief for the operator.',
            },
            ...(!transientBriefSource
              ? [
                  {
                    path: operatorBrief.source_path,
                    description:
                      'Schema-valid JSON source for the operator brief.',
                  },
                ]
              : []),
          ]
        : []),
    criteria: invocation.rubric.map((criterion) => ({
      id: criterion.id,
      result: 'unevaluated',
      evidence: [],
      explanation: '',
    })),
    risks: [],
    unknowns: [],
    data: scaffoldDataFromRequiredData(invocation.output.required_data),
    ...(invocation.inputs?.target_instructions
      ? { target_instruction_evidence: { read_paths: [], reads: [] } }
      : {}),
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
  // The scaffold interface accepts exactly one artifact: the invocation JSON
  // snapshot. The Markdown contract sits beside it with the same stem, so a
  // wrong pick must fail by artifact type — before any parse attempt — and
  // name the sibling snapshot instead of surfacing a generic JSON error.
  if (!invocationPath.endsWith('.json')) {
    const sibling = invocationPath.replace(/\.[^./]+$/u, '.json')
    const siblingExists =
      sibling !== invocationPath && fileExists(path.join(root, sibling))

    throw new PanError(
      `--invocation accepts only the invocation JSON snapshot, not ` +
        `'${invocationPath}'.` +
        (siblingExists
          ? ` Use the sibling snapshot: ${sibling}`
          : ' Use the <invocation-id>.json snapshot beside the Markdown contract.'),
      { code: 'INVOCATION_ARTIFACT_TYPE' },
    )
  }

  const value = readJson(path.join(root, invocationPath))

  if (!isRecord(value)) {
    throw new Error(`Invalid invocation at ${invocationPath}`)
  }

  return value as unknown as Invocation
}
