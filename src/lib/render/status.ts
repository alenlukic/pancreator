/**
 * `pan status` rendering: attributed changes, validation artifact status, and
 * the delivery and supervisor handoffs.
 */

import {
  passedGateEvidence,
  gateEvidenceLabel,
} from '../context/gate-evidence.js'
import { renderSuiteProfileStatusLine } from '../suite-profile.js'
import type { Invocation, RunState, SuiteProfileSummary } from '../types.js'
import type { InvocationValidationStatus } from '../validation/artifacts.js'
import { DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION } from '../workspace-attribution.js'
import { latestHandoffStatus } from '../supervisor-handoff.js'

/**
 * Workspace changes an operator directive already accounted for.
 *
 * Without this section the delta belongs to no stage on the card, and each
 * worker audits it again before reporting it as unattributed.
 */
export function attributedChangeLines(invocation: Invocation): string[] {
  const records = invocation.attributed_changes ?? []

  if (records.length === 0) {
    return []
  }

  return [
    '## 📌 Attributed workspace changes',
    '',
    'An operator directive accounts for the paths below. Do not report them ' +
      'as unattributed, and do not audit them to find their author.',
    '',
    ...records.flatMap((record) => [
      `- **${record.acting_role}** executed an operator directive at ` +
        `${record.timestamp} (\`${record.artifact_path}\`, disposition ` +
        `\`${record.disposition ?? DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION}\`): ` +
        record.directive,
      ...record.changed_paths.map((item) => `  - \`${item}\``),
    ]),
    '',
  ]
}

function formatValidationArtifactStatus(
  label: string,
  artifactPath: string,
  load: InvocationValidationStatus['invocation'],
): string[] {
  if ('state' in load) {
    if (load.state === 'missing') {
      return [`${label}: missing`, `  Artifact: ${artifactPath}`]
    }

    return [
      `${label}: malformed`,
      `  Artifact: ${artifactPath}`,
      `  Reason: ${load.reason}`,
    ]
  }

  const statusLabel = load.status === 'pass' ? 'pass' : 'fail'
  const lines = [
    `${label}: ${statusLabel}`,
    `  Artifact: ${artifactPath}`,
    `  Summary: ${load.summary}`,
  ]
  const failedChecks = load.checks.filter((check) => !check.passed)

  if (failedChecks.length > 0) {
    lines.push(
      ...failedChecks.map((check) => `  - ${check.id}: ${check.message}`),
    )
  }

  return lines
}

function renderDeliveryHandoff(
  handoff: RunState['delivery_handoff'],
): string[] {
  if (!handoff) {
    return []
  }

  switch (handoff.kind) {
    case 'delivery':
      return [`Delivery handoff: run ${handoff.run_id} in ${handoff.worktree}`]
    case 'cohort':
      return [`Delivery handoff: cohort ${handoff.cohort_id}`]
    case 'failed':
      return [
        `Delivery route failed: ${handoff.error}`,
        ...handoff.manual_commands.map((command) => `  Manual: ${command}`),
      ]
    default: {
      const exhaustive: never = handoff

      throw new Error(`Unhandled delivery handoff kind: ${String(exhaustive)}`)
    }
  }
}

/** Render a one-screen status summary for `pan status`. */
/** The latest supervisor handoff and the note the receiving session reads. */
function renderSupervisorHandoff(state: RunState): string[] {
  const handoff = latestHandoffStatus(state)

  if (!handoff) {
    return []
  }

  return [
    `Supervisor handoff: ${handoff.status} (${handoff.id})` +
      (handoff.aborted_code ? `, ${handoff.aborted_code}` : ''),
    ...(handoff.note_path ? [`Handoff note: ${handoff.note_path}`] : []),
  ]
}

export function renderStatus(
  state: RunState,
  validationStatus: InvocationValidationStatus | null = null,
  suiteProfile: SuiteProfileSummary | null = null,
): string {
  const lines = [
    `Run ${state.run_id}`,
    `Status: ${state.status}`,
    `Workflow: ${state.workflow_slug}`,
    `Model config: ${state.pipeline_config?.name ?? 'live default'}`,
    `Workspace: ${state.workspace_root || '.'}`,
    ...(state.managed_worktree
      ? [
          `Managed worktree: ${state.managed_worktree.name}`,
          `Managed branch: ${state.managed_worktree.branch}`,
        ]
      : []),
    ...(state.request.context_reference
      ? [`Context reference: ${state.request.context_reference.source_path}`]
      : []),
    ...(state.cohort?.role === 'release'
      ? [`Release of cohort: ${state.cohort.cohort_id}`]
      : []),
    `Current stage: ${state.current_stage ?? 'none'}`,
    `Pending action: ${state.pending_action.type}`,
    ...renderDeliveryHandoff(state.delivery_handoff),
    ...renderSupervisorHandoff(state),
    `Revision: ${state.revision}`,
    `Transitions: ${state.transition_count}/` +
      state.limits.max_total_transitions,
  ]

  if (state.operator_involvement) {
    const { profile, contracts } = state.operator_involvement

    lines.push(
      `Involvement profile: ${profile}` +
        (contracts.length > 0 ? ` (contracts: ${contracts.join(', ')})` : ''),
    )
  }

  if ('path' in state.pending_action) {
    lines.push(`Card: ${state.pending_action.path}`)
  }

  if (state.agent_health) {
    lines.push(
      `Agent health: ${state.agent_health.health}`,
      `Health evidence time: ${state.agent_health.evidence_at}`,
      `Recovery state: ${state.agent_health.recovery.step ?? 'none'}`,
    )
  } else if (state.pending_action.type === 'invoke_agent') {
    lines.push(
      'Agent health: unknown',
      'Health evidence time: unavailable',
      'Recovery state: none',
    )
  }

  if (state.pause_reason) {
    lines.push(`Pause reason: ${state.pause_reason}`)
  }

  if (suiteProfile) {
    lines.push(renderSuiteProfileStatusLine(suiteProfile))
  }

  if ((state.operator_gate_waivers ?? []).length > 0) {
    lines.push('', '## Operator gate waivers', '')

    for (const waiver of state.operator_gate_waivers ?? []) {
      lines.push(
        `- ${waiver.stage} attempt ${waiver.source_attempt}: ` +
          `${waiver.criterion_ids.join(', ')} → ${waiver.directive_target ?? 'stage success'} ` +
          `(${waiver.artifact_path})`,
      )

      if (waiver.whole_stage_bypass) {
        lines.push('  Whole-stage bypass: true')
      }

      if (waiver.spotfix_case_path) {
        lines.push(`  Follow-up: ${waiver.spotfix_case_path}`)
      }
    }
  }

  const appliedGates = Object.entries(
    state.operator_involvement?.applied_gates ?? {},
  )

  if (appliedGates.length > 0) {
    lines.push('', '## Run gates replacing workflow defaults', '')

    for (const [slug, change] of appliedGates) {
      lines.push(
        `- ${slug}: ${change.workflow_gate} → ${change.run_gate} ` +
          `(${change.source})`,
      )
    }
  }

  if (Object.keys(state.operator_revisions ?? {}).length > 0) {
    lines.push('', '## Operator revisions granted', '')

    for (const [slug, count] of Object.entries(
      state.operator_revisions ?? {},
    )) {
      lines.push(
        `- ${slug}: ${count} extra attempt${count === 1 ? '' : 's'} ` +
          `(ceiling ${state.limits.max_stage_attempts + count})`,
      )
    }
  }

  if ((state.operator_workspace_ratifications ?? []).length > 0) {
    const latest = state.operator_workspace_ratifications?.at(-1)

    if (latest) {
      lines.push(
        '',
        '## Latest workspace ratification',
        '',
        `Fingerprint: ${latest.workspace_fingerprint}`,
        `Artifact: ${latest.artifact_path}`,
      )
    }
  }

  // ORCH-001: the supervisor reads this inventory to avoid a duplicate run.
  const gateEvidence = passedGateEvidence(state)

  if (gateEvidence.length > 0) {
    const latestFingerprint =
      state.stage_history.at(-1)?.workspace_fingerprint ?? null

    lines.push('', '## Gate evidence', '')

    for (const evidence of gateEvidence) {
      const currency =
        evidence.fingerprint === latestFingerprint ? 'current' : 'superseded'
      const label = gateEvidenceLabel(evidence)

      lines.push(
        `- ${evidence.profile}: ${label} at ${evidence.fingerprint} ` +
          `(${evidence.origin}) — ${evidence.evidencePath} [${currency}]`,
      )
    }
  }

  if ((state.advisories ?? []).length > 0) {
    lines.push('', '## Advisories', '')

    for (const advisory of state.advisories ?? []) {
      const context = advisory.stage
        ? `${advisory.stage} (${advisory.source})`
        : advisory.source

      lines.push(`- ${context}: ${advisory.message}`)
    }
  }

  if (validationStatus) {
    lines.push('', '## Validation', '')
    lines.push(
      ...formatValidationArtifactStatus(
        'Invocation validation',
        validationStatus.invocation_validation_path,
        validationStatus.invocation,
      ),
    )
    lines.push(
      ...formatValidationArtifactStatus(
        'Delegation validation',
        validationStatus.delegation_validation_path,
        validationStatus.delegation,
      ),
    )
    lines.push(`Delegation artifact: ${validationStatus.delegation_path}`)
  }

  return `${lines.join('\n')}\n`
}
