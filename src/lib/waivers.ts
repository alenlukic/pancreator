import { isRecord } from './io.js'
import type { OperatorGateWaiver, StageHistoryItem } from './types.js'

interface WaiverStateLike {
  stage_history?: unknown
  operator_gate_waivers?: unknown
  accepted_workspace_fingerprint?: unknown
}

function stageHistoryItems(value: unknown): StageHistoryItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is StageHistoryItem => {
    return (
      isRecord(item) &&
      typeof item.stage === 'string' &&
      typeof item.invocation_id === 'string' &&
      typeof item.workspace_fingerprint === 'string'
    )
  })
}

function gateWaivers(value: unknown): OperatorGateWaiver[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is OperatorGateWaiver => {
    return (
      isRecord(item) &&
      typeof item.waiver_id === 'string' &&
      typeof item.stage === 'string' &&
      typeof item.source_invocation_id === 'string' &&
      typeof item.workspace_fingerprint === 'string' &&
      typeof item.artifact_path === 'string' &&
      typeof item.source_evidence_path === 'string'
    )
  })
}

/** Resolve operator directives that have not been superseded by a later attempt of the same stage. */
export function activeOperatorGateWaivers(
  state: WaiverStateLike,
  _workspaceFingerprint?: string,
): OperatorGateWaiver[] {
  const history = stageHistoryItems(state.stage_history)
  const waivers = gateWaivers(state.operator_gate_waivers)

  return waivers.filter((waiver) => {
    const sourceIndex = history.findIndex(
      (item) => item.invocation_id === waiver.source_invocation_id,
    )

    if (sourceIndex >= 0) {
      return !history
        .slice(sourceIndex + 1)
        .some((item) => item.stage === waiver.stage)
    }

    const waiverTime = Date.parse(waiver.timestamp)

    return !history.some((item) => {
      const submittedTime = Date.parse(item.submitted_at)
      return (
        item.stage === waiver.stage &&
        Number.isFinite(waiverTime) &&
        Number.isFinite(submittedTime) &&
        submittedTime > waiverTime
      )
    })
  })
}

/**
 * Whether one waiver's declared scope covers one criterion of one stage.
 *
 * `*` is the whole-stage scope the waiver command writes when the operator
 * names no criterion.
 */
export function waiverCoversCriterion(
  waiver: Pick<OperatorGateWaiver, 'stage' | 'criterion_ids'>,
  stageSlug: string,
  criterionId: string,
): boolean {
  return (
    waiver.stage === stageSlug &&
    (waiver.criterion_ids.includes('*') ||
      waiver.criterion_ids.includes(criterionId))
  )
}

/**
 * Newest active waiver covering a stage's entry-gate criterion, or null.
 *
 * The entry gate reads the same waiver set the submission gate reads, so an
 * operator directive reaches the gate that runs before delegation instead of
 * being silently confined to the gate that runs after it.
 */
export function entryGateWaiver(
  state: WaiverStateLike,
  stageSlug: string,
  criterionId: string,
): OperatorGateWaiver | null {
  return (
    [...activeOperatorGateWaivers(state)]
      .reverse()
      .find((waiver) =>
        waiverCoversCriterion(waiver, stageSlug, criterionId),
      ) ?? null
  )
}
