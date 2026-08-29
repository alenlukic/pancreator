import path from 'node:path'

import { invariant } from './errors.js'
import { ensureDir, fileExists, resolveInside, writeTextAtomic } from './io.js'
import { keywordRunSuffix } from './naming.js'
import { makeUniqueRunId } from './state.js'
import { resolvePolicies } from './policies.js'
import { renderPolicyBlocks } from './policy-guidance.js'
import { harnessPathPrefix, isTargetInstallation } from './project-config.js'
import { resolveRequirements } from './requirements/resolve.js'
import type { InvocationKind } from './requirements/types.js'
import { PROTECTED_PATH_RULE } from './workspace/protected-paths.js'
import { resolveOrCreateWorktree } from './worktrees.js'
import { gitShowFile } from './git.js'
import {
  REVIEW_MODE_CONTEXT,
  conflictsByTier,
  resolveReviewScope,
  type ReviewScope,
} from './review-scope.js'
import type { WorktreeRecord } from './worktrees.js'
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
  shepherd: {
    kind: 'shepherd',
    persona: 'coder',
    workflow: 'standalone',
    stage: 'shepherd',
    title: 'PR shepherd loop',
    summary:
      'Watches one operator-named GitHub pull request in bounded poll windows, ' +
      'judges each feedback item against the code and the ledgered review ' +
      'history, implements only accepted items, and pushes only changes the ' +
      'local review squad has passed.',
    boundaries: [
      'You MUST commit and push only to the shepherded pull request’s head branch, and only changes whose squad review passed.',
      'You MUST NOT merge, close, retarget, or rebase the pull request, MUST NOT force-push, and MUST NOT push to any other branch.',
      PROTECTED_PATH_RULE,
      'You MUST NOT create, advance, or write state for a workflow run.',
      'You MUST record every feedback item and its disposition in the session ledger, and MUST NOT post PR comments unless the operator directed it.',
    ],
  },
  review: {
    kind: 'review',
    persona: 'reviewer',
    ...REVIEW_MODE_CONTEXT,
    title: 'Review squad',
    summary:
      'One review-squad pass over an operator-named target — a ref range, a ' +
      'pull request, or a path set. The session captures the target once, ' +
      'delegates one coordinator that fans the review out across its ' +
      'dimensions, and returns ranked findings with a verdict. It owns no ' +
      'run, no stage contract, and no gate, and it changes nothing.',
    boundaries: [
      'You MUST capture the review target once and MUST give every reviewing agent that same capture.',
      'You MUST delegate exactly one review-squad coordinator per round. It alone resolves the lineup and owns the join, the ranking, and the verdict.',
      'You MUST issue the dimension fan-out yourself, at the top level and in one message, with the charters the coordinator resolved, because a nested spawn runs on the platform default model. You MUST NOT join, rank, or grade findings yourself.',
      'You MUST NOT edit, stage, commit, push, or write workflow state; a standalone review returns findings and nothing else.',
      'Under this card the reviewer persona holds no remediation duty. Its bounded-remediation rules do not apply, and it edits nothing.',
      'You MUST run the review-scope check and act by tier: instrument conflicts leave the squad verdict for an independent reviewer, conduct conflicts are reviewed under the base text this card renders with --base, and substrate conflicts taint any verification that leans on them.',
      'You MUST NOT reject a change for differing from the standard it replaces. Report the standards delta and leave the merits of a rule change to the operator.',
      PROTECTED_PATH_RULE,
      'You MUST name the dimensions that ran, the ones the target did not activate, and any charter the coordinator had to apply itself.',
      'You MUST leave remediation to the operator, who decides separately what to act on.',
    ],
  },
  'best-of-n': {
    kind: 'best_of_n',
    persona: 'meta-orchestrator',
    workflow: 'standalone',
    stage: 'best-of-n',
    title: 'Best-of-N session',
    summary:
      'One task attempted by N candidate runs in isolated worktrees, then ' +
      'consolidated into one implementation by a separate run. The session ' +
      'agent owns no run, no stage contract, and no gate.',
    boundaries: [
      'You MUST use `./bin/pan best-of-n` for session lifecycle and `./bin/pan` for child-run supervision.',
      'You MUST NOT create worktrees, runs, session records, or run records by hand.',
      'You MUST directly perform supervisor mechanics for every child run.',
      'You MUST NOT delegate a child run to another `pan-orchestrator`.',
      'You MUST delegate stages to run-scoped worker agents with foreground, blocking calls.',
      'You MUST collect terminal candidate failures without creating an operator gate.',
      'You MUST report only non-terminal execution blockers that make a candidate unable to continue.',
      PROTECTED_PATH_RULE,
      'You MUST NOT commit, push, merge, publish, deploy, delete a branch, or remove a worktree unless the operator explicitly directs that action.',
    ],
  },
  unbound: {
    kind: 'standalone',
    persona: 'unbound',
    workflow: 'standalone',
    stage: 'unbound',
    title: 'Unbound operator request',
    summary:
      'Ad-hoc operator-directed work outside every run and named mode. The ' +
      'card attaches the universal policies that otherwise arrive only on an ' +
      'invocation or a mode card. An unbound agent then works under the same ' +
      'secret, prompt-trust, primer, and delegation rules.',
    boundaries: [
      'You MUST treat the operator as the authority for scope, sequencing, and completion.',
      'You MUST NOT create, advance, or write state for a workflow run.',
      PROTECTED_PATH_RULE,
      'You MUST NOT commit, push, merge, publish, deploy, or perform destructive source-control actions unless the operator explicitly directs that action.',
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
  /** Worktree the shared `--worktree` option resolved or created, when given. */
  worktree?: WorktreeRecord
}

export interface GovernanceCardOptions {
  mode: string
  requestPath?: string | null
  outputPath?: string | null
  worktreeName?: string | null
  /** Review mode only. Conduct policies render from this base revision. */
  baseRef?: string | null
  /** Review mode only. The target head. Use it with `baseRef`. */
  targetRef?: string | null
}

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

function baseConductBlock(root: string, scope: ReviewScope): BaseConductBlock {
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

    const text = gitShowFile(root, scope.base, conflict.path)

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
        ? record.instructions.filter(
            (item): item is string => typeof item === 'string',
          )
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

function renderGovernanceCardMarkdown(options: {
  mode: StandaloneMode
  policies: Policy[]
  requirements: RequirementManifest
  requestPath: string | null
  harnessPrefixNote: string | null
  worktree: WorktreeRecord | null
  baseConduct: BaseConductBlock | null
}): string {
  const { mode, policies, requirements, requestPath } = options
  const agentRequirements = [
    ...requirements.automation_requirements,
    ...requirements.validation_requirements,
  ].filter((requirement) => requirement.executor !== 'harness')

  const policyIdOf = (policyPath: string) =>
    /^governance\/policies\/([^/]+)\.json$/u.exec(policyPath)?.[1] ?? null
  const policyBlocks = renderPolicyBlocks(
    policies,
    3,
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

  // Check the options before any side effect, so a rejected call leaves no
  // worktree behind.
  invariant(
    !options.baseRef || options.mode === 'review',
    '--base applies to the review mode only.',
    { code: 'INVALID_GOVERNANCE_CARD_OPTION' },
  )
  invariant(
    !options.targetRef || options.baseRef,
    '--target requires --base.',
    {
      code: 'INVALID_GOVERNANCE_CARD_OPTION',
    },
  )
  // Without --target the card grades HEAD, which is the target only in the
  // review workspace.
  invariant(
    !options.baseRef || options.targetRef,
    '--base requires --target in the review mode.',
    {
      code: 'INVALID_GOVERNANCE_CARD_OPTION',
    },
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
    operator_artifacts: 'suppressed',
  })
  const requirements = resolveRequirements(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    invocation_kind: mode.kind,
    contracts: [],
    operator_artifacts: 'suppressed',
  })
  const worktree = options.worktreeName
    ? resolveOrCreateWorktree(
        root,
        options.worktreeName,
        `Worktree '${options.worktreeName}'`,
      )
    : null
  const relativePath =
    options.outputPath ??
    `runtime/logs/sessions/${makeUniqueRunId(
      path.join(root, 'runtime', 'logs', 'sessions'),
      keywordRunSuffix(options.mode),
    )}/${options.mode}-card.md`

  const baseConduct = options.baseRef
    ? baseConductBlock(
        root,
        resolveReviewScope(root, {
          head: options.targetRef ?? 'HEAD',
          base: options.baseRef,
        }),
      )
    : null
  const markdown = renderGovernanceCardMarkdown({
    mode,
    policies,
    requirements,
    baseConduct,
    requestPath: options.requestPath ?? null,
    harnessPrefixNote: isTargetInstallation(root)
      ? `Harness-relative paths beginning \`runtime/\`, \`library/\`, or ` +
        `\`governance/\` are rooted at \`${harnessPathPrefix(root)}/\` when ` +
        'accessed from the target repository.'
      : null,
    worktree,
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
    ...(worktree ? { worktree } : {}),
  }
}
