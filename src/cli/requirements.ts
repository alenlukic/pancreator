/**
 * The `requirements` command: resolving, running, and scaffolding the
 * validator requirements of a run invocation or a standalone target.
 */

import path from 'node:path'

import { getRunState } from '../lib/engine/run-status.js'
import { PanError } from '../lib/errors.js'
import { configuredWorkspaceRoot } from '../lib/project-config/resolve.js'
import { resolvePolicies } from '../lib/policies.js'
import { resolvePrDescriptionContext } from '../lib/pr-description.js'
import { isRecord, toRepoRelative } from '../lib/io.js'
import type { Invocation } from '../lib/types/invocation.js'
import type { ResolvedRequirement } from '../lib/types/requirements.js'
import type { InvocationKind } from '../lib/requirements/types.js'
import { loadRegistry } from '../lib/requirements/registry.js'
import { resolveRequirements } from '../lib/requirements/resolve.js'
import {
  inferTargetKind,
  isPassingResult,
  runRequirement,
} from '../lib/requirements/run.js'
import { readInvocationFromPath } from '../lib/requirements/scaffold.js'
import { resolveRunLayout } from '../lib/run-layout.js'
import { readWorktreeIndex } from '../lib/worktrees.js'
import {
  CODE_STYLE_POLICY_IDS,
  codeStylePolicyId,
} from '../lib/validators/code-style.js'

import type { CliContext } from './context.js'
import { hasFlag, option, print, requiredArgument } from './args.js'

const INVOCATION_KINDS = new Set<InvocationKind>([
  'workflow',
  'assessment',
  'spotfix',
  'investigation',
  'repair',
  'decomposition',
  'documentation',
  'standalone',
])

function invocationKindOption(
  args: string[],
  required = false,
): InvocationKind | undefined {
  const value = option(args, '--kind')

  if (!value) {
    if (required) {
      throw new PanError('--kind is required.', { code: 'INVALID_ARGUMENT' })
    }

    return undefined
  }

  if (!INVOCATION_KINDS.has(value as InvocationKind)) {
    // Agents guess a registry name, artifact type, or requirement phase here,
    // so the error spells the closed set and disambiguates it from --registry.
    throw new PanError(
      `Unknown invocation kind: ${value}. --kind names the invocation kind, ` +
        `one of ${[...INVOCATION_KINDS].join(', ')}. It is not the registry ` +
        'id (use --registry), the artifact type, or the requirement phase. ' +
        "A worker inside a workflow run passes '--kind workflow'.",
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value as InvocationKind
}

/** Normalize invocation paths; resolve bare ids through their run layout. */
function requirementsRunInvocationPath(
  root: string,
  invocationReference: string,
  runId: string | null,
): string {
  const isPathReference =
    path.isAbsolute(invocationReference) ||
    invocationReference.includes('/') ||
    invocationReference.includes('\\') ||
    path.extname(invocationReference).length > 0

  if (isPathReference) {
    try {
      return toRepoRelative(root, invocationReference)
    } catch (error) {
      if (error instanceof PanError && error.code === 'PATH_ESCAPE') {
        throw new PanError(
          `Invocation path must remain inside the harness root: ` +
            `${invocationReference}. Pass a harness-relative path inside the ` +
            'root, or pass an invocation id together with --run <run-id>.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      throw error
    }
  }

  if (!runId) {
    throw new PanError(
      `Invocation id '${invocationReference}' requires --run <run-id>. ` +
        'Alternatively, pass the exact invocation JSON snapshot path.',
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return resolveRunLayout(root, runId).invocation(invocationReference, '.json')
    .relative
}

/** Load and validate the invocation fields `requirements run` consumes. */
function requirementsRunInvocation(
  root: string,
  invocationPath: string,
): Invocation {
  const value: unknown = readInvocationFromPath(root, invocationPath)
  const validRequirement = (entry: unknown): boolean =>
    isRecord(entry) &&
    typeof entry.policy_id === 'string' &&
    typeof entry.requirement_id === 'string' &&
    typeof entry.registry_id === 'string' &&
    typeof entry.registry_version === 'string' &&
    (entry.kind === 'automation' || entry.kind === 'validator') &&
    typeof entry.phase === 'string' &&
    typeof entry.executor === 'string' &&
    typeof entry.target === 'string' &&
    isRecord(entry.arguments) &&
    typeof entry.enforcement === 'string' &&
    typeof entry.failure_route === 'string'

  if (
    !isRecord(value) ||
    typeof value.invocation_id !== 'string' ||
    value.invocation_id.length === 0 ||
    typeof value.run_id !== 'string' ||
    value.run_id.length === 0 ||
    typeof value.workspace_root !== 'string' ||
    value.workspace_root.length === 0 ||
    !isRecord(value.workflow) ||
    typeof value.workflow.slug !== 'string' ||
    !isRecord(value.stage) ||
    typeof value.stage.slug !== 'string' ||
    typeof value.stage.persona !== 'string' ||
    !isRecord(value.output) ||
    typeof value.output.path !== 'string' ||
    !isRecord(value.workspace_before) ||
    (value.workspace_before.kind !== 'git' &&
      value.workspace_before.kind !== 'filesystem') ||
    typeof value.workspace_before.fingerprint !== 'string' ||
    !Array.isArray(value.workspace_before.entries) ||
    !value.workspace_before.entries.every(
      (entry) => typeof entry === 'string',
    ) ||
    !isRecord(value.requirements) ||
    !Array.isArray(value.requirements.validation_requirements) ||
    !value.requirements.validation_requirements.every(validRequirement) ||
    !Array.isArray(value.requirements.automation_requirements) ||
    !value.requirements.automation_requirements.every(validRequirement)
  ) {
    throw new PanError(
      `--invocation does not contain the workflow, stage, output, ` +
        `workspace_before, and requirement fields needed by requirements run: ` +
        invocationPath,
      { code: 'INVALID_INVOCATION' },
    )
  }

  return value as unknown as Invocation
}

/**
 * Identify requirements that execute identically, whatever policy declares
 * them. Exported so a test can hold sibling declarations to the shape this
 * command collapses, rather than to the ambiguity message.
 */
export function requirementShapeKey(requirement: ResolvedRequirement): string {
  return [
    // The declaring policy is part of the shape. Two language policies bind
    // one code-style handler, and collapsing them discarded the one field
    // that says which handbook the evidence is judged against.
    requirement.policy_id,
    requirement.registry_id,
    requirement.registry_version,
    requirement.phase,
    requirement.executor,
    requirement.resolved_target ?? requirement.target,
    requirement.enforcement,
    requirement.failure_route,
    requirement.evidence_class,
    requirement.success_condition,
    JSON.stringify(requirement.arguments),
  ].join('|')
}

/** `pan requirements`. */
export function requirementsCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'resolve') {
    const persona = requiredArgument(option(args, '--persona'), '--persona')
    const workflow = requiredArgument(option(args, '--workflow'), '--workflow')
    const stage = requiredArgument(option(args, '--stage'), '--stage')

    const outputPath = option(args, '--output-path') ?? undefined
    const invocationKind = invocationKindOption(args)

    print(
      resolveRequirements(root, {
        persona,
        workflow,
        stage,
        ...(invocationKind ? { invocation_kind: invocationKind } : {}),
        ...(outputPath
          ? {
              invocation: {
                output_path: outputPath,
                artifact_paths: [outputPath],
              },
            }
          : {}),
      }),
      hasFlag(args, '--json'),
    )
    return
  }

  if (sub === 'run') {
    const runOption = option(args, '--run')
    const invocationReference = option(args, '--invocation')
    const invocationPath = invocationReference
      ? requirementsRunInvocationPath(root, invocationReference, runOption)
      : null
    const invocation = invocationPath
      ? requirementsRunInvocation(root, invocationPath)
      : null

    const contextualArgument = (
      name: string,
      invocationValue: string | undefined,
    ): string => {
      const explicit = option(args, name)

      if (explicit && invocationValue && explicit !== invocationValue) {
        throw new PanError(
          `${name} '${explicit}' does not match invocation value ` +
            `'${invocationValue}'.`,
          { code: 'INVALID_ARGUMENT' },
        )
      }

      return requiredArgument(explicit ?? invocationValue ?? null, name)
    }
    const persona = contextualArgument('--persona', invocation?.stage.persona)
    const workflow = contextualArgument('--workflow', invocation?.workflow.slug)
    const stage = contextualArgument('--stage', invocation?.stage.slug)

    const explicitKind = invocationKindOption(args, invocation === null)
    const invocationKind = explicitKind ?? 'workflow'

    if (invocation && invocationKind !== 'workflow') {
      throw new PanError(
        `--kind '${invocationKind}' does not match a workflow invocation.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const registryId = requiredArgument(
      option(args, '--registry'),
      '--registry',
    )
    const targetArgument = requiredArgument(
      option(args, '--target') ?? invocation?.output.path ?? null,
      '--target',
    )
    // Handlers join the target to the root, and `path.join` appends an
    // absolute second argument instead of honoring it. A path relative to
    // the root reads the same file, including one outside the root.
    const targetPath = path.isAbsolute(targetArgument)
      ? path.relative(root, targetArgument)
      : targetArgument
    let validatorInvocation: Record<string, unknown> | undefined = invocation
      ? (invocation as unknown as Record<string, unknown>)
      : undefined

    // Handlers that inspect the workspace (changed files, Git state,
    // evidence paths) resolve it from the exact invocation snapshot when
    // supplied. Otherwise the run state or selected worktree identifies
    // the workspace, preserving the standalone command contract.
    if (invocation && runOption && runOption !== invocation.run_id) {
      throw new PanError(
        `--run '${runOption}' does not match invocation run ` +
          `'${invocation.run_id}'.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const boundRunState = runOption
      ? (getRunState(root, runOption) as unknown as Record<string, unknown>)
      : null
    const worktreeOption = option(args, '--worktree')

    if (invocation && worktreeOption) {
      throw new PanError(
        '--invocation and --worktree cannot be used together; the ' +
          'invocation already names its exact workspace.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const worktreeWorkspace = worktreeOption
      ? readWorktreeIndex(root).worktrees.find(
          (entry) => entry.name === worktreeOption,
        )
      : undefined

    if (worktreeOption && !worktreeWorkspace) {
      // A read-only check must not create a worktree from a typo.
      throw new PanError(
        `No worktree named '${worktreeOption}' is recorded. Run ` +
          `'pan worktree list' to see the recorded worktrees.`,
        { code: 'WORKTREE_NOT_FOUND' },
      )
    }

    const workspaceRoot = path.resolve(
      root,
      invocation?.workspace_root ??
        worktreeWorkspace?.path ??
        (typeof boundRunState?.workspace_root === 'string'
          ? boundRunState.workspace_root
          : configuredWorkspaceRoot(root)),
    )
    const validatorRunState: Record<string, unknown> = {
      ...(boundRunState ?? {}),
      workspace_root: workspaceRoot,
    }

    if (!invocation && registryId === 'PR-DESCRIPTION-VALIDATE-001') {
      const policies = resolvePolicies(root, {
        persona,
        workflow,
        stage,
        operator_artifacts: 'requested',
      })

      validatorInvocation = {
        inputs: {
          pr_description: resolvePrDescriptionContext(workspaceRoot, policies),
        },
      }
    }

    const manifest =
      invocation?.requirements ??
      resolveRequirements(root, {
        persona,
        workflow,
        stage,
        invocation_kind: invocationKind,
        invocation: {
          output_path: targetPath,
          artifact_paths: [targetPath],
        },
      })
    const governingPolicy =
      registryId === 'CODE-STYLE-VALIDATE-001'
        ? codeStylePolicyId(targetPath)
        : null
    const requirements = [
      ...manifest.automation_requirements,
      ...manifest.validation_requirements,
    ].filter(
      (item) =>
        item.registry_id === registryId &&
        // Each language policy declares the same code-style check, and
        // only the one that governs the scanned file may judge it.
        (governingPolicy === null ||
          !CODE_STYLE_POLICY_IDS.includes(item.policy_id) ||
          item.policy_id === governingPolicy),
    )
    let selected = requirements

    if (requirements.length > 1) {
      // Sibling policies may each declare the same check on one shared
      // context: the style mode binds one code-style check through both
      // its language policies. Identical execution shapes describe one
      // run, so collapsing them keeps the ambiguity error for the
      // configurations that really are ambiguous.
      const shapes = new Set(
        requirements.map((item) => requirementShapeKey(item)),
      )

      if (shapes.size === 1) {
        selected = [requirements[0] as ResolvedRequirement]
      } else {
        const required = requirements.filter(
          (item) => item.enforcement === 'required',
        )

        if (required.length === 1) {
          selected = required
        }
      }
    }

    if (selected.length !== 1) {
      throw new PanError(
        requirements.length === 0
          ? `Registry ${registryId} did not resolve for this context.`
          : `Registry ${registryId} resolved more than once for this context.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const catalog = loadRegistry(root)
    const entry = catalog.entries.get(registryId)
    const targetKind = inferTargetKind(targetPath)

    if (entry?.kind !== 'validator') {
      throw new PanError(
        `Registry ${registryId} is not a standalone validator.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    if (!entry.target_types.includes(targetKind)) {
      throw new PanError(
        `Registry ${registryId} does not accept target kind ${targetKind}.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const comparisonBase = invocation
      ? {
          source: 'invocation.workspace_before' as const,
          workspace_root: workspaceRoot,
          fingerprint: invocation.workspace_before.fingerprint,
          invocation_path: requiredArgument(invocationPath, '--invocation'),
          run_id: invocation.run_id,
        }
      : {
          source: 'workspace.cumulative_diff' as const,
          workspace_root: workspaceRoot,
          ...(runOption ? { run_id: runOption } : {}),
        }
    const result = runRequirement({
      root,
      requirement: selected[0],
      targetPath,
      executor: 'agent',
      ...(invocation
        ? { workspaceFingerprint: invocation.workspace_before.fingerprint }
        : {}),
      comparisonBase,
      ...(validatorInvocation ? { invocation: validatorInvocation } : {}),
      runState: validatorRunState,
      catalog,
      persist: false,
    })

    print(result, hasFlag(args, '--json'))

    if (!isPassingResult(result)) {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown requirements subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
