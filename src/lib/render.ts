import type { Invocation, RunState, StageOutcome, TaskRecord } from './types.js'
import type { InvocationValidationStatus } from './validation.js'

const OUTCOME_EMOJI: Record<StageOutcome, string> = {
  success: '✅',
  blocked: '⏸️',
  failure: '❌',
}

function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Render an invocation card for both the operator and the assigned worker. */
export function renderInvocationMarkdown(invocation: Invocation): string {
  const { stage } = invocation
  const requiredData = Object.entries(invocation.output.required_data)
  const references = invocation.inputs.references.length
    ? invocation.inputs.references.map(
        (item) => `- \`${item.path}\` — ${item.description}`,
      )
    : ['- No prior artifacts; start from the request.']
  const policies = invocation.policies.length
    ? invocation.policies.flatMap((policy) => {
        const lines = [
          `- **${policy.id} · ${policy.title}**`,
          `  ${policy.summary}`,
          ...policy.instructions.map((instruction) => `  - ${instruction}`),
        ]

        return [lines.join('\n')]
      })
    : ['- Only global boundaries apply.']
  const requirementRows = invocation.requirements
    ? [
        '| Policy | Requirement | Registry | Phase | Executor | Target | Success | Failure route |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...[
          ...invocation.requirements.automation_requirements,
          ...invocation.requirements.validation_requirements,
        ].map(
          (requirement) =>
            `| ${requirement.policy_id} | ${requirement.requirement_id} | ` +
            `${requirement.registry_id}@${requirement.registry_version} | ` +
            `${requirement.phase} | ${requirement.executor} | ` +
            `${requirement.resolved_target ?? requirement.target} | ` +
            `${requirement.success_condition} | ${requirement.failure_route} |`,
        ),
      ]
    : []
  const gateOverrideEntries = Object.entries(invocation.gate_overrides ?? {})
  const gateOverrideLines = gateOverrideEntries.map(([id, command]) =>
    command === false
      ? `- 🚫 **${id}** — disabled by run configuration.`
      : `- 🛠️ **${id}** — overridden: \`${command}\``,
  )
  const requiredDataLines = requiredData.length
    ? [
        'Required `data` fields:',
        ...requiredData.map(
          ([key, typeName]) => `- \`data.${key}\`: ${typeName}`,
        ),
      ]
    : ['No stage-specific `data` fields are required.']

  const lines = [
    `# 🚀 ${invocation.$operator.headline}`,
    '',
    `**Run** \`${invocation.run_id}\` · **Stage** ${stage.title} ` +
      `(\`${stage.slug}\`) · **Owner** \`${stage.persona}\` · ` +
      `**Model** \`${stage.model}\` · **Attempt** ${invocation.attempt}`,
    '',
    `**Workspace** \`${invocation.workspace_root}\` — fingerprints, ` +
      'deterministic gate commands, and scope checks target this directory.',
    '',
    '## Operator view',
    '',
    invocation.$operator.summary,
    '',
    `**Next action:** ${invocation.$operator.next_action}`,
    '',
    '## 📋 Task',
    '',
    invocation.prompt,
    '',
    '## 📥 Inputs',
    '',
    ...references,
    '',
    '## 📜 Policies in force',
    '',
    ...policies,
    '',
    ...(requirementRows.length > 0
      ? ['## ✅ Validation requirements', '', ...requirementRows, '']
      : []),
    '## 🎯 Rubric',
    '',
    ...invocation.rubric.map(
      (criterion) =>
        `- ${criterion.hard ? '🔴 hard' : '⚪ soft'} ` +
        `**${criterion.id}** (${criterion.type}) — ${criterion.statement}`,
    ),
    '',
    ...(gateOverrideLines.length > 0
      ? ['## 🧪 Gate overrides', '', ...gateOverrideLines, '']
      : []),
    '## 📤 Output contract',
    '',
    `Write JSON to \`${invocation.output.path}\` using ` +
      `\`${invocation.output.template}\` as the base shape ` +
      `(schema \`${invocation.output.schema}\`).`,
    '',
    ...requiredDataLines,
    '',
    '## 🚧 Boundaries',
    '',
    ...invocation.boundaries.map((item) => `- ${item}`),
    '',
    '## Technical appendix',
    '',
    fencedJson({
      invocation_id: invocation.invocation_id,
      workflow: invocation.workflow,
      workspace_root: invocation.workspace_root,
      workspace_fingerprint: invocation.workspace_before.fingerprint,
      model: stage.model,
      model_config: stage.model_config,
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    }),
  ]

  return `${lines.join('\n')}\n`
}

/** Render the operator-facing execution record for one submitted stage. */
export function renderTaskRecord(record: TaskRecord): string {
  const checks = record.evaluation.deterministic.length
    ? record.evaluation.deterministic.map((item) => {
        const evidence = item.evidence_path
          ? ` — \`${item.evidence_path}\``
          : ''
        const explanation = item.explanation ? ` — ${item.explanation}` : ''

        return (
          `- ${item.passed ? '✅' : '❌'} **${item.id}**` +
          evidence +
          explanation
        )
      })
    : ['- No deterministic checks were declared for this stage.']
  const artifacts = record.artifacts.length
    ? record.artifacts.map((item) => `- \`${item.path}\` — ${item.description}`)
    : ['- No durable artifacts declared.']
  const risks = [
    ...record.risks.map((item) => `- ⚠️ Risk: ${item}`),
    ...record.unknowns.map((item) => `- ❓ Unknown: ${item}`),
  ]

  const sections = [
    `# ${OUTCOME_EMOJI[record.outcome]} ${record.stage.title}: ` +
      record.outcome,
    '',
    record.summary,
    '',
    `**Next state:** ${record.next_state}`,
    '',
    '## 📦 Work completed',
    '',
    ...artifacts,
    '',
    '## 🔍 Checks',
    '',
    ...checks,
  ]

  if (record.evaluation.validation_errors.length > 0) {
    sections.push(
      '',
      '## ❌ Output validation issues',
      '',
      ...record.evaluation.validation_errors.map((item) => `- ${item}`),
    )
  }

  sections.push(
    '',
    '## ⚠️ Risks and unknowns',
    '',
    ...(risks.length > 0 ? risks : ['- None declared.']),
    '',
    '## Technical appendix',
    '',
    fencedJson({
      run_id: record.run_id,
      invocation_id: record.invocation_id,
      persona: record.stage.persona,
      workspace_fingerprint: record.workspace_fingerprint,
      timestamp: record.timestamp,
    }),
  )

  return `${sections.join('\n')}\n`
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

/** Render a one-screen status summary for `pan status`. */
export function renderStatus(
  state: RunState,
  validationStatus: InvocationValidationStatus | null = null,
): string {
  const lines = [
    `Run ${state.run_id}`,
    `Status: ${state.status}`,
    `Workflow: ${state.workflow_slug}`,
    `Model config: ${state.pipeline_config?.name ?? 'live default'}`,
    `Workspace: ${state.workspace_root || '.'}`,
    `Current stage: ${state.current_stage ?? 'none'}`,
    `Pending action: ${state.pending_action.type}`,
    `Revision: ${state.revision}`,
    `Transitions: ${state.transition_count}/` +
      state.limits.max_total_transitions,
  ]

  if ('path' in state.pending_action) {
    lines.push(`Card: ${state.pending_action.path}`)
  }

  if (state.pause_reason) {
    lines.push(`Pause reason: ${state.pause_reason}`)
  }

  if ((state.operator_gate_waivers ?? []).length > 0) {
    lines.push('', '## Operator gate waivers', '')

    for (const waiver of state.operator_gate_waivers ?? []) {
      lines.push(
        `- ${waiver.stage} attempt ${waiver.source_attempt}: ` +
          `${waiver.criterion_ids.join(', ')} ` +
          `(${waiver.artifact_path})`,
      )

      if (waiver.spotfix_case_path) {
        lines.push(`  Follow-up: ${waiver.spotfix_case_path}`)
      }
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
