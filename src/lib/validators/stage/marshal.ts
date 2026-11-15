/** The marshaling join validator. */

import path from 'node:path'

import { isRecord, readJson } from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { issue } from './evidence.js'
import {
  contractReconciliationViolations,
  marshalBaselineViolations,
} from '../../standard-marshal.js'
import type { Invocation } from '../../types.js'

const ALLOWED_KINDS = new Set(['call_site', 'import', 'name', 'fixture_shape'])
const FORBIDDEN_KIND_MARKERS = [
  'assertion',
  'scenario_delete',
  'expected_outcome',
  'loosen',
  'weaken',
] as const

/**
 * Validate marshaling edits on an implement stage output. Absent marshaling
 * passes so delivery and one-shot implement stay valid. A present record
 * MUST use only call-site, import, name, and fixture-shape kinds. Raises
 * `marshal.assertion_loosened`, `marshal.edit_kind`, and `marshal.edits_shape`.
 */
export function validateMarshalOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const marshaling = data.marshaling

  const invocation = input.invocation as unknown as Invocation | undefined
  if (
    invocation?.workflow?.slug === 'standard' &&
    invocation.stage.slug === 'implement' &&
    value.result === 'success'
  ) {
    for (const violation of marshalBaselineViolations(input.root, invocation)) {
      issues.push(issue('marshal.assertion_loosened', violation))
    }
    if (
      invocation.rubric?.some(
        (criterion) => criterion.id === 'standard.contract_alignment',
      )
    ) {
      for (const violation of contractReconciliationViolations(
        input.root,
        invocation,
        marshaling,
      )) {
        issues.push(issue('marshal.reconciliation_evidence', violation))
      }
    }
  }
  if (marshaling === undefined) {
    return { status: issues.length ? 'failed' : 'passed', issues }
  }

  if (!isRecord(marshaling) || !Array.isArray(marshaling.edits)) {
    issues.push(
      issue(
        'marshal.edits_shape',
        'data.marshaling.edits MUST be an array when marshaling is present.',
      ),
    )
    return { status: 'failed', issues }
  }

  for (const [index, entry] of marshaling.edits.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.kind !== 'string' ||
      typeof entry.path !== 'string' ||
      !entry.path.trim() ||
      typeof entry.note !== 'string' ||
      !entry.note.trim()
    ) {
      issues.push(
        issue(
          'marshal.edits_shape',
          `data.marshaling.edits[${String(index)}] MUST be an object with kind, path, and note.`,
        ),
      )
      continue
    }

    const kind = entry.kind.trim()
    const note = typeof entry.note === 'string' ? entry.note.toLowerCase() : ''
    const forbiddenKind = FORBIDDEN_KIND_MARKERS.some((marker) =>
      kind.toLowerCase().includes(marker),
    )
    const loosenedNote =
      note.includes('loosen') ||
      note.includes('weaken') ||
      note.includes('delete scenario') ||
      note.includes('change expected')

    if (forbiddenKind || loosenedNote) {
      issues.push(
        issue(
          'marshal.assertion_loosened',
          `Marshaling edit ${String(index)} changes an assertion, deletes a scenario, or changes an expected outcome.`,
        ),
      )
      continue
    }

    if (!ALLOWED_KINDS.has(kind)) {
      issues.push(
        issue(
          'marshal.edit_kind',
          `Marshaling edit ${String(index)} kind '${kind}' is not call_site, import, name, or fixture_shape.`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
