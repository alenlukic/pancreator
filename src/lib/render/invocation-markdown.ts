/** The invocation card Markdown and its policy pointers. */

import { GATE_CACHE_ACCEPTANCE_RULE } from '../gate-cache.js'
import { renderSuiteProfileSection } from '../suite-profile.js'
import {
  type PolicyRulePointer,
  renderContextReferenceBlock,
  renderPolicyBlocks,
} from '../policy-guidance.js'
import { effectiveRepositoryCheckProfile } from '../verification.js'
import type { Invocation, Criterion } from '../types.js'
import { DELEGATION_HEADING } from '../validation/artifacts.js'
import { fencedJson } from './contract.js'
import { evidenceWorkerAttempts } from './delivery-prompt.js'
import { renderSupervisorProcedureBody } from './supervisor-procedure.js'
import { renderScopedReturn } from './remediation-return.js'
import { renderEvidenceWorkerSkips } from './evidence-worker-brief.js'
import { attributedChangeLines } from './status.js'

/**
 * The resolved repository-check gate bound for one rubric criterion.
 *
 * A worker asked to cite the bound it runs under had only
 * `runtime/repository-checks.json` to read, and quoted a value the gate did
 * not enforce: the run snapshots its own criterion timeout at creation, and a
 * verification level can remap the profile underneath it. Both resolved facts
 * come from the invocation, so the card states what actually binds.
 */
function renderResolvedGateBound(
  invocation: Invocation,
  criterion: Criterion,
): string {
  const { profile, skipped } = effectiveRepositoryCheckProfile(
    invocation.verification,
    criterion,
  )

  if (skipped) {
    return ` Gate: skipped at verification level \`${invocation.verification?.level}\`.`
  }

  if (!profile) {
    return ''
  }

  const command = `pan repository-check ${profile}`

  return criterion.timeout_ms === undefined
    ? ` Gate: \`${command}\`, no snapshotted bound; the profile's own configured budget applies.`
    : ` Gate: \`${command}\`, resolved timeout ${criterion.timeout_ms} ms from the run snapshot.`
}

/** Render an invocation card for both the operator and the assigned worker. */
/** The pointer-delivered policies of a worker card, keyed by policy id. */
export function invocationPolicyPointers(
  invocation: Pick<Invocation, 'policy_delivery'>,
): Map<string, PolicyRulePointer> {
  const pointers = new Map<string, PolicyRulePointer>()

  for (const [policyId, delivery] of Object.entries(
    invocation.policy_delivery ?? {},
  )) {
    if (delivery.mode === 'pointer') {
      pointers.set(policyId, {
        target: delivery.target,
        sha256: delivery.sha256,
      })
    }
  }

  return pointers
}

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
  const contextReference = invocation.inputs.context_reference
  const contextReferenceLines = contextReference
    ? renderContextReferenceBlock(
        3,
        contextReference,
        contextReference.reference_status,
        contextReference.actual_content_sha256,
      ).slice(1)
    : []

  const policies = renderPolicyBlocks(
    invocation.policies,
    3,
    'agent',
    new Set(),
    new Set(),
    invocationPolicyPointers(invocation),
  )
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
        '| Policy | Requirement | Registry | Phase | Executor | Enforcement | Target | Success | Failure route |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...agentRequirements.map(
          (requirement) =>
            `| ${requirement.policy_id} | ${requirement.requirement_id} | ` +
            `${requirement.registry_id}@${requirement.registry_version} | ` +
            `${requirement.phase} | ${requirement.executor} | ${requirement.enforcement} | ` +
            `${requirement.resolved_target ?? requirement.target} | ` +
            `${requirement.success_condition} | ${requirement.failure_route} |`,
        ),
      ]
    : []
  const harnessRequirementLines = harnessRequirements.map(
    (requirement) =>
      `- \`${requirement.registry_id}@${requirement.registry_version}\` — ` +
      `${requirement.requirement_id} (${requirement.phase}, ${requirement.enforcement}); harness-owned, no agent action.`,
  )

  const gateOverrideEntries = Object.entries(invocation.gate_overrides ?? {})
  const gateOverrideLines = gateOverrideEntries.map(([id, command]) =>
    command === false
      ? `- 🚫 **${id}** — disabled by run configuration.`
      : `- 🛠️ **${id}** — overridden: \`${command}\``,
  )

  const priorFailure = invocation.prior_failure
  const priorFailureReasons =
    (priorFailure?.failed_hard_criteria.length ?? 0) +
    (priorFailure?.declared_criteria_failures?.length ?? 0) +
    (priorFailure?.failed_deterministic.length ?? 0) +
    (priorFailure?.validation_errors.length ?? 0) +
    (priorFailure?.governance_artifact_warnings.length ?? 0) +
    (priorFailure?.supervisor_assessment ? 1 : 0)
  const priorFailureLines = priorFailure
    ? [
        '## ⛔ Why the previous attempt failed',
        '',
        (priorFailure.outcome === 'success' &&
        priorFailure.supervisor_assessment
          ? `Attempt ${priorFailure.attempt} of \`${priorFailure.stage}\` ` +
            'submitted cleanly but was rejected by the supervisor. '
          : `Attempt ${priorFailure.attempt} of \`${priorFailure.stage}\` ` +
            `ended in \`${priorFailure.outcome}\`. `) +
          (priorFailureReasons === 0
            ? 'No reason of any kind was recorded for it.'
            : 'This is the complete recorded reason. ' +
              'Address every item below; resubmitting unchanged work will fail the ' +
              'same way.'),
        '',
        ...(priorFailure.failed_hard_criteria.length > 0
          ? [
              '### Hard criteria that did not pass',
              '',
              ...priorFailure.failed_hard_criteria.flatMap((criterion) => [
                `- **${criterion.id}** (${criterion.type}) — ${criterion.statement}`,
                ...(criterion.explanation
                  ? [`  - Recorded explanation: ${criterion.explanation}`]
                  : []),
              ]),
              '',
            ]
          : []),
        ...((priorFailure.declared_criteria_failures?.length ?? 0) > 0
          ? [
              '### Criteria the attempt reported failing',
              '',
              ...(priorFailure.declared_criteria_failures ?? []).map(
                (criterion) =>
                  `- **${criterion.id}** (${criterion.result})` +
                  (criterion.explanation ? ` — ${criterion.explanation}` : ''),
              ),
              '',
            ]
          : []),
        ...(priorFailure.failed_deterministic.length > 0
          ? [
              '### Deterministic checks that failed',
              '',
              ...priorFailure.failed_deterministic.flatMap((item) => [
                `- **${item.id}**` +
                  (item.command ? ` — \`${item.command}\`` : '') +
                  (item.timed_out
                    ? ' (timed out)'
                    : item.exit_code !== undefined && item.exit_code !== null
                      ? ` (exit ${item.exit_code})`
                      : ''),
                ...(item.evidence_path
                  ? [`  - Evidence: \`${item.evidence_path}\``]
                  : []),
              ]),
              '',
            ]
          : []),
        ...(priorFailure.supervisor_assessment
          ? [
              '### Supervisor assessment',
              '',
              `Verdict \`${priorFailure.supervisor_assessment.verdict}\`` +
                (priorFailure.supervisor_assessment.summary
                  ? ` — ${priorFailure.supervisor_assessment.summary}`
                  : ''),
              '',
              ...(priorFailure.supervisor_assessment.action_items.length > 0
                ? [
                    'Action items:',
                    '',
                    ...priorFailure.supervisor_assessment.action_items.map(
                      (item) => `- ${item}`,
                    ),
                    '',
                  ]
                : []),
            ]
          : []),
        ...(priorFailure.validation_errors.length > 0
          ? [
              '### Output validation errors',
              '',
              ...priorFailure.validation_errors.map((item) => `- ${item}`),
              '',
            ]
          : []),
        ...(priorFailure.governance_artifact_warnings.length > 0
          ? [
              '### Governance and artifact diagnostics',
              '',
              ...priorFailure.governance_artifact_warnings.map(
                (item) => `- ${item}`,
              ),
              '',
            ]
          : []),
        ...(priorFailureReasons === 0
          ? [
              'No specific failing criterion, check, or validation error was ' +
                `recorded. Read \`${priorFailure.output_path}\` and treat the ` +
                'absent reason itself as a defect to report.',
              '',
            ]
          : []),
      ]
    : []

  const stageRepair = invocation.operator_stage_repair
  const stageRepairLines = stageRepair
    ? [
        '## ⛔ Why this attempt exists',
        '',
        `The ${stageRepair.actor} moved this run from \`${stageRepair.from_stage}\` ` +
          `to \`${stageRepair.to_stage}\` and gave this reason. It supersedes ` +
          'every earlier verdict, including any output of the stage the run ' +
          'came from. Treat it as required input.',
        '',
        ...stageRepair.note
          .trim()
          .split('\n')
          .map((line) => `> ${line}`.trimEnd()),
        '',
        `Recorded at \`${stageRepair.path}\`.`,
        '',
      ]
    : []

  const involvement = invocation.operator_involvement
  const appliedGateEntries = Object.entries(involvement?.applied_gates ?? {})
  const involvementLines = involvement
    ? [
        '## 🎚️ Operator involvement',
        '',
        `Profile \`${involvement.profile}\` — ${involvement.summary}`,
        '',
        ...(involvement.contracts.length > 0
          ? [
              `Active run contracts: ${involvement.contracts
                .map((contract) => `\`${contract}\``)
                .join(', ')}.`,
              '',
            ]
          : []),
        ...(appliedGateEntries.length > 0
          ? [
              'Gates this run uses instead of the workflow default:',
              '',
              ...appliedGateEntries.map(
                ([slug, change]) =>
                  `- \`${slug}\`: \`${change.workflow_gate}\` → ` +
                  `\`${change.run_gate}\` (${change.source})`,
              ),
              '',
            ]
          : ['Every stage uses its workflow-declared gate.', '']),
      ]
    : []

  const verification = invocation.verification
  const verificationGateEntries = Object.entries(verification?.gates ?? {})
  const verificationLines = verification
    ? [
        '## 🔬 Verification level',
        '',
        `Level \`${verification.level}\` — ${verification.summary}`,
        '',
        ...(verificationGateEntries.length > 0
          ? [
              'Repository-check gates this level remaps:',
              '',
              ...verificationGateEntries.map(
                ([criterionId, profile]) =>
                  `- \`${criterionId}\`: ` +
                  (profile === false
                    ? 'skipped'
                    : `runs profile \`${profile}\``),
              ),
              '',
            ]
          : ['Every gate runs its workflow-declared profile.', '']),
        ...(invocation.stage.slug === 'intake' ||
        invocation.stage.slug === 'plan'
          ? [
              'If this change warrants a different level, you MAY set ' +
                '`data.verification_recommendation` to `{ "level": <name>, ' +
                '"reason": <why> }`. The operator decides; do not assume the ' +
                'change.',
              '',
            ]
          : []),
      ]
    : []

  const operatorBrief = invocation.output.operator_brief
  const declaredArtifactLines = invocation.output.artifacts
    ? [
        'Declare these artifacts in this exact order:',
        ...invocation.output.artifacts.map(
          (artifact, index) =>
            `${index}. \`${artifact.path}\` — ${artifact.description}`,
        ),
        '',
      ]
    : []
  const requiredDataLines = requiredData.length
    ? [
        'Required `data` fields:',
        ...requiredData.map(
          ([key, typeName]) => `- \`data.${key}\`: ${typeName}`,
        ),
      ]
    : ['No stage-specific `data` fields are required.']
  const fieldContractLines = invocation.output.field_contract
    ? [
        '',
        'Shared field contract:',
        ...(invocation.output.field_contract.criterion_results
          ? [
              '- `criteria[].result` values:',
              ...Object.entries(
                invocation.output.field_contract.criterion_results,
              ).map(([value, meaning]) => `  - \`${value}\`: ${meaning}`),
            ]
          : []),
        ...invocation.output.field_contract.validators.map(
          (validator) =>
            `- \`${validator.registry_id}\` ${validator.enforcement} the stage.`,
        ),
        ...invocation.output.field_contract.fields.map((field) => {
          const details = [
            field.type,
            ...(field.enum ? [`values: ${field.enum.join(', ')}`] : []),
            ...(field.required
              ? [`required keys: ${field.required.join(', ')}`]
              : []),
            ...(field.format ? [`format: ${field.format}`] : []),
          ]

          return `- \`${field.path}\`: ${details.join(', ')}`
        }),
      ]
    : []

  const { delegation } = invocation
  // Legacy invocations inline the full procedure on the card. New invocations
  // point at the sibling supervisor document instead, so the worker-visible
  // contract never carries a workflow lifecycle command.
  const delegationLines = delegation
    ? delegation.supervisor_procedure_path
      ? [
          DELEGATION_HEADING,
          '',
          'This section addresses the supervisor that prepared this card, not ' +
            'the assigned worker. The worker MUST ignore it. The complete ' +
            'delivery procedure, its policies, and every resolved workflow ' +
            'lifecycle command live in ' +
            `\`${delegation.supervisor_procedure_path}\`; the supervisor MUST ` +
            'follow that document and MUST NOT deliver it to the worker. ' +
            'Worker-visible sections of this card carry no workflow ' +
            'lifecycle command.',
          '',
        ]
      : renderSupervisorProcedureBody(invocation)
    : []

  const lines = [
    `# 🚀 ${invocation.$operator.headline}`,
    '',
    `**Run** \`${invocation.run_id}\` · **Stage** ${stage.title} ` +
      `(\`${stage.slug}\`) · **Owner** \`${stage.persona}\` · ` +
      `**Model** \`${stage.model}\`` +
      (stage.persona_executor
        ? ` · **Executor** \`${stage.persona_executor}\``
        : '') +
      ` · **Attempt** ${invocation.attempt}`,
    '',
    `**Workspace** \`${invocation.workspace_root}\` — fingerprints, ` +
      'deterministic gate commands, and scope checks target this directory.',
    ...(invocation.managed_worktree
      ? [
          '',
          `**Managed worktree** \`${invocation.managed_worktree.name}\` · ` +
            `**Branch** \`${invocation.managed_worktree.branch}\` · ` +
            `**Path** \`${invocation.managed_worktree.path}\``,
        ]
      : []),
    ...(invocation.harness_root
      ? [
          '',
          `**Harness root** \`${invocation.harness_root}\` — every harness-relative ` +
            'path in this contract (`runtime/…`, `library/…`, `governance/…`, ' +
            '`docs/…`) and every `./bin/pan` command resolve against this ' +
            'directory, not the workspace. Write the stage output at ' +
            `\`${invocation.harness_root}/${invocation.output.path}\`. ` +
            'Target source paths resolve against the workspace.',
        ]
      : []),
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
    ...priorFailureLines,
    ...stageRepairLines,
    '## 📥 Inputs',
    '',
    '### Required inputs',
    '',
    ...(requiredReferences.length > 0
      ? requiredReferences
      : ['- No required artifact inputs.']),
    '',
    ...((invocation.evidence_workers ?? []).length > 0
      ? [
          '### Parallel evidence reports',
          '',
          'The supervisor persists these reports before delegating this ' +
            'card. Read each in full and cite it where your output ' +
            'consolidates its findings.',
          '',
          ...(invocation.evidence_workers ?? []).flatMap((worker) => {
            const attempts = evidenceWorkerAttempts(worker)

            // A relaunched worker wrote beside the first report rather than
            // over it, so the card names every attempt instead of sending
            // the reader to one path that holds only part of the evidence.
            return attempts.map(
              (attempt) =>
                `- \`${attempt.evidence_path}\` — ${worker.role} evidence ` +
                `report from the parallel \`${worker.persona}\` worker` +
                (attempts.length > 1 ? ` (attempt ${attempt.attempt})` : '') +
                '.',
            )
          }),
          '',
        ]
      : []),
    ...renderScopedReturn(invocation),
    ...renderEvidenceWorkerSkips(invocation),
    ...(contextReferenceLines.length > 0 ? [...contextReferenceLines, ''] : []),
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
        `**${criterion.id}** (${criterion.type}) — ${criterion.statement}` +
        renderResolvedGateBound(invocation, criterion),
    ),
    '',
    // Whoever owns a repository-check gate runs one, and whoever is handed
    // gate evidence judges one. Both meet the `cached` mark, so both get the
    // rule.
    ...(invocation.rubric.some((criterion) =>
      criterion.command?.includes('repository-check'),
    ) || invocation.inputs.references.some((item) => item.gate_evidence)
      ? [GATE_CACHE_ACCEPTANCE_RULE, '']
      : []),
    ...(gateOverrideLines.length > 0
      ? ['## 🧪 Gate overrides', '', ...gateOverrideLines, '']
      : []),
    ...involvementLines,
    ...verificationLines,
    ...(invocation.suite_profile || invocation.fast_wall
      ? renderSuiteProfileSection(
          invocation.suite_profile ?? null,
          invocation.fast_wall,
        )
      : []),
    '## 📤 Output contract',
    '',
    `Write JSON to \`${invocation.output.path}\` using ` +
      `\`${invocation.output.template}\` as the base shape ` +
      `(schema \`${invocation.output.schema}\`).`,
    '',
    ...(invocation.output.scaffold_command
      ? [
          'Prefill the output with the required scaffold automation, exactly ' +
            'as printed:',
          '',
          `\`${invocation.output.scaffold_command}\``,
          '',
          'The `--invocation` argument accepts only that invocation JSON ' +
            'snapshot. The Markdown contract beside it is not a valid ' +
            'argument and fails by artifact type.',
          '',
        ]
      : []),
    ...(invocation.attempt > 1
      ? [
          'This is a retry. Instead of re-emitting the whole document, you ' +
            'MAY submit a revision: write ' +
            '`{ "revises": "<prior invocation id' +
            (invocation.prior_failure
              ? `, here ${invocation.prior_failure.invocation_id}`
              : '') +
            '>", "patch": { ... } }` to the output path, where `patch` is an ' +
            'RFC 7386 JSON merge patch over the prior attempt output ' +
            '(objects merge recursively, arrays replace whole, `null` ' +
            'deletes). The patch MUST set `invocation_id` and ' +
            "`invocation_attestation` to this card's values. Patch only " +
            'what the failure or directive requires; the harness validates ' +
            'the merged document.',
          '',
        ]
      : []),
    ...(operatorBrief
      ? [
          `Operator brief artifact index: source ` +
            `\`${operatorBrief.source_path}\`; rendered HTML ` +
            `\`${operatorBrief.rendered_path}\`; schema ` +
            `\`${operatorBrief.schema}\`; profile ` +
            `\`${operatorBrief.profile}\`. The source file already exists. ` +
            `Edit it in place; do not search the repository for brief artifacts and ` +
            `do not run the renderer. The harness renders and validates it during submission. ` +
            `Required section-heading phrases: ${operatorBrief.required_headings.join(', ')}. ` +
            'The rendered HTML is artifact 0.' +
            (operatorBrief.source_lifecycle === 'transient' ||
            operatorBrief.source_transient
              ? ' The source JSON is transient and the harness deletes it after successful rendering and validation.'
              : ' This legacy invocation retains the source JSON.'),
          '',
          ...((operatorBrief.allowed_card_types ?? []).length > 0
            ? [
                'The renderer accepts only these values. The schema types both ' +
                  'fields as open strings, so an unlisted value produces a ' +
                  'schema-valid brief that fails to render, and you are not ' +
                  'permitted to run the renderer to find out. Reuse the closest ' +
                  'listed value rather than inventing one.',
                '',
                `- Card \`type\`: ${(operatorBrief.allowed_card_types ?? [])
                  .map((item) => `\`${item}\``)
                  .join(', ')}`,
                `- Section \`semantic\`: ${(
                  operatorBrief.allowed_section_semantics ?? []
                )
                  .map((item) => `\`${item}\``)
                  .join(', ')}`,
                '',
              ]
            : []),
        ]
      : [
          'This invocation does not request an operator brief. Do not create a brief source or rendered stage HTML.',
          'Use an empty artifacts array unless the stage produces another declared deliverable.',
          '',
        ]),
    ...declaredArtifactLines,
    ...requiredDataLines,
    ...fieldContractLines,
    '',
    'When tracked workspace files change during the stage, include top-level `workspace_changes` with `attribution`, every changed path in `paths`, and a concise `explanation`. Use `attribution: internal` only when the active worker can trace every listed change to its own actions; the cleanliness gate blocks only external or unattributed contamination.',
    '',
    ...attributedChangeLines(invocation),
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
      ...(invocation.managed_worktree
        ? { managed_worktree: invocation.managed_worktree }
        : {}),
      workspace_fingerprint: invocation.workspace_before.fingerprint,
      model: stage.model,
      model_config: stage.model_config,
      ...(stage.persona_executor
        ? { persona_executor: stage.persona_executor }
        : {}),
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    }),
    ...(delegationLines.length > 0 ? ['', ...delegationLines] : []),
  ]

  return `${lines.join('\n')}\n`
}
