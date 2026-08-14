import { sha256 } from './io.js'
import { renderGuidanceBlock } from './policy-guidance.js'
import type {
  Invocation,
  InvocationContractGuidance,
  InvocationContractManifest,
  InvocationContractSectionOwner,
  Policy,
  RunState,
} from './types.js'
import { DELEGATION_HEADING, normalizeMarkdownContent } from './validation.js'
import type { InvocationValidationStatus } from './validation.js'

function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Longest section-id slug retained from a heading, so ids stay readable. */
const SECTION_SLUG_MAX_LENGTH = 48

const TOP_LEVEL_HEADING_PATTERN = /^## /u

/**
 * One top-level block of a canonical worker contract. Concatenating every
 * block's `markdown` reproduces the contract byte for byte, which is what lets a
 * section digest and the whole-file digest be checked against the same file.
 */
export interface InvocationContractBlock {
  id: string
  heading: string
  owner: InvocationContractSectionOwner
  markdown: string
  line_count: number
}

/** Normalize to LF with exactly one final newline. */
function normalizeContract(markdown: string): string {
  const normalized = normalizeMarkdownContent(markdown)

  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function sectionSlug(heading: string): string {
  const slug = heading
    .replace(/^#+\s*/u, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, SECTION_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/gu, '')

  return slug.length > 0 ? slug : 'section'
}

function sectionId(index: number, heading: string): string {
  return `${String(index + 1).padStart(3, '0')}-${sectionSlug(heading)}`
}

/**
 * Split a rendered contract into ordered top-level blocks.
 *
 * Content before the first `## ` heading forms a preamble block. The supervisor
 * delivery procedure is appended last, so every block from that heading onward
 * is supervisor-owned and the rest binds the worker.
 */
export function splitInvocationContract(
  markdown: string,
): InvocationContractBlock[] {
  const lines = normalizeContract(markdown).slice(0, -1).split('\n')
  const groups: Array<{ heading: string; lines: string[] }> = []

  for (const line of lines) {
    if (groups.length === 0 || TOP_LEVEL_HEADING_PATTERN.test(line)) {
      groups.push({
        heading: TOP_LEVEL_HEADING_PATTERN.test(line)
          ? line.trim()
          : 'Preamble',
        lines: [],
      })
    }

    groups[groups.length - 1]?.lines.push(line)
  }

  const supervisorIndex = groups.findIndex(
    (group) => group.heading === DELEGATION_HEADING,
  )

  return groups.map((group, index) => ({
    id: sectionId(index, group.heading),
    heading: group.heading,
    owner:
      supervisorIndex !== -1 && index >= supervisorIndex
        ? ('supervisor' as const)
        : ('worker' as const),
    markdown: `${group.lines.join('\n')}\n`,
    line_count: group.lines.length,
  }))
}

/**
 * Name every referenced guidance selection the contract points at, in policy
 * order. Legacy inline guidance carries its body on the card, so a read needs
 * no attestation and it is not listed.
 */
function manifestGuidance(policies: Policy[]): InvocationContractGuidance[] {
  return policies.flatMap((policy) =>
    (policy.guidance ?? []).flatMap((guidance) =>
      guidance.reference
        ? [
            {
              policy_id: policy.id,
              source_path: guidance.source_path,
              content_sha256: guidance.reference.content_sha256,
              read_trigger: guidance.reference.read_trigger,
            },
          ]
        : [],
    ),
  )
}

/** Describe a rendered contract as a flat, digest-bearing section index. */
export function buildInvocationContractManifest(
  contractPath: string,
  markdown: string,
  policies: Policy[] = [],
): InvocationContractManifest {
  const contract = normalizeContract(markdown)
  const blocks = splitInvocationContract(contract)
  const guidance = manifestGuidance(policies)

  return {
    contract_path: contractPath,
    contract_sha256: sha256(contract),
    byte_length: Buffer.byteLength(contract, 'utf8'),
    line_count: contract.slice(0, -1).split('\n').length,
    sections: blocks.map((block) => ({
      id: block.id,
      heading: block.heading,
      owner: block.owner,
      line_count: block.line_count,
      sha256: sha256(block.markdown),
    })),
    ...(guidance.length > 0 ? { guidance } : {}),
  }
}

/**
 * Render the exact prompt body a supervisor delivers under referenced mode.
 *
 * The prompt stays bounded no matter how large the contract grows: it carries
 * one contract reference, one digest, and one flat section index. It deliberately
 * holds no nested appendix, because a second level of indirection lowers the
 * accuracy of the read it is meant to guarantee.
 */
export function renderInvocationDeliveryPrompt(
  invocation: Invocation,
  manifest: InvocationContractManifest,
): string {
  const { delegation } = invocation
  const workerSections = manifest.sections.filter(
    (section) => section.owner === 'worker',
  )
  const lines = [
    `Persona: \`${delegation?.persona ?? invocation.stage.persona}\`.`,
    '',
    `Your complete contract for stage \`${invocation.stage.slug}\` is one file. ` +
      'Read that file before any other work.',
    '',
    `- Contract: \`${manifest.contract_path}\``,
    `- Digest: \`sha256:${manifest.contract_sha256}\``,
    `- Size: ${manifest.line_count} lines, ${manifest.byte_length} bytes`,
    `- Sections: ${manifest.sections.length} (${workerSections.length} bind you)`,
    '',
    '## How to read the contract',
    '',
    `1. Read \`${manifest.contract_path}\` in full, from line 1 to line ${manifest.line_count}.`,
    '2. Compare the digest of that file with the digest above.',
    '3. Read no other repository context before the contract.',
    '4. When the file is unreadable, or the digest differs, stop and report a reference failure.',
    '',
    '## Contract sections',
    '',
    'The list below is complete and flat. A `worker` section binds you. A ' +
      '`supervisor` section addresses the supervisor, and you must ignore it.',
    '',
    '| Section id | Heading | Owner | Lines | Digest |',
    '| --- | --- | --- | --- | --- |',
    ...manifest.sections.map(
      (section) =>
        `| \`${section.id}\` | ${section.heading} | ${section.owner} | ` +
        `${section.line_count} | \`${section.sha256}\` |`,
    ),
    '',
    'Use the list to confirm that your read covered every section that binds you.',
    '',
    '## Read attestation',
    '',
    `Declare the read in \`invocation_attestation\` in \`${invocation.output.path}\`:`,
    '',
    `- Set \`invocation_id\` to \`${invocation.invocation_id}\`.`,
    `- Set \`contract_path\` to \`${manifest.contract_path}\`.`,
    `- Set \`contract_sha256\` to \`${manifest.contract_sha256}\`.`,
    '- Set `status` to `read` after you read the complete contract.',
    '- Set `sections` to every section id and digest above, in the same order.',
    '',
    'The required stage-output scaffold automation prefills these fields with ' +
      'status `pending`. Confirm each value against the list above, correct any ' +
      'difference, and change `pending` to `read` yourself. Submission rejects ' +
      '`pending`, because only you can declare the read.',
    '',
    'When you cannot read the contract, set `status` to `reference_failed`, put ' +
      'the concrete read error in `error`, and set the stage `result` to ' +
      '`blocked`. Do not report a product verdict you have no contract for.',
    '',
    ...(manifest.guidance?.length
      ? [
          '## Guidance attestation',
          '',
          'The contract references policy guidance instead of inlining it. The ' +
            'scaffold prefills one `invocation_attestation.guidance` entry per ' +
            'reference with status `pending`. Submission rejects `pending`; set ' +
            'each entry yourself:',
          '',
          '- `read` after you read the selection from the source file. Digests ' +
            `cover the selection with surrounding whitespace trimmed. When the ` +
            'file no longer matches its digest, read the exact selected bytes ' +
            `from the invocation JSON snapshot and still declare \`read\`.`,
          '- `skipped` with the concrete `reason` when the read trigger does ' +
            'not apply to your task.',
          '- `reference_failed` with the concrete `error` when neither the ' +
            'source file nor the invocation snapshot is readable.',
          '',
          '| Policy | Guidance source | Digest |',
          '| --- | --- | --- |',
          ...manifest.guidance.map(
            (entry) =>
              `| \`${entry.policy_id}\` | \`${entry.source_path}\` | ` +
              `\`sha256:${entry.content_sha256}\` |`,
          ),
          '',
        ]
      : []),
  ]

  return `${lines.join('\n')}\n`
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
          lines.push(...renderGuidanceBlock(3, guidance))
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
  const priorFailure = invocation.prior_failure
  const priorFailureLines = priorFailure
    ? [
        '## ⛔ Why the previous attempt failed',
        '',
        `Attempt ${priorFailure.attempt} of \`${priorFailure.stage}\` ended in ` +
          `\`${priorFailure.outcome}\`. This is the complete recorded reason. ` +
          'Address every item below; resubmitting unchanged work will fail the ' +
          'same way.',
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
        ...(priorFailure.failed_hard_criteria.length === 0 &&
        priorFailure.failed_deterministic.length === 0 &&
        priorFailure.validation_errors.length === 0 &&
        priorFailure.governance_artifact_warnings.length === 0
          ? [
              'No specific failing criterion, check, or validation error was ' +
                `recorded. Read \`${priorFailure.output_path}\` and treat the ` +
                'absent reason itself as a defect to report.',
              '',
            ]
          : []),
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
  // Only the non-default method needs a card section. A default review is what
  // the stage prompt and REVIEW-001 already describe.
  const reviewModeLines =
    invocation.review_mode === 'squad'
      ? [
          '## 🔭 Review method',
          '',
          'This run resolved review mode `squad`. Review gathers its findings ' +
            'through one agent per review dimension, then joins them into one ' +
            'ranked set. `REVIEW-002` and the guidance it references govern the ' +
            'lineup, the charters, and the finding shape.',
          '',
        ]
      : []
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

  const { delegation } = invocation
  const externalDelegation =
    delegation?.executor && delegation.executor !== 'cursor'
      ? delegation.executor
      : null
  const referencedDelivery =
    delegation?.mode === 'referenced' && delegation.delivery_prompt_path
      ? delegation.delivery_prompt_path
      : null
  const deliverySteps = externalDelegation
    ? [
        `2. Run \`${delegation?.delegate_command}\`. The harness spawns the ` +
          `'${externalDelegation}' executor with the complete canonical card ` +
          `(\`${delegation?.canonical_markdown_path}\`) and awaits its ` +
          'result. You MUST NOT re-summarize, re-deliver, or paste the card ' +
          'anywhere yourself.',
        `3. The harness authors the delegation evidence at ` +
          `\`${delegation?.delegation_artifact_path}\` and the execution ` +
          'audit beside it. You MUST NOT write either artifact.',
      ]
    : referencedDelivery
      ? [
          `2. Paste the complete contents of \`${referencedDelivery}\` verbatim into ` +
            `the \`${delegation?.persona}\` subagent prompt ` +
            `(\`${delegation?.cursor_agent_path}\`). That prompt references this ` +
            'card as the worker contract. A summary, an excerpt, or an added ' +
            'restatement MUST NOT substitute for it.',
          `3. Persist that exact prompt body to \`${delegation?.delegation_artifact_path}\` ` +
            'before submission.',
        ]
      : [
          `2. Paste the complete contents of \`${delegation?.canonical_markdown_path}\` ` +
            `verbatim into the \`${delegation?.persona}\` subagent prompt ` +
            `(\`${delegation?.cursor_agent_path}\`). A path reference, summary, or ` +
            'excerpt MUST NOT substitute for the card body.',
          `3. Persist that exact prompt body to \`${delegation?.delegation_artifact_path}\` ` +
            'before submission.',
        ]
  const delegationLines = delegation
    ? [
        DELEGATION_HEADING,
        '',
        'This section addresses the supervisor that prepared this card, not the ' +
          'assigned worker. The worker MUST ignore it. The supervisor MUST NOT ' +
          'remove it: delegation evidence is compared against the delivered ' +
          'prompt byte for byte.',
        '',
        ...delegation.policies.flatMap((policy) => [
          `**${policy.id} · ${policy.title}**`,
          '',
          policy.summary,
          '',
          ...policy.instructions.map((instruction) => `- ${instruction}`),
          '',
        ]),
        ...(externalDelegation
          ? [
              `This stage executes under the '${externalDelegation}' ` +
                'executor. The harness — not the supervisor — delivers the ' +
                'canonical card to the spawned process and authors the ' +
                'delegation evidence itself, so verbatim delivery is a ' +
                'property of code.',
              '',
            ]
          : []),
        ...(referencedDelivery
          ? [
              'This invocation uses referenced delivery. The worker contract is ' +
                `this card at \`${delegation.canonical_markdown_path}\`, and the ` +
                'delivered prompt is a compact reference to it that carries the ' +
                'contract digest and section index. The supervisor MUST NOT ' +
                'reproduce the card body.',
              '',
            ]
          : []),
        'Resolved paths for this invocation:',
        '',
        `1. Confirm \`${delegation.invocation_validation_path}\` reports \`pass\`. ` +
          'A failed or missing validation artifact MUST NOT be delegated.',
        ...deliverySteps,
        `4. Submit with \`${delegation.submit_command}\`.`,
        '',
      ]
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
    ...involvementLines,
    ...reviewModeLines,
    '## 📤 Output contract',
    '',
    `Write JSON to \`${invocation.output.path}\` using ` +
      `\`${invocation.output.template}\` as the base shape ` +
      `(schema \`${invocation.output.schema}\`).`,
    '',
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

  if (state.operator_involvement) {
    const { profile, contracts } = state.operator_involvement

    lines.push(
      `Involvement profile: ${profile}` +
        (contracts.length > 0 ? ` (contracts: ${contracts.join(', ')})` : ''),
    )
  }

  if (state.review_mode) {
    lines.push(`Review mode: ${state.review_mode}`)
  }

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
