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

/** Resolve waivers still bound to the latest stage attempt and active fingerprint. */
export function activeOperatorGateWaivers(
  state: WaiverStateLike,
  workspaceFingerprint?: string,
): OperatorGateWaiver[] {
  const history = stageHistoryItems(state.stage_history)
  const waivers = gateWaivers(state.operator_gate_waivers)
  const acceptedFingerprint =
    typeof state.accepted_workspace_fingerprint === 'string'
      ? state.accepted_workspace_fingerprint
      : null
  const validFingerprints = new Set(
    [workspaceFingerprint, acceptedFingerprint].filter(
      (value): value is string => typeof value === 'string',
    ),
  )

  return waivers.filter((waiver) => {
    const latest = [...history]
      .reverse()
      .find((item) => item.stage === waiver.stage)

    if (
      latest?.invocation_id !== waiver.source_invocation_id ||
      latest.workspace_fingerprint !== waiver.workspace_fingerprint
    ) {
      return false
    }

    return (
      validFingerprints.size === 0 ||
      validFingerprints.has(waiver.workspace_fingerprint)
    )
  })
}
