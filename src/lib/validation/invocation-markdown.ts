/** Structural validation of rendered invocation and delegation Markdown. */

import { sha256 } from '../io.js'
import { filterPolicyInstructionsForCard } from '../policy-instructions.js'
import {
  guidanceInlineHeading,
  guidanceReferenceHeading,
  guidanceDigestToken,
  guidanceSelectedRange,
  renderGuidanceBlock,
  policySectionDigest,
  policyRulePointerSentence,
} from '../policy-guidance.js'
import type {
  PolicyGuidance,
  Invocation,
  InvocationDeliveryMode,
} from '../types.js'
import {
  AGENT_REQUIREMENTS_HEADING,
  DELEGATION_HEADING,
  HARNESS_REQUIREMENTS_HEADING,
  POLICIES_HEADING,
  PRIOR_FAILURE_HEADING,
  normalizeDelegationContent,
  normalizeMarkdownContent,
  type ValidationCheck,
} from './artifacts.js'

/**
 * Check how one policy guidance range reaches the rendered contract.
 *
 * A resolved reference is checked for its heading, its read trigger, a digest
 * that matches the snapshot content, and the absence of the guidance body. The
 * absence check is the load-bearing one: it is what keeps a renderer from
 * silently restoring the full body and undoing progressive disclosure. Guidance
 * without a reference belongs to an invocation prepared before progressive
 * disclosure existed, so it keeps the original inline-content contract and an
 * in-flight legacy run can still submit.
 */
function guidanceChecks(options: {
  id_prefix: string
  label: string
  guidance: PolicyGuidance
  markdown: string
}): ValidationCheck[] {
  const { id_prefix: idPrefix, label, guidance, markdown } = options
  const { reference } = guidance

  if (!reference) {
    const heading = guidanceInlineHeading(3, guidance.source_path)

    return [
      {
        id: `${idPrefix}.heading`,
        passed: markdown.includes(heading),
        message: markdown.includes(heading)
          ? `${label} heading is present`
          : `Markdown MUST identify inline guidance ${guidance.source_path}`,
      },
      {
        id: `${idPrefix}.content`,
        passed: markdown.includes(guidance.content),
        message: markdown.includes(guidance.content)
          ? `${label} content is present`
          : `Markdown MUST inline guidance from ${guidance.source_path}`,
      },
    ]
  }

  const heading = guidanceReferenceHeading(3, guidance.source_path)
  const digestToken = guidanceDigestToken(reference)
  const selectedRange = `Selected range: ${guidanceSelectedRange(reference)}.`

  const referenceBlockLines = renderGuidanceBlock(3, guidance)
  const referenceBlock = referenceBlockLines.join('\n')
  // An invocation rendered before the digest-basis line existed carries the
  // reference block without it. Accepting that block keeps an in-flight run
  // valid across the upgrade; a fresh render always carries the basis line.
  const legacyReferenceBlock = referenceBlockLines.slice(0, -1).join('\n')
  const referenceBlockPresent =
    markdown.includes(referenceBlock) || markdown.includes(legacyReferenceBlock)

  const digestMatchesContent =
    reference.content_sha256 === sha256(guidance.content)
  const lineCountMatchesContent =
    reference.line_count === guidance.content.split('\n').length
  const byteLengthMatchesContent =
    reference.byte_length === Buffer.byteLength(guidance.content, 'utf8')
  const bodyAbsent = !markdown.includes(guidance.content)

  return [
    {
      id: `${idPrefix}.heading`,
      passed: markdown.includes(heading),
      message: markdown.includes(heading)
        ? `${label} reference heading is present`
        : `Markdown MUST reference guidance ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.read_trigger`,
      passed: markdown.includes(reference.read_trigger),
      message: markdown.includes(reference.read_trigger)
        ? `${label} states when to read the source`
        : `Markdown MUST state the read trigger for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.selected_range`,
      passed: markdown.includes(selectedRange),
      message: markdown.includes(selectedRange)
        ? `${label} states the selected source range`
        : `Markdown MUST state the selected range for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.digest`,
      passed: markdown.includes(digestToken),
      message: markdown.includes(digestToken)
        ? `${label} carries the selected content digest`
        : `Markdown MUST carry '${digestToken}' for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.digest_matches_snapshot`,
      passed: digestMatchesContent,
      message: digestMatchesContent
        ? `${label} digest matches the snapshot content`
        : `${label} digest MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.line_count_matches_snapshot`,
      passed: lineCountMatchesContent,
      message: lineCountMatchesContent
        ? `${label} line count matches the snapshot content`
        : `${label} line count MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.byte_length_matches_snapshot`,
      passed: byteLengthMatchesContent,
      message: byteLengthMatchesContent
        ? `${label} byte length matches the snapshot content`
        : `${label} byte length MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.reference_block`,
      passed: referenceBlockPresent,
      message: referenceBlockPresent
        ? `${label} reference fields are contiguous and exact`
        : `Markdown MUST render the exact reference block for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.body_absent`,
      passed: bodyAbsent,
      message: bodyAbsent
        ? `${label} body stays in the invocation snapshot`
        : `Markdown MUST NOT inline the guidance body of ${guidance.source_path}`,
    },
  ]
}

/**
 * Workflow lifecycle commands are supervisor-owned. A worker-visible contract
 * that prints one invites the worker to run it, so invocation validation
 * rejects any of these in the card when the delegation names a separate
 * supervisor procedure document.
 */
const WORKER_LIFECYCLE_COMMAND_PATTERN =
  /pan\s+(submit|decide|set-stage|waive-gate|delegate|abort)\b/u

export function validateInvocationMarkdown(
  invocation: Invocation,
  markdown: string,
  supervisorProcedureMarkdown?: string,
): { passed: boolean; checks: ValidationCheck[] } {
  const checks: ValidationCheck[] = []
  const normalized = normalizeMarkdownContent(markdown)

  checks.push({
    id: 'policies.non_empty',
    passed: invocation.policies.length > 0,
    message:
      invocation.policies.length > 0
        ? `${invocation.policies.length} policies in invocation snapshot`
        : 'invocation.policies MUST NOT be empty',
  })

  checks.push({
    id: 'policies.heading',
    passed: normalized.includes(POLICIES_HEADING),
    message: normalized.includes(POLICIES_HEADING)
      ? 'Policy section heading is present'
      : `Markdown MUST contain '${POLICIES_HEADING}'`,
  })

  for (const policy of invocation.policies) {
    const header = `**${policy.id} · ${policy.title}**`

    checks.push({
      id: `policy.${policy.id}.header`,
      passed: normalized.includes(header),
      message: normalized.includes(header)
        ? `Policy ${policy.id} header is present`
        : `Markdown MUST include policy id and title for ${policy.id}`,
    })

    const delivery = invocation.policy_delivery?.[policy.id]
    const pointer = delivery?.mode === 'pointer' ? delivery : null

    // A pointer block leaves the summary to the rule it points at.
    if (!pointer) {
      checks.push({
        id: `policy.${policy.id}.summary`,
        passed: normalized.includes(policy.summary),
        message: normalized.includes(policy.summary)
          ? `Policy ${policy.id} summary is present`
          : `Markdown MUST include policy ${policy.id} summary text`,
      })
    }

    if (pointer) {
      // A pointer stands for the policy's inline section. It holds only while
      // its digest still names that section, so a policy edited after the
      // card was prepared fails the card rather than point at other text.
      const expected = policySectionDigest(policy, 'agent')
      const sentence = policyRulePointerSentence(pointer)

      checks.push({
        id: `policy.${policy.id}.pointer_digest`,
        passed: pointer.sha256 === expected && normalized.includes(sentence),
        message:
          pointer.sha256 !== expected
            ? `Policy ${policy.id} pointer digest sha256:${pointer.sha256} ` +
              `does not match its section digest sha256:${expected}`
            : normalized.includes(sentence)
              ? `Policy ${policy.id} pointer to ${pointer.target} is present`
              : `Markdown MUST include the ${policy.id} pointer to ${pointer.target}`,
      })
    }

    const renderedInstructions = filterPolicyInstructionsForCard(
      policy.instructions,
      'agent',
    ).filter((instruction) => !pointer || instruction.excerpt === true)

    for (const [index, instruction] of renderedInstructions.entries()) {
      const text = instruction.text
      checks.push({
        id: `policy.${policy.id}.instruction.${index + 1}`,
        passed: normalized.includes(text),
        message: normalized.includes(text)
          ? `Policy ${policy.id} instruction ${index + 1} is present`
          : `Markdown MUST include policy ${policy.id} instruction ${index + 1}`,
      })
    }

    for (const [index, guidance] of (policy.guidance ?? []).entries()) {
      checks.push(
        ...guidanceChecks({
          id_prefix: `policy.${policy.id}.guidance.${index + 1}`,
          label: `Policy ${policy.id} guidance ${index + 1}`,
          guidance,
          markdown: normalized,
        }),
      )
    }
  }

  // A retry card that does not state the recorded failure reason lets a worker
  // resubmit the same defect, so the reason being rendered is itself a contract.
  if (invocation.prior_failure) {
    const failure = invocation.prior_failure

    checks.push({
      id: 'prior_failure.heading',
      passed: normalized.includes(PRIOR_FAILURE_HEADING),
      message: normalized.includes(PRIOR_FAILURE_HEADING)
        ? 'Prior-attempt failure reason is present'
        : `Markdown MUST contain '${PRIOR_FAILURE_HEADING}'`,
    })

    const renderedReasons = [
      ...failure.failed_hard_criteria.map((item) => item.id),
      ...failure.failed_deterministic.map((item) => item.id),
      ...failure.validation_errors,
      ...failure.governance_artifact_warnings,
    ]

    for (const [index, reason] of renderedReasons.entries()) {
      checks.push({
        id: `prior_failure.reason.${index + 1}`,
        passed: normalized.includes(reason),
        message: normalized.includes(reason)
          ? `Prior failure reason ${index + 1} is inlined`
          : `Markdown MUST inline prior failure reason '${reason}'`,
      })
    }
  }

  if (invocation.delegation) {
    const { delegation } = invocation
    // A delegation that names a supervisor procedure document keeps every
    // lifecycle command there; the card holds only a pointer section. Legacy
    // delegations inline the whole procedure on the card, so their checks run
    // against the card body.
    const split = typeof delegation.supervisor_procedure_path === 'string'
    const procedure = split
      ? normalizeMarkdownContent(supervisorProcedureMarkdown ?? '')
      : normalized
    const procedureLabel = split
      ? 'the supervisor procedure document'
      : 'the card'

    checks.push({
      id: 'delegation.heading',
      passed: normalized.includes(DELEGATION_HEADING),
      message: normalized.includes(DELEGATION_HEADING)
        ? 'Supervisor delivery procedure is present'
        : `Markdown MUST contain '${DELEGATION_HEADING}'`,
    })

    if (split) {
      const procedurePath = delegation.supervisor_procedure_path ?? ''

      checks.push({
        id: 'delegation.procedure_path',
        passed: normalized.includes(procedurePath),
        message: normalized.includes(procedurePath)
          ? 'Supervisor procedure path is resolved in the card'
          : `Markdown MUST name the supervisor procedure document: ${procedurePath}`,
      })
      checks.push({
        id: 'delegation.procedure_document',
        passed: procedure.includes(DELEGATION_HEADING),
        message: procedure.includes(DELEGATION_HEADING)
          ? 'Supervisor procedure document is present'
          : `The supervisor procedure document at ${procedurePath} MUST contain '${DELEGATION_HEADING}'`,
      })

      const lifecycleMatch = WORKER_LIFECYCLE_COMMAND_PATTERN.exec(normalized)

      checks.push({
        id: 'delegation.worker_isolation',
        passed: lifecycleMatch === null,
        message:
          lifecycleMatch === null
            ? 'Worker-visible contract carries no workflow lifecycle command'
            : `Worker-visible contract MUST NOT contain the lifecycle command 'pan ${lifecycleMatch[1]}'`,
      })
    }

    checks.push({
      id: 'delegation.policies_present',
      passed: delegation.policies.length > 0,
      message:
        delegation.policies.length > 0
          ? `${delegation.policies.length} supervisor delivery policies are declared`
          : 'Delegated stages MUST declare at least one delivery policy',
    })

    const supervisorSections =
      delegation.supervisor_card?.policy_sections ?? null
    const sectionDigestFor = (policyId: string): string | null =>
      supervisorSections?.find((section) => section.policy_id === policyId)
        ?.sha256 ?? null

    if (split && supervisorSections && supervisorSections.length > 0) {
      for (const policy of delegation.policies) {
        const digest = sectionDigestFor(policy.id)

        checks.push({
          id: `delegation.${policy.id}.section_digest_present`,
          passed:
            digest !== null &&
            procedure.includes(`\`${policy.id}\`: \`sha256:${digest}\``),
          message:
            digest !== null &&
            procedure.includes(`\`${policy.id}\`: \`sha256:${digest}\``)
              ? `Delivery policy ${policy.id} section digest pointer is present`
              : `${procedureLabel} MUST include a section digest pointer for ${policy.id}`,
        })
      }
    } else {
      for (const policy of delegation.policies) {
        const rendered = filterPolicyInstructionsForCard(
          policy.instructions,
          'supervisor',
        )

        for (const [index, instruction] of rendered.entries()) {
          const text = instruction.text
          checks.push({
            id: `delegation.${policy.id}.instruction.${index + 1}`,
            passed: procedure.includes(text),
            message: procedure.includes(text)
              ? `Delivery policy ${policy.id} instruction ${index + 1} is present`
              : `${procedureLabel} MUST inline ${policy.id} instruction ${index + 1} for the supervisor`,
          })
        }
      }
    }

    for (const [id, value] of [
      ['canonical_path', delegation.canonical_markdown_path],
      ['validation_path', delegation.invocation_validation_path],
      ['artifact_path', delegation.delegation_artifact_path],
      ...(delegation.cursor_agent_path
        ? ([['agent_path', delegation.cursor_agent_path]] as const)
        : []),
      ...(delegation.delegate_command
        ? ([['delegate_command', delegation.delegate_command]] as const)
        : []),
      ['submit_command', delegation.submit_command],
      ...(delegation.delivery_prompt_path
        ? ([['delivery_prompt_path', delegation.delivery_prompt_path]] as const)
        : []),
    ] as const) {
      checks.push({
        id: `delegation.${id}`,
        passed: procedure.includes(value),
        message: procedure.includes(value)
          ? `Delivery ${id} is resolved in ${procedureLabel}`
          : `${procedureLabel} MUST resolve the delivery ${id}: ${value}`,
      })
    }
  }

  if (invocation.requirements) {
    const requirements = [
      ...invocation.requirements.automation_requirements,
      ...invocation.requirements.validation_requirements,
    ]
    const agentRequirements = requirements.filter(
      (requirement) => requirement.executor !== 'harness',
    )
    const harnessRequirements = requirements.filter(
      (requirement) => requirement.executor === 'harness',
    )

    if (agentRequirements.length > 0) {
      checks.push({
        id: 'requirements.agent_heading',
        passed: normalized.includes(AGENT_REQUIREMENTS_HEADING),
        message: normalized.includes(AGENT_REQUIREMENTS_HEADING)
          ? 'Agent requirements section heading is present'
          : `Markdown MUST contain '${AGENT_REQUIREMENTS_HEADING}'`,
      })
    }

    if (harnessRequirements.length > 0) {
      checks.push({
        id: 'requirements.harness_heading',
        passed: normalized.includes(HARNESS_REQUIREMENTS_HEADING),
        message: normalized.includes(HARNESS_REQUIREMENTS_HEADING)
          ? 'Harness requirements section heading is present'
          : `Markdown MUST contain '${HARNESS_REQUIREMENTS_HEADING}'`,
      })
    }

    for (const requirement of agentRequirements) {
      const row = `| ${requirement.policy_id} | ${requirement.requirement_id} |`

      checks.push({
        id: `requirement.${requirement.policy_id}.${requirement.requirement_id}`,
        passed: normalized.includes(row),
        message: normalized.includes(row)
          ? `Requirement ${requirement.requirement_id} is rendered`
          : `Markdown MUST include requirement row for ${requirement.requirement_id}`,
      })
    }

    for (const requirement of harnessRequirements) {
      const line =
        `\`${requirement.registry_id}@${requirement.registry_version}\` — ` +
        `${requirement.requirement_id} (${requirement.phase}, ${requirement.enforcement})`

      checks.push({
        id: `requirement.${requirement.policy_id}.${requirement.requirement_id}`,
        passed: normalized.includes(line),
        message: normalized.includes(line)
          ? `Harness requirement ${requirement.requirement_id} is rendered`
          : `Markdown MUST include harness requirement ${requirement.requirement_id}`,
      })
    }
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  }
}

/** Longest leading persona label the delegation contract tolerates. */
const DELEGATION_LABEL_MAX_LENGTH = 80

/**
 * Identity line the supervisor procedure generates ahead of the delivered
 * body, e.g. `Agent: pan-coder` or `Persona: \`coder\`.`. Only these keys
 * qualify for the two-line prefix, so free prose can never stack into a
 * parallel instruction.
 */
const DELEGATION_IDENTITY_LINE = /^(?:Agent|Persona):\s\S/u

function qualifiesAsDelegationLabel(line: string): boolean {
  return (
    line.trim().length > 0 &&
    line.length <= DELEGATION_LABEL_MAX_LENGTH &&
    !/^\s*(?:[#>*\-+]|\d+[.)]|```|\|)/u.test(line)
  )
}

/**
 * Enumerate every reading of the minimal non-conflicting persona label
 * `INVOCATION-001` and the supervisor commands explicitly permit ahead of the
 * pasted card.
 *
 * A label qualifies when it is a single short line that starts no Markdown
 * structure and is followed by a blank line, so it cannot smuggle in a
 * heading, list item, or parallel instruction that would shadow the card. Two
 * leading lines qualify only when both are `Agent:`/`Persona:` identity lines
 * — the exact prefix the supervisor procedure generates — again followed by a
 * blank line. Both readings are returned because the delivered body itself
 * begins with a harness-generated `Persona:` line, so only comparison against
 * the expected body can tell which lines are label and which are body.
 */
function permittedDelegationLabelReadings(
  delegation: string,
): Array<{ body: string; label: string | null }> {
  const readings: Array<{ body: string; label: string | null }> = [
    { body: delegation, label: null },
  ]
  const lines = delegation.split('\n')
  const [first = '', second = '', third = ''] = lines

  if (
    qualifiesAsDelegationLabel(first) &&
    second.trim().length === 0 &&
    lines.length > 2
  ) {
    readings.push({ body: lines.slice(2).join('\n'), label: first.trim() })
  }

  if (
    qualifiesAsDelegationLabel(first) &&
    qualifiesAsDelegationLabel(second) &&
    DELEGATION_IDENTITY_LINE.test(first) &&
    DELEGATION_IDENTITY_LINE.test(second) &&
    third.trim().length === 0 &&
    lines.length > 3
  ) {
    readings.push({
      body: lines.slice(3).join('\n'),
      label: `${first.trim()} / ${second.trim()}`,
    })
  }

  return readings
}

/**
 * Compare delegation evidence with the body the supervisor was required to
 * deliver.
 *
 * Under `verbatim` mode that body is the canonical card. Under `referenced` mode
 * it is the compact delivery prompt, which names the card as the worker
 * contract. Either way the comparison is exact after line-ending normalization,
 * so the supervisor cannot narrow, summarize, or shadow what it delivered.
 */
export function validateDelegationMarkdown(
  expectedMarkdown: string,
  delegationMarkdown: string,
  mode: InvocationDeliveryMode = 'verbatim',
): { passed: boolean; checks: ValidationCheck[] } {
  const expectedNormalized = normalizeDelegationContent(expectedMarkdown)
  const delegationNormalized = normalizeDelegationContent(delegationMarkdown)

  const exact = expectedNormalized === delegationNormalized
  const matched = exact
    ? { body: delegationNormalized, label: null }
    : permittedDelegationLabelReadings(delegationNormalized).find(
        (reading) => reading.body === expectedNormalized,
      )
  const label = matched?.label ?? null
  const passed = exact || matched !== undefined

  const subject =
    mode === 'referenced'
      ? 'the compact delivery prompt'
      : 'the canonical invocation card'

  const checks: ValidationCheck[] = [
    {
      id: 'delegation.canonical_equality',
      passed,
      message: passed
        ? label
          ? `Delegation artifact matches ${subject} after the permitted persona label '${label}'`
          : `Delegation artifact matches ${subject}`
        : `Delegation artifact MUST equal ${subject} after line-ending and trailing-whitespace normalization, except for one permitted leading persona label (or the 'Agent:'/'Persona:' identity-line pair) followed by a blank line`,
    },
    {
      id: 'delegation.mode',
      passed: true,
      message: `Delivery mode is '${mode}'`,
    },
  ]

  if (label) {
    checks.push({
      id: 'delegation.label_minimal',
      passed: true,
      message: `Leading persona label '${label}' precedes the delivered body`,
    })
  }

  return { passed, checks }
}
