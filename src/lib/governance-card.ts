import path from 'node:path'

import { invariant } from './errors.js'
import { ensureDir, fileExists, resolveInside, writeTextAtomic } from './io.js'
import { makeRunId } from './state.js'
import { resolvePolicies } from './policies.js'
import { harnessPathPrefix, isTargetInstallation } from './project-config.js'
import { resolveRequirements } from './requirements/resolve.js'
import type { InvocationKind } from './requirements/types.js'
import { PROTECTED_PATH_RULE } from './workspace/protected-paths.js'
import type { Policy, RequirementManifest } from './types.js'

/**
 * A standalone mode is work the operator drives directly: no run, no workflow, no
 * stage contract. `workflow` and `stage` are the identifiers the policy lookup
 * table matches against, which is how a non-workflow mode resolves governance
 * through the same applicability map every workflow stage uses.
 */
export interface StandaloneMode {
  kind: InvocationKind
  persona: string
  workflow: string
  stage: string
  title: string
  /** What the mode is for, shown to the operator and the delegated agent. */
  summary: string
  boundaries: string[]
}

export const STANDALONE_MODES: Record<string, StandaloneMode> = {
  pair: {
    kind: 'pair',
    persona: 'coder',
    workflow: 'standalone',
    stage: 'pair',
    title: 'Pair programming',
    summary:
      'The operator directs code changes turn by turn. The agent applies the ' +
      'governance its persona carries, and is bound to no workflow, stage ' +
      'contract, gate, or run contract.',
    boundaries: [
      'You MUST treat the operator as the authority for scope, sequencing, and when the work is done.',
      'You MUST NOT create, advance, or submit a workflow run, and MUST NOT write workflow state.',
      'You MUST report what you changed after each turn, in enough detail that the operator can review it without rereading the diff.',
      PROTECTED_PATH_RULE,
      'You MUST NOT commit, push, merge, publish, deploy, or perform destructive source-control actions unless the operator explicitly directs that action.',
      'You MUST say so plainly when a request would break something, then follow the operator’s decision.',
    ],
  },
  spotfix: {
    kind: 'spotfix',
    persona: 'spotfixer',
    workflow: 'standalone',
    stage: 'spotfix',
    title: 'Lightweight spotfix',
    summary:
      'One bounded small-scope change with proportionate tests, validated in at ' +
      'most three cycles and escalated to a systematic run if it does not hold.',
    boundaries: [
      'You MUST verify lightweight eligibility before editing and MUST escalate rather than expand scope.',
      PROTECTED_PATH_RULE,
      'You MUST NOT commit, push, merge, publish, deploy, or invoke pan set-stage.',
    ],
  },
  investigation: {
    kind: 'investigation',
    persona: 'investigator',
    workflow: 'standalone',
    stage: 'debug',
    title: 'Investigation',
    summary:
      'Non-mutating root-cause analysis that defines acceptance criteria and ' +
      'recommends exactly one work mode.',
    boundaries: [
      'You MUST NOT modify any workspace file.',
      PROTECTED_PATH_RULE,
      'You MUST recommend exactly one work mode and MUST justify it against the evidence.',
    ],
  },
  repair: {
    kind: 'repair',
    persona: 'harness-technician',
    workflow: 'standalone',
    stage: 'repair',
    title: 'Harness repair investigation',
    summary:
      'Non-mutating forensics on Pancreator failures or run artifacts, ending in ' +
      'a validated self-development intake item.',
    boundaries: [
      'You MUST NOT modify any file outside the declared intake artifact.',
      PROTECTED_PATH_RULE,
      'You MUST ground every finding in run evidence rather than inference.',
    ],
  },
  decomposition: {
    kind: 'decomposition',
    persona: 'decomposer',
    workflow: 'standalone',
    stage: 'decompose',
    title: 'Intake decomposition',
    summary:
      'Conservative scope decomposition that defaults to retaining one larger ' +
      'systematic run.',
    boundaries: [
      'You MUST NOT modify any file outside the declared decomposition artifact.',
      PROTECTED_PATH_RULE,
      'You MUST default to one larger systematic run unless the evidence requires splitting it.',
    ],
  },
}

export interface GovernanceCard {
  mode: string
  path: string
  markdown: string
  policies: Policy[]
  requirements: RequirementManifest
}

export interface GovernanceCardOptions {
  mode: string
  requestPath?: string | null
  outputPath?: string | null
}

function renderGovernanceCardMarkdown(options: {
  mode: StandaloneMode
  policies: Policy[]
  requirements: RequirementManifest
  requestPath: string | null
  harnessPrefixNote: string | null
}): string {
  const { mode, policies, requirements, requestPath } = options
  const agentRequirements = [
    ...requirements.automation_requirements,
    ...requirements.validation_requirements,
  ].filter((requirement) => requirement.executor !== 'harness')

  const policyBlocks = policies.length
    ? policies.flatMap((policy) => {
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

  return `${[
    `# 🤝 ${mode.title}`,
    '',
    `**Mode** \`${mode.kind}\` · **Persona** \`${mode.persona}\` · ` +
      '**Workflow** none',
    '',
    mode.summary,
    '',
    'This card is the complete governance contract for this mode. It is not a ' +
      'workflow stage: there is no gate, no declared stage output, and no ' +
      'transition. The operator decides what to do and when it is finished.',
    '',
    ...(requestPath
      ? ['## 📥 Operator input', '', `- \`${requestPath}\``, '']
      : []),
    ...(options.harnessPrefixNote
      ? ['## 📂 Path resolution', '', options.harnessPrefixNote, '']
      : []),
    '## 📜 Policies in force',
    '',
    ...policyBlocks,
    '',
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

/**
 * Resolve and render the governance contract for a standalone, non-workflow mode.
 *
 * Standalone commands previously told the agent to open policy JSON and inline it
 * by hand, which is both error-prone and unverifiable. Resolving the same
 * policies and requirements the workflow path uses, and writing them to a durable
 * card, makes a standalone mode auditable and removes the assembly step.
 */
export function buildGovernanceCard(
  root: string,
  options: GovernanceCardOptions,
): GovernanceCard {
  const mode = STANDALONE_MODES[options.mode]

  invariant(
    mode,
    `Unknown standalone mode '${options.mode}'. Available: ` +
      `${Object.keys(STANDALONE_MODES).sort().join(', ')}.`,
    { code: 'UNKNOWN_STANDALONE_MODE' },
  )

  if (options.requestPath) {
    invariant(
      fileExists(resolveInside(root, options.requestPath)),
      `Operator input does not exist: ${options.requestPath}`,
      { code: 'REQUEST_NOT_FOUND' },
    )
  }

  const policies = resolvePolicies(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    // A standalone mode is bound to no run, so no run contract applies.
    contracts: [],
  })
  const requirements = resolveRequirements(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    invocation_kind: mode.kind,
    contracts: [],
  })
  const relativePath =
    options.outputPath ??
    `runtime/logs/sessions/${makeRunId()}/${options.mode}-card.md`
  const markdown = renderGovernanceCardMarkdown({
    mode,
    policies,
    requirements,
    requestPath: options.requestPath ?? null,
    harnessPrefixNote: isTargetInstallation(root)
      ? `Harness-relative paths beginning \`runtime/\`, \`library/\`, or ` +
        `\`governance/\` are rooted at \`${harnessPathPrefix(root)}/\` when ` +
        'accessed from the target repository.'
      : null,
  })
  const absolute = resolveInside(root, relativePath)

  ensureDir(path.dirname(absolute))
  writeTextAtomic(absolute, markdown)

  return {
    mode: options.mode,
    path: relativePath,
    markdown,
    policies,
    requirements,
  }
}
