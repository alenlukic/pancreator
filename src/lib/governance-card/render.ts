/**
 * Governance card Markdown: the base-revision conduct block of a review card,
 * the review dimension selection, and the card body.
 */

import { renderPolicyBlocks } from '../policy-guidance.js'
import type { PolicyCardAudience } from '../policy-instructions.js'
import type { InvocationKind } from '../requirements/types.js'
import { gitShowFile } from '../git.js'
import type { ReviewDimensionSelection } from '../review-dimensions.js'
import { type ReviewScope, conflictsByTier } from '../review-scope.js'
import type { WorktreeRecord } from '../worktrees.js'
import type { Policy, RequirementManifest } from '../types.js'
import type { StandaloneMode } from './modes.js'

interface BaseConductPolicy {
  id: string
  path: string
  summary: string | null
  instructions: string[]
}

interface BaseConductBlock {
  base: string
  head: string
  policies: BaseConductPolicy[]
  /** Conduct-tier paths whose base text the card cannot inline. */
  other_conduct: string[]
  /** Instrument-tier paths the squad must not grade. */
  excluded: string[]
  /** Substrate paths that taint verification. */
  tainted: string[]
}

/**
 * Build the base-revision conduct block for a review card whose target changes
 * governance: the base text of each changed policy's agent-audience
 * instructions, other conduct-tier paths that cannot be inlined,
 * instrument-tier paths the squad must not grade, and substrate paths that
 * taint verification. Reads policy files at `scope.base` through Git; a policy
 * the change adds has no base text and is omitted.
 */
export function baseConductBlock(
  targetRoot: string,
  scope: ReviewScope,
): BaseConductBlock {
  const tiers = conflictsByTier(scope.conflicts)
  const policies: BaseConductPolicy[] = []
  const otherConduct: string[] = []

  for (const conflict of tiers.conduct) {
    const match = /^governance\/policies\/([^/]+)\.json$/u.exec(conflict.path)

    if (!match) {
      // A guidance or registry path carries no inlinable policy text.
      otherConduct.push(conflict.path)
      continue
    }

    const text = gitShowFile(targetRoot, scope.base, conflict.path)

    if (text === null) {
      // The change added this policy, so no base rule binds the session.
      continue
    }

    let value: unknown = null

    try {
      value = JSON.parse(text)
    } catch {
      value = null
    }

    const record = isRecordValue(value) ? value : {}

    policies.push({
      id: match[1],
      path: conflict.path,
      summary: typeof record.summary === 'string' ? record.summary : null,
      instructions: Array.isArray(record.instructions)
        ? record.instructions.flatMap((item): string[] => {
            if (typeof item === 'string') {
              return [item]
            }

            if (!isRecordValue(item)) {
              return []
            }

            const audiences = item.audience

            if (!Array.isArray(audiences)) {
              return []
            }

            const audienceSet = new Set(
              audiences.filter(
                (audience): audience is string => typeof audience === 'string',
              ),
            )

            if (audienceSet.has('harness') || audienceSet.has('operator')) {
              return []
            }

            if (!audienceSet.has('agent')) {
              return []
            }

            if (
              typeof item.text !== 'string' ||
              item.text.trim().length === 0
            ) {
              return []
            }

            return [item.text]
          })
        : [],
    })
  }

  return {
    base: scope.base,
    head: scope.head,
    policies,
    other_conduct: otherConduct,
    excluded: tiers.instrument.map((item) => item.path),
    tainted: tiers.substrate.map((item) => item.path),
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function renderBaseConduct(block: BaseConductBlock): string[] {
  const lines = [
    '## 🧭 Conduct under the base revision',
    '',
    `The review target changes rules this card carries. Base \`${block.base.slice(0, 12)}\`, ` +
      `head \`${block.head.slice(0, 12)}\`. Your conduct follows the base text of ` +
      'each policy below; the head text is part of what you are reviewing. A ' +
      'difference between the two is a standards delta for the operator, never ' +
      'a finding on its own.',
    '',
  ]

  if (block.policies.length === 0 && block.other_conduct.length === 0) {
    lines.push('No conduct conflict exists between base and head.', '')
  } else if (block.policies.length === 0) {
    lines.push(
      'Every conduct conflict on this card is listed below; none of them is ' +
        'a policy file whose text can be inlined.',
      '',
    )
  }

  for (const policy of block.policies) {
    lines.push(`**${policy.id} · base text**`, '')

    if (policy.summary) {
      lines.push(policy.summary, '')
    }

    lines.push(...policy.instructions.map((item) => `- ${item}`), '')
  }

  if (block.policies.length > 0) {
    lines.push(
      '_Guidance digests are not rendered for a base text; open the base ' +
        'file if the guidance itself is under review._',
      '',
    )
  }

  for (const conductPath of block.other_conduct) {
    lines.push(
      `**\`${conductPath}\` · base text not inlined**`,
      '',
      `Read it with \`git show ${block.base.slice(0, 12)}:${conductPath}\` ` +
        'before you apply this guidance; the head text is under review.',
      '',
    )
  }

  if (block.excluded.length > 0) {
    lines.push(
      '**Excluded from the squad verdict (instrument tier)**',
      '',
      ...block.excluded.map((path) => `- \`${path}\``),
      '',
    )
  }

  if (block.tainted.length > 0) {
    lines.push(
      '**Verification substrate in the change (tainted)**',
      '',
      'A finding elsewhere that relies on these to verify itself MUST say so.',
      '',
      ...block.tainted.map((path) => `- \`${path}\``),
      '',
    )
  }

  return lines
}

/**
 * The card is the durable session record of a standalone review or a shepherd
 * session, so the dimension selection lands here. A later reader then sees
 * that a partial review was partial, and which lenses it never applied.
 */
function renderReviewDimensions(
  selection: ReviewDimensionSelection,
  kind: InvocationKind,
): string[] {
  const lines = ['## 🎯 Review dimensions', '']
  const slugList = (slugs: string[]): string =>
    slugs.length > 0 ? slugs.map((slug) => `\`${slug}\``).join(', ') : 'none'
  const shepherd = kind === 'shepherd'

  if (selection.default) {
    lines.push(
      shepherd
        ? 'The operator selected no dimension set. For each batch the ' +
            'shepherd selects, from the lineup below, only the dimensions ' +
            'under which a defect in that change could carry a material ' +
            'consequence given the PR scope. It records each dimension it ' +
            'left out with the reason.'
        : 'The operator selected no dimension set. The squad runs the full ' +
            'default lineup the squad procedure resolves, including its ' +
            'activation rules.',
      '',
      `- Default lineup: ${slugList(selection.selected)}`,
      `- Conditional, resolved by the coordinator: ${slugList(selection.conditional)}`,
      '',
    )

    return lines
  }

  // A selected set is exact: the activation rules do not apply, so no
  // dimension is left for the coordinator to resolve and a conditional one
  // the operator did not name is listed as not run.
  lines.push(
    'The operator selected a dimension set with `--dimensions`. ' +
      (shepherd ? 'Every batch review' : 'The squad') +
      ' runs exactly these dimensions, each with the charter that defines it. ' +
      'Neither the harness lineup swap nor the activation rules apply to a ' +
      'selected set. This review is partial: the report MUST name the ' +
      'dimensions below that it did not cover.',
    '',
    `- Selected: ${slugList(selection.selected)}`,
    `- Not run: ${slugList(selection.not_run)}`,
    '',
  )

  return lines
}

export interface GovernanceCardRunBinding {
  run_id: string
  workflow_slug: string
  /** Command the supervisor runs after reading the card. */
  attest_command: string
}

/**
 * Render the complete Markdown of a standalone or supervisor governance card:
 * header, attestation section when bound to a run, operator input, worktree,
 * path note, policies in force for the card's audience, base conduct, review
 * dimensions, agent-executed validation requirements, and boundaries. Pure; the
 * caller writes the result.
 */
export function renderGovernanceCardMarkdown(options: {
  mode: StandaloneMode
  policies: Policy[]
  requirements: RequirementManifest
  requestPath: string | null
  harnessPrefixNote: string | null
  worktree: WorktreeRecord | null
  baseConduct: BaseConductBlock | null
  /** Present only on the review and shepherd cards. */
  reviewDimensions?: ReviewDimensionSelection | null
  /** Present only on the supervisor card, which binds to one run. */
  run?: GovernanceCardRunBinding | null
}): string {
  const { mode, policies, requirements, requestPath } = options
  const run = options.run ?? null
  const policyAudience: PolicyCardAudience =
    mode.kind === 'supervisor' ? 'supervisor' : 'agent'
  const agentRequirements = [
    ...requirements.automation_requirements,
    ...requirements.validation_requirements,
  ].filter((requirement) => requirement.executor !== 'harness')

  const policyIdOf = (policyPath: string) =>
    /^governance\/policies\/([^/]+)\.json$/u.exec(policyPath)?.[1] ?? null
  const policyBlocks = renderPolicyBlocks(
    policies,
    3,
    policyAudience,
    new Set((options.baseConduct?.policies ?? []).map((policy) => policy.id)),
    new Set(
      (options.baseConduct?.excluded ?? [])
        .map(policyIdOf)
        .filter((id): id is string => id !== null),
    ),
  )

  return `${[
    `# 🤝 ${mode.title}`,
    '',
    `**Mode** \`${mode.kind}\` · **Persona** \`${mode.persona}\` · ` +
      (run ? `**Workflow** \`${run.workflow_slug}\`` : '**Workflow** none'),
    '',
    mode.summary,
    '',
    ...(run
      ? [
          `This card is the complete supervisor governance contract for run ` +
            `\`${run.run_id}\`. Every policy below binds the supervisor for ` +
            'the whole run. A policy named elsewhere by id only is delivered ' +
            'here in full.',
          '',
          '## ✍️ Attestation',
          '',
          `- Run: \`${run.run_id}\``,
          `- Attest command: \`${run.attest_command}\``,
          '',
          'Read this card in full, then run the attest command with the ' +
            'digest `pan governance card --mode supervisor` reported. ' +
            '`pan prepare` and `pan submit` fail with ' +
            '`SUPERVISOR_CARD_UNATTESTED` until the current digest is attested.',
          '',
        ]
      : [
          'This card is the complete governance contract for this mode. It is not a ' +
            'workflow stage: there is no gate, no declared stage output, and no ' +
            'transition. The operator decides what to do and when it is finished.',
          '',
        ]),
    ...(requestPath
      ? ['## 📥 Operator input', '', `- \`${requestPath}\``, '']
      : []),
    ...(options.worktree
      ? [
          '## 🌳 Workspace worktree',
          '',
          `- Worktree: \`${options.worktree.name}\``,
          `- Path: \`${options.worktree.path}\``,
          `- Branch: \`${options.worktree.branch}\``,
          '',
          'The operator selected this worktree as the workspace. Do all ' +
            'workspace work inside its path. Do not change the main checkout.',
          '',
        ]
      : []),
    ...(options.harnessPrefixNote
      ? ['## 📂 Path resolution', '', options.harnessPrefixNote, '']
      : []),
    '## 📜 Policies in force',
    '',
    ...policyBlocks,
    '',
    ...(options.baseConduct ? renderBaseConduct(options.baseConduct) : []),
    ...(options.reviewDimensions
      ? renderReviewDimensions(options.reviewDimensions, mode.kind)
      : []),
    ...(agentRequirements.length > 0
      ? [
          '## ✅ Agent validation requirements',
          '',
          '| Policy | Requirement | Registry | Phase | Target | Failure route |',
          '| --- | --- | --- | --- | --- | --- |',
          ...agentRequirements.map(
            (requirement) =>
              `| ${requirement.policy_id} | ${requirement.requirement_id} | ` +
              `${requirement.registry_id}@${requirement.registry_version} | ` +
              `${requirement.phase} | ` +
              `${requirement.resolved_target ?? requirement.target} | ` +
              `${requirement.failure_route} |`,
          ),
          '',
        ]
      : []),
    '## 🚧 Boundaries',
    '',
    ...mode.boundaries.map((item) => `- ${item}`),
    '',
  ].join('\n')}\n`
}
