/**
 * Resolve a standalone mode's policies and requirements, bind its worktree and
 * review scope, and write the durable card.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, resolveInside, ensureDir, writeTextAtomic } from '../io.js'
import { keywordRunSuffix } from '../naming.js'
import { makeUniqueRunId } from '../state.js'
import { resolvePolicies } from '../policies.js'
import { isTargetInstallation, harnessPathPrefix } from '../project-config.js'
import { resolveRequirements } from '../requirements/resolve.js'
import { readTargetExtensionManifest } from '../target-authoring.js'
import {
  resolveOrCreateWorktree,
  workspaceRepositoryRoot,
} from '../worktrees.js'
import {
  type ReviewDimensionSelection,
  resolveReviewDimensionSelection,
} from '../review-dimensions.js'
import { resolveReviewScope } from '../review-scope.js'
import type { WorktreeRecord } from '../worktrees.js'
import type { Policy, RequirementManifest, RunContract } from '../types.js'
import { STANDALONE_MODES } from './modes.js'
import { baseConductBlock, renderGovernanceCardMarkdown } from './render.js'

export interface GovernanceCard {
  mode: string
  path: string
  markdown: string
  policies: Policy[]
  requirements: RequirementManifest
  /** Worktree the shared `--worktree` option resolved or created, when given. */
  worktree?: WorktreeRecord
  /** Review and shepherd modes only. The dimension selection the card records. */
  review_dimensions?: ReviewDimensionSelection
}

export interface GovernanceCardOptions {
  mode: string
  /** Target mode only. Identifier of the target-owned extension. */
  extensionId?: string | null
  requestPath?: string | null
  outputPath?: string | null
  /** Session-scoped contracts for an unbound task; absent stays standalone. */
  contracts?: readonly RunContract[] | null
  worktreeName?: string | null
  /** Review mode only. Conduct policies render from this base revision. */
  baseRef?: string | null
  /** Review mode only. The target head. Use it with `baseRef`. */
  targetRef?: string | null
  /**
   * Review mode only. The revision whose checked-out tree the scope check may
   * read when the scoping checkout sits away from the target head.
   */
  closureRevision?: string | null
  /**
   * Review mode only. Dimension slugs the operator selected. Empty or absent
   * runs the default lineup.
   */
  dimensions?: readonly string[] | null
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
  const registeredMode = STANDALONE_MODES[options.mode]

  invariant(
    registeredMode,
    `Unknown standalone mode '${options.mode}'. Available: ` +
      `${Object.keys(STANDALONE_MODES).sort().join(', ')}.`,
    { code: 'UNKNOWN_STANDALONE_MODE' },
  )
  invariant(
    !options.contracts?.length || options.mode === 'unbound',
    'Session-scoped contracts apply to the unbound mode only.',
    { code: 'INVALID_GOVERNANCE_CARD_OPTION' },
  )
  invariant(
    options.extensionId === undefined ||
      options.extensionId === null ||
      options.mode === 'target',
    '--extension applies to the target mode only.',
    { code: 'INVALID_GOVERNANCE_CARD_OPTION' },
  )

  let mode = registeredMode

  if (options.mode === 'target') {
    invariant(options.extensionId, 'The target mode requires --extension.', {
      code: 'TARGET_EXTENSION_REQUIRED',
    })

    const manifest = readTargetExtensionManifest(root, options.extensionId)

    mode = {
      ...registeredMode,
      persona: manifest.context.persona,
      stage: manifest.context.stage,
      title: manifest.title,
      summary: manifest.summary,
      boundaries: [
        `You MUST read \`${manifest.content_path}\` after you read this card.`,
        ...registeredMode.boundaries.slice(1),
      ],
    }
  }
  invariant(
    options.mode !== 'supervisor',
    'The supervisor card binds to one run. Run ' +
      '`pan governance card --mode supervisor --run <run-id>`.',
    { code: 'SUPERVISOR_CARD_REQUIRES_RUN' },
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
  const selectsDimensions =
    options.mode === 'review' || options.mode === 'shepherd'

  invariant(
    !options.dimensions?.length || selectsDimensions,
    '--dimensions applies to the review and shepherd modes only.',
    { code: 'INVALID_GOVERNANCE_CARD_OPTION' },
  )

  // Resolve the selection before any side effect, so an unknown dimension
  // fails the session at the card step and before any worker launches.
  const reviewDimensions = selectsDimensions
    ? resolveReviewDimensionSelection(root, options.dimensions ?? [])
    : null

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
    // Only a long-horizon prompt task binds a standalone card to run
    // contracts. Ordinary standalone cards keep the empty selection.
    contracts: [...(options.contracts ?? [])],
    operator_artifacts: 'suppressed',
  })
  const requirements = resolveRequirements(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    invocation_kind: mode.kind,
    contracts: [...(options.contracts ?? [])],
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
    ? (() => {
        const targetRoot = worktree
          ? path.resolve(root, worktree.path)
          : workspaceRepositoryRoot(root)
        // A self-development worktree carries the tracked closure at the
        // target revision. Target worktrees do not carry the installed harness,
        // so their closure stays rooted at the installation instead.
        const closureRoot =
          worktree && !isTargetInstallation(root) ? targetRoot : root

        return baseConductBlock(
          targetRoot,
          resolveReviewScope(closureRoot, targetRoot, {
            head: options.targetRef ?? 'HEAD',
            base: options.baseRef,
            closureRevision: options.closureRevision,
          }),
        )
      })()
    : null
  const markdown = renderGovernanceCardMarkdown({
    mode,
    policies,
    requirements,
    baseConduct,
    reviewDimensions,
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
    ...(reviewDimensions ? { review_dimensions: reviewDimensions } : {}),
  }
}
