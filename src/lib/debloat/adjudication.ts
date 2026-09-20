import type { Facility } from './inventory.js'
import type { FacilityUsage } from './usage.js'

export type DeterministicVerdict = 'unused' | 'unclear' | 'retained'
export type AgenticVerdict = 'remove' | 'keep'

export interface CandidateAssessment {
  facility_id: string
  deterministic_verdict: DeterministicVerdict
  deterministic_reason: string
}

export interface AgenticAdjudication {
  facility_id: string
  verdict: AgenticVerdict
  reasoning: string
  evidence: string[]
  recorded_at: string
}

const UNCLEAR_CATEGORIES = new Set([
  'handbook',
  'skill',
  'template',
  'validator',
])

/**
 * Static evidence may retain a node, but an agentic verdict never clears that
 * deterministic retention. The agentic pass only settles an unclear candidate.
 */
export function assessCandidate(
  facility: Facility,
  usage: FacilityUsage | undefined,
): CandidateAssessment {
  if (facility.node_kind === 'orphan') {
    return {
      facility_id: facility.id,
      deterministic_verdict: 'unused',
      deterministic_reason: `The independent symbol pass classified it as ${facility.orphan_kind ?? 'orphaned'}.`,
    }
  }

  if (usage?.evidence_tier !== 'none') {
    return {
      facility_id: facility.id,
      deterministic_verdict: 'retained',
      deterministic_reason: `Usage evidence tier is ${usage?.evidence_tier ?? 'unknown'}.`,
    }
  }

  if (usage.test_only_references || UNCLEAR_CATEGORIES.has(facility.category)) {
    return {
      facility_id: facility.id,
      deterministic_verdict: 'unclear',
      deterministic_reason: usage.test_only_references
        ? 'Only tests or registry entries reference this candidate.'
        : 'This category has no complete direct execution record.',
    }
  }

  return {
    facility_id: facility.id,
    deterministic_verdict: 'unused',
    deterministic_reason:
      'No execution, reachable dependency, or operator mention exists in the window.',
  }
}

export function adjudicationAllowsSelection(
  assessment: CandidateAssessment,
  adjudication: AgenticAdjudication | undefined,
): boolean {
  if (assessment.deterministic_verdict === 'retained') {
    return false
  }

  if (assessment.deterministic_verdict === 'unused') {
    return true
  }

  return adjudication?.verdict === 'remove'
}
