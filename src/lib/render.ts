import type { Invocation, RunState } from './types.js'
import type { InvocationValidationStatus } from './validation.js'

function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Render an invocation card for both the operator and the assigned worker. */
export function renderInvocationMarkdown(invocation: Invocation): string {
  const { stage } = invocation
  const requiredData = Object.entries(invocation.output.required_data)
  const referenceLines = (
    retrieval: 'required' | 'conditional' | 'index_only',
  ) =>
    invocation.inputs.references
      .filter((item) => (item.retrieval ?? 'required') === retrieval)
      .flatMap((item) => [
        `- \`${item.path}\` — ${item.description}`,
        ...(item.condition ? [`  - Read when: ${item.condition}`] : []),
      ])
  const requiredReferences = referenceLines('required')
  const conditionalReferences = referenceLines('conditional')
  const indexReferences = referenceLines('index_only')
  const missingRequired = invocation.inputs.missing_required ?? []
  const policies = invocation.policies.length
    ? invocation.policies.flatMap((policy) => {
        const lines = [
          `**${policy.id} · ${policy.title}**`,
          '',
          policy.summary,
          '',
          ...policy.instructions.map((instruction) => `- ${instruction}`),
        ]

        for (const guidance of policy.guidance ?? []) {
          lines.push(
            '',
            `### Unrolled guidance · \`${guidance.source_path}\``,
            '',
            guidance.content,
          )
        }

        return [lines.join('\n'), '']
      })
    : ['- Only global boundaries apply.']
  const requirements = invocation.requirements
    ? [
        ...invocation.requirements.automation_requirements,
        ...invocation.requirements.validation_requirements,
      ]
    : []
  const agentRequirements = requirements.filter(
    (requirement) => requirement.executor !== 'harness',
  )
  const harnessRequirements = requirements.filter(
    (requirement) => requirement.executor === 'harness',
  )
  const requirementRows = agentRequirements.length
    ? [
        '| Policy | Requirement | Registry | Phase | Executor | Target | Success | Failure route |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...agentRequirements.map(
          (requirement) =>
            `| ${requirement.policy_id} | ${requirement.requirement_id} | ` +
            `${requirement.registry_id}@${requirement.registry_version} | ` +
            `${requirement.phase} | ${requirement.executor} | ` +
            `${requirement.resolved_target ?? requirement.target} | ` +
            `${requirement.success_condition} | ${requirement.failure_route} |`,
        ),
      ]
    : []
  const harnessRequirementLines = harnessRequirements.map(
    (requirement) =>
      `- \`${requirement.registry_id}@${requirement.registry_version}\` — ` +
      `${requirement.requirement_id} (${requirement.phase}); harness-owned, no agent action.`,
  )
  const gateOverrideEntries = Object.entries(invocation.gate_overrides ?? {})
  const gateOverrideLines = gateOverrideEntries.map(([id, command]) =>
    command === false
      ? `- 🚫 **${id}** — disabled by run configuration.`
      : `- 🛠️ **${id}** — overridden: \`${command}\``,
  )
  const operatorBrief = invocation.output.operator_brief as
    | Invocation['output']['operator_brief']
    | undefined
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
    '### Required inputs',
    '',
    ...(requiredReferences.length > 0
      ? requiredReferences
      : ['- No required artifact inputs.']),
    '',
    ...(conditionalReferences.length > 0
      ? ['### Conditional references', '', ...conditionalReferences, '']
      : []),
    ...(indexReferences.length > 0
      ? ['### Context index', '', ...indexReferences, '']
      : []),
    ...(missingRequired.length > 0
      ? [
          '### Missing required context',
          '',
          ...missingRequired.map((item) => `- ${item}`),
          '',
        ]
      : []),
    '## 📜 Policies in force',
    '',
    ...policies,
    '',
    ...(requirementRows.length > 0
      ? ['## ✅ Agent validation requirements', '', ...requirementRows, '']
      : []),
    ...(harnessRequirementLines.length > 0
      ? ['## 🧰 Harness-owned checks', '', ...harnessRequirementLines, '']
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
    ...(operatorBrief
      ? [
          `Author the operator brief source at ` +
            `\`${operatorBrief.source_path}\` using schema ` +
            `\`${operatorBrief.schema}\`, then render it to ` +
            `\`${operatorBrief.rendered_path}\` with ` +
            `\`${operatorBrief.renderer}\` and satisfy the ` +
            `\`${operatorBrief.profile}\` operator-artifact profile. ` +
            `Required section-heading phrases: ${operatorBrief.required_headings.join(', ')}. ` +
            'The harness rerenders the same source during submission and treats the ' +
            'HTML as artifact 0 and the brief JSON as artifact 1.',
          '',
        ]
      : [
          'This legacy invocation retains the artifact contract captured when it was prepared.',
          '',
        ]),
    ...requiredDataLines,
    '',
    'When tracked workspace files change during the stage, include top-level `workspace_changes` with `attribution`, every changed path in `paths`, and a concise `explanation`. Use `attribution: internal` only when the active worker can trace every listed change to its own actions; the cleanliness gate blocks only external or unattributed contamination.',
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
