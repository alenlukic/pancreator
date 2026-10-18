/**
 * The non-blocking evidence-gap result class.
 *
 * Operator directive of 2026-10-18: the workflow MUST NOT block on
 * irretrievable evidence. Absence of evidence is not evidence of an issue, so
 * a criterion fails only on an identified defect: a cited file and line, a
 * failing test, a reproducible observation, or a concrete contradiction.
 * Evidence that is absent, unavailable, stale, superseded, or
 * environment-blocked is an evidence gap instead. A gap is recorded and
 * reported, and it never fails a stage, routes to remediation, or counts
 * toward a repeated-failure signature (`VERIFY-001`).
 */

import { isRecord } from './io.js'

/** The acceptance result that records an evidence gap. */
export const EVIDENCE_UNAVAILABLE_RESULT = 'evidence_unavailable'

/** Results that read as an evidence gap, the canonical one first. */
export const EVIDENCE_GAP_RESULTS: readonly string[] = [
  EVIDENCE_UNAVAILABLE_RESULT,
  'unverified',
  'environment_blocked',
]

/** Whether an acceptance or criterion result records an evidence gap. */
export function isEvidenceGapResult(result: unknown): boolean {
  return (
    typeof result === 'string' &&
    EVIDENCE_GAP_RESULTS.includes(result.trim().toLowerCase())
  )
}

/** Whether a result names a defect: only `fail` does. */
export function isDefectResult(result: unknown): boolean {
  return typeof result === 'string' && result.trim().toLowerCase() === 'fail'
}

/**
 * One risk line per evidence-gap acceptance result, naming the criterion, the
 * gap reason, and its owner when the result records them.
 */
export function evidenceGapRisks(acceptanceResults: unknown): string[] {
  if (!Array.isArray(acceptanceResults)) {
    return []
  }

  return acceptanceResults.flatMap((item) => {
    if (!isRecord(item) || !isEvidenceGapResult(item.result)) {
      return []
    }

    const id = typeof item.id === 'string' ? item.id : 'unnamed criterion'
    const reason =
      typeof item.gap_reason === 'string' && item.gap_reason.trim()
        ? item.gap_reason.trim()
        : 'no reason recorded'
    const owner =
      typeof item.gap_owner === 'string' && item.gap_owner.trim()
        ? `; owner: ${item.gap_owner.trim()}`
        : ''

    return [`Evidence gap for ${id}: ${reason}${owner}. Non-blocking.`]
  })
}

/**
 * The reason a declared `failure` is an evidence gap rather than a defect, or
 * null when the output names a defect or is no failure at all.
 *
 * A failure qualifies only when its acceptance results record at least one
 * evidence gap, no acceptance result or self-evaluated criterion is `fail`,
 * and the output holds no blocked section. Such an output cites no defect, so
 * the declared failure has nothing a remediation could repair.
 */
export function evidenceGapOnlyFailure(value: unknown): string | null {
  if (!isRecord(value) || value.result !== 'failure') {
    return null
  }

  const data = isRecord(value.data) ? value.data : {}
  const acceptance = Array.isArray(data.acceptance_results)
    ? data.acceptance_results
    : []
  const criteria = Array.isArray(value.criteria) ? value.criteria : []
  const gaps = acceptance.filter(
    (item) => isRecord(item) && isEvidenceGapResult(item.result),
  )
  const namesDefect =
    acceptance.some((item) => isRecord(item) && isDefectResult(item.result)) ||
    criteria.some((item) => isRecord(item) && isDefectResult(item.result))

  if (gaps.length === 0 || namesDefect || data.blocked !== undefined) {
    return null
  }

  const ids = gaps.map((item) =>
    isRecord(item) && typeof item.id === 'string' ? item.id : '?',
  )

  return (
    `The output declared failure, but its acceptance results record only ` +
    `evidence gaps (${ids.join(', ')}) and no defect. An evidence gap never ` +
    `fails a stage, so the harness graded the submission as success.`
  )
}
