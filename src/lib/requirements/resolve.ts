import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { isRecord, readJson, sha256 } from '../io.js'
import { resolvePolicies } from '../policies.js'
import type {
  Policy,
  PolicyRequirement,
  RequirementManifest,
  ResolvedRequirement,
} from '../types.js'
import type { RequirementContext } from './types.js'
import { loadRegistry, type RegistryCatalog } from './registry.js'
import { registryStageSlug } from './run.js'
import { VALID_EXECUTORS, VALID_FAILURE_ROUTES, VALID_PHASES } from './types.js'

const INLINE_PATH_PATTERN = /\.\/bin\/|\bnpm run\b|\bnode\s+/u
const VALID_TARGET_PATTERN =
  /^(invocation\.output\.path|artifact:\d+|repository|\.)$/u

function matchesPattern(pattern: string, value: string): boolean {
  return pattern === '*' || pattern === value
}

function normalizedInvocationKind(
  context: RequirementContext,
): RequirementContext['invocation_kind'] {
  return context.invocation_kind ?? 'workflow'
}

/** Return whether a policy requirement applies to the active invocation context. */
export function requirementApplies(
  requirement: PolicyRequirement,
  registryId: string,
  context: RequirementContext,
): boolean {
  const invocationKind = normalizedInvocationKind(context)

  if (requirement.applicability) {
    for (const [key, pattern] of Object.entries(requirement.applicability)) {
      const actual =
        key === 'invocation_kind'
          ? invocationKind
          : key === 'stage'
            ? context.stage
            : key === 'persona'
              ? context.persona
              : key === 'workflow'
                ? context.workflow
                : undefined

      if (typeof actual !== 'string' || !matchesPattern(pattern, actual)) {
        return false
      }
    }

    return true
  }

  const stageSlug = registryStageSlug(registryId)

  if (stageSlug && stageSlug !== context.stage) {
    return false
  }

  if (registryId.startsWith('ASSESSMENT-')) {
    return invocationKind === 'assessment'
  }

  if (registryId.startsWith('SPOTFIX-')) {
    return invocationKind === 'spotfix'
  }

  if (registryId === 'INVESTIGATION-VALIDATE-001') {
    return (
      invocationKind === 'investigation' || context.persona === 'investigator'
    )
  }

  return true
}

function successCondition(registryId: string): string {
  return `Registry ${registryId} passes against the resolved target`
}

function resolveTarget(
  target: string,
  context: RequirementContext,
): { resolved?: string; unresolved?: string } {
  if (target === 'invocation.output.path') {
    return context.invocation?.output_path
      ? { resolved: context.invocation.output_path }
      : { unresolved: target }
  }

  if (target.startsWith('artifact:')) {
    const index = Number.parseInt(target.slice('artifact:'.length), 10)
    const artifactPath = context.invocation?.artifact_paths?.[index]

    return artifactPath ? { resolved: artifactPath } : { unresolved: target }
  }

  if (target === 'repository') {
    return { resolved: '.' }
  }

  return { unresolved: target }
}

function validateRequirement(
  requirement: PolicyRequirement,
  policy: Policy,
  catalog: RegistryCatalog,
  seenIds: Set<string>,
  errors: string[],
): void {
  const key = `${policy.id}:${requirement.id}`

  if (seenIds.has(key)) {
    errors.push(
      `duplicate requirement id ${requirement.id} in policy ${policy.id}`,
    )
    return
  }

  seenIds.add(key)

  if (!catalog.entries.has(requirement.registry_id)) {
    errors.push(
      `${policy.id} requirement ${requirement.id} references unknown registry id ${requirement.registry_id}`,
    )
  }

  if (!VALID_PHASES.has(requirement.phase)) {
    errors.push(`${policy.id} requirement ${requirement.id} has invalid phase`)
  }

  if (!VALID_EXECUTORS.has(requirement.executor)) {
    errors.push(
      `${policy.id} requirement ${requirement.id} has invalid executor`,
    )
  }

  if (
    !VALID_FAILURE_ROUTES.has(requirement.failure_route) &&
    !requirement.failure_route.includes('/')
  ) {
    errors.push(
      `${policy.id} requirement ${requirement.id} has invalid failure_route`,
    )
  }

  if (!VALID_TARGET_PATTERN.test(requirement.target)) {
    errors.push(
      `${policy.id} requirement ${requirement.id} has invalid target declaration: ${requirement.target}`,
    )
  }

  for (const instruction of policy.instructions) {
    if (INLINE_PATH_PATTERN.test(instruction)) {
      errors.push(
        `${policy.id} MUST NOT duplicate executable paths in instructions; use registry id references`,
      )
      break
    }
  }
}

function toResolvedRequirement(
  policy: Policy,
  requirement: PolicyRequirement,
  catalog: RegistryCatalog,
  context: RequirementContext,
): ResolvedRequirement {
  const entry = catalog.entries.get(requirement.registry_id)
  const binding = resolveTarget(requirement.target, context)

  return {
    policy_id: policy.id,
    requirement_id: requirement.id,
    registry_id: requirement.registry_id,
    registry_version: entry?.version ?? '0',
    kind: entry?.kind ?? 'validator',
    phase: requirement.phase,
    executor: requirement.executor,
    target: requirement.target,
    ...(binding.resolved ? { resolved_target: binding.resolved } : {}),
    arguments: requirement.arguments ?? {},
    enforcement: requirement.enforcement,
    failure_route: requirement.failure_route,
    evidence_class: requirement.evidence_class,
    success_condition: successCondition(requirement.registry_id),
  }
}

/** Resolve policy-bound requirements deterministically from the resolved policy set. */
export function resolveRequirements(
  root: string,
  context: RequirementContext,
): RequirementManifest {
  const policies = resolvePolicies(root, context)
  const catalog = loadRegistry(root)
  const errors: string[] = []
  const seenIds = new Set<string>()
  const automation: ResolvedRequirement[] = []
  const validation: ResolvedRequirement[] = []
  const resolvedTargets: Record<string, string> = {}
  const unresolvedBindings: string[] = []
  const policyVersions: Record<string, string> = {}

  for (const policy of policies) {
    policyVersions[policy.id] = sha256({
      summary: policy.summary,
      instructions: policy.instructions,
      ...(policy.guidance ? { guidance: policy.guidance } : {}),
      requirements: policy.requirements ?? [],
    })

    for (const requirement of policy.requirements ?? []) {
      if (!requirementApplies(requirement, requirement.registry_id, context)) {
        continue
      }

      validateRequirement(requirement, policy, catalog, seenIds, errors)

      const resolved = toResolvedRequirement(
        policy,
        requirement,
        catalog,
        context,
      )
      const key = `${policy.id}:${requirement.id}`

      if (resolved.resolved_target) {
        resolvedTargets[key] = resolved.resolved_target
      } else if (requirement.target === 'invocation.output.path') {
        unresolvedBindings.push(key)
      }

      if (resolved.kind === 'automation') {
        automation.push(resolved)
      } else {
        validation.push(resolved)
      }
    }
  }

  invariant(errors.length === 0, errors.join('; '), {
    code: 'REQUIREMENT_RESOLUTION_FAILED',
    details: { errors },
  })

  if (context.invocation?.output_path && unresolvedBindings.length > 0) {
    invariant(
      false,
      `unresolved requirement bindings: ${unresolvedBindings.join(', ')}`,
      {
        code: 'REQUIREMENT_RESOLUTION_FAILED',
        details: { unresolved_bindings: unresolvedBindings },
      },
    )
  }

  const sortByKey = (left: ResolvedRequirement, right: ResolvedRequirement) =>
    `${left.policy_id}:${left.requirement_id}`.localeCompare(
      `${right.policy_id}:${right.requirement_id}`,
    )

  automation.sort(sortByKey)
  validation.sort(sortByKey)

  const manifest: RequirementManifest = {
    schema_version: 1,
    automation_requirements: automation,
    validation_requirements: validation,
    policy_versions: policyVersions,
    registry_version: catalog.hash,
    registry_hash: sha256(catalog.hash),
    resolved_targets: resolvedTargets,
    unresolved_bindings: unresolvedBindings.sort(),
    manifest_hash: '',
  }

  manifest.manifest_hash = sha256(manifest)

  return manifest
}

export function validatePolicyRequirements(
  root: string,
  catalog: RegistryCatalog,
): string[] {
  const errors: string[] = []
  const policiesDir = path.join(root, 'governance', 'policies')
  const seenIds = new Set<string>()

  for (const name of readdirSync(policiesDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const policy = readJson(path.join(policiesDir, name)) as Policy

    for (const requirement of policy.requirements ?? []) {
      validateRequirement(requirement, policy, catalog, seenIds, errors)
    }
  }

  return errors
}

export function readInvocationRequirements(
  invocation: Record<string, unknown>,
): RequirementManifest | undefined {
  if (!isRecord(invocation.requirements)) {
    return undefined
  }

  return invocation.requirements as unknown as RequirementManifest
}
