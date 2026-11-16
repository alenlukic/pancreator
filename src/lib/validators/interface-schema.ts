import path from 'node:path'

import { errorMessage } from '../errors.js'
import {
  findInterfaceDrift,
  parseInterfaceSchema,
  type NamedSignature,
} from '../interface-schema.js'
import { fileExists, isRecord, readJson, resolveInside } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import { workspaceRootFromInput } from './stage/evidence.js'

const END_TO_END_KINDS = new Set(['e2e', 'end-to-end', 'integration'])

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

/**
 * Validate a prototype-trace stage output: skeletons, trace tests with one
 * end-to-end path, a schema file at the declared path, and no drift against
 * claimed signatures. Passes without checks for any other workflow or stage.
 * Raises `schema.*` codes.
 */
export function validateInterfaceSchema(input: HandlerInput): HandlerResult {
  if (
    workflowSlug(input) !== 'prototype-trace' ||
    stageSlug(input) !== 'trace'
  ) {
    return { status: 'passed', issues: [] }
  }

  const value = readJson(path.join(input.root, input.targetPath))

  if (!isRecord(value)) {
    return {
      status: 'failed',
      issues: [issue('schema.shape', 'Stage output MUST be an object')],
    }
  }

  const issues: HandlerResult['issues'] = []
  const data = isRecord(value.data) ? value.data : {}
  const claimed: NamedSignature[] = []
  const skeletons = Array.isArray(data.skeletons) ? data.skeletons : null

  if (!skeletons || skeletons.length === 0) {
    issues.push(
      issue('schema.skeletons', 'data.skeletons MUST be a non-empty array'),
    )
  } else {
    for (const [index, entry] of skeletons.entries()) {
      if (!isRecord(entry) || !nonEmptyString(entry.name)) {
        issues.push(
          issue(
            'schema.skeleton_name',
            `data.skeletons[${index}].name MUST be a non-empty string`,
          ),
        )
        continue
      }

      if (!nonEmptyString(entry.signature)) {
        issues.push(
          issue(
            'schema.skeleton_signature',
            `data.skeletons[${index}].signature MUST be a non-empty string`,
          ),
        )
        continue
      }

      claimed.push({ name: entry.name, signature: entry.signature })
    }
  }

  const tests = Array.isArray(data.trace_tests) ? data.trace_tests : null

  if (!tests || tests.length === 0) {
    issues.push(
      issue('schema.trace_tests', 'data.trace_tests MUST be a non-empty array'),
    )
  } else {
    let endToEnd = false

    for (const [index, entry] of tests.entries()) {
      if (!isRecord(entry)) {
        issues.push(
          issue(
            'schema.trace_test_shape',
            `data.trace_tests[${index}] MUST be an object`,
          ),
        )
        continue
      }

      if (!nonEmptyString(entry.id) || !nonEmptyString(entry.path)) {
        issues.push(
          issue(
            'schema.trace_test_field',
            `data.trace_tests[${index}] MUST carry non-empty id and path`,
          ),
        )
      }

      const kind = typeof entry.kind === 'string' ? entry.kind : ''

      if (!nonEmptyString(kind)) {
        issues.push(
          issue(
            'schema.trace_test_kind',
            `data.trace_tests[${index}].kind MUST be a non-empty string`,
          ),
        )
      } else if (END_TO_END_KINDS.has(kind)) {
        endToEnd = true
      }
    }

    if (!endToEnd) {
      issues.push(
        issue(
          'schema.trace_test_e2e',
          'data.trace_tests MUST include at least one e2e or integration path',
        ),
      )
    }
  }

  const schemaMeta = isRecord(data.interface_schema)
    ? data.interface_schema
    : null

  if (!schemaMeta) {
    issues.push(
      issue('schema.meta_missing', 'data.interface_schema is required'),
    )

    return { status: 'failed', issues }
  }

  if (!nonEmptyString(schemaMeta.path)) {
    issues.push(
      issue(
        'schema.meta_path',
        'data.interface_schema.path MUST be a non-empty string',
      ),
    )
  }

  if (!nonEmptyString(schemaMeta.idiom)) {
    issues.push(
      issue(
        'schema.meta_idiom',
        'data.interface_schema.idiom MUST be a non-empty string',
      ),
    )
  }

  if (!nonEmptyString(schemaMeta.notes)) {
    issues.push(
      issue(
        'schema.meta_notes',
        'data.interface_schema.notes MUST be a non-empty string',
      ),
    )
  }

  const relative =
    typeof schemaMeta.path === 'string' ? schemaMeta.path.trim() : ''

  if (relative.length === 0) {
    return { status: issues.length === 0 ? 'passed' : 'failed', issues }
  }

  let schemaPath: string

  try {
    schemaPath = resolveInside(workspaceRootFromInput(input), relative)
  } catch (error) {
    issues.push(
      issue(
        'schema.path',
        `data.interface_schema.path is not a repository path: ${errorMessage(error)}`,
      ),
    )

    return { status: 'failed', issues }
  }

  if (!fileExists(schemaPath)) {
    issues.push(
      issue(
        'schema.missing',
        `Interface schema file ${relative} does not exist`,
      ),
    )

    return { status: 'failed', issues }
  }

  let parsed: unknown

  try {
    parsed = readJson(schemaPath)
  } catch (error) {
    issues.push(
      issue(
        'schema.file_shape',
        `Interface schema file ${relative} MUST be JSON: ${errorMessage(error)}`,
      ),
    )

    return { status: 'failed', issues }
  }

  const schema = parseInterfaceSchema(parsed)

  if ('error' in schema) {
    issues.push(issue('schema.file_shape', schema.error))

    return { status: 'failed', issues }
  }

  for (const finding of findInterfaceDrift(schema.schema.interfaces, claimed)) {
    if (finding.kind === 'signature') {
      issues.push(
        issue(
          'schema.drift',
          `${finding.name} signature drifted: schema ${finding.schemaSignature} vs claimed ${finding.claimedSignature}`,
        ),
      )
      continue
    }

    if (finding.kind === 'missing_in_schema') {
      issues.push(
        issue(
          'schema.drift',
          `${finding.name} is claimed in skeletons but absent from the schema file`,
        ),
      )
      continue
    }

    issues.push(
      issue(
        'schema.drift',
        `${finding.name} is in the schema file but absent from claimed skeletons`,
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
