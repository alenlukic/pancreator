/**
 * Validator resolution for a stage submission, and the harness-authoritative
 * validators the submission runs.
 */

import {
  inferTargetKind,
  isPassingResult,
  registryAppliesToStage,
  resolveRequirementTargetPath,
  runRequirement,
} from '../requirements/run.js'
import { loadRegistry } from '../requirements/registry.js'
import type {
  Invocation,
  StageOutcome,
  RequirementFailureRoute,
  ResolvedRequirement,
} from '../types.js'

const INLINE_SUBMIT_VALIDATORS = new Set([
  'INVOCATION-VALIDATE-001',
  'DELEGATION-VALIDATE-001',
  'INVOCATION-ATTEST-VALIDATE-001',
  'STAGE-OUTPUT-VALIDATE-002',
])

function outcomeFromFailureRoutes(
  routes: RequirementFailureRoute[],
): StageOutcome | null {
  if (routes.length === 0) {
    return null
  }

  if (
    routes.some((route) => route === 'blocked' || route === 'operator_decision')
  ) {
    return 'blocked'
  }

  return 'failure'
}

/** One harness-authoritative validator `pan submit` runs, with its target. */
export interface ResolvedSubmitValidator {
  requirement: ResolvedRequirement
  target_path: string
  /**
   * The selector a named `artifact:` target names when nothing supplied it.
   * The resolution once fell back to the stage output JSON, so a validator
   * written for the pull-request copy passed by judging a file it was never
   * pointed at. An unresolved selector now says so.
   */
  unresolved_target?: string
  /**
   * Whether the invocation owed a named artifact at all. An invocation that
   * declares named artifacts and omits this one is a defect. An invocation
   * that declares none never owed the artifact: PR-001 scopes the workflow
   * pull-request copy to a ship that produces operator artifacts.
   */
  named_artifacts_declared?: boolean
}

/**
 * Whether a target names an artifact by name rather than by index. An indexed
 * selector describes a position that may legitimately be empty; a named one
 * describes an artifact the invocation declared.
 */
function isNamedArtifactSelector(target: string): boolean {
  return (
    target.startsWith('artifact:') &&
    !/^\d+$/u.test(target.slice('artifact:'.length))
  )
}

/**
 * Resolve the harness-authoritative validators a submission runs for one
 * invocation. `pan submit` and `pan output validate` MUST resolve this same
 * set from the same requirements, so a mechanical defect surfaces before a
 * stage attempt is spent on it.
 */
export function resolveSubmitValidators(
  root: string,
  invocation: Invocation,
  submittedValue: Record<string, unknown>,
  catalog: ReturnType<typeof loadRegistry> = loadRegistry(root),
): ResolvedSubmitValidator[] {
  const resolved: ResolvedSubmitValidator[] = []

  if (!invocation.requirements) {
    return resolved
  }

  for (const requirement of invocation.requirements.validation_requirements) {
    if (INLINE_SUBMIT_VALIDATORS.has(requirement.registry_id)) {
      continue
    }

    if (
      requirement.target === 'repository' ||
      requirement.resolved_target === '.'
    ) {
      continue
    }

    if (requirement.executor === 'agent') {
      continue
    }

    if (
      requirement.phase !== 'pre_submit' &&
      requirement.phase !== 'submit' &&
      requirement.phase !== 'gate'
    ) {
      continue
    }

    const entry = catalog.entries.get(requirement.registry_id)

    if (!entry) {
      continue
    }

    if (requirement.registry_id.includes('ASSESSMENT')) {
      continue
    }

    if (
      !registryAppliesToStage(requirement.registry_id, invocation.stage.slug)
    ) {
      continue
    }

    const resolvedTarget = resolveRequirementTargetPath(
      requirement,
      invocation.output.path,
      {
        ...submittedValue,
        ...(invocation.output.artifact_targets
          ? { artifact_targets: invocation.output.artifact_targets }
          : {}),
      },
    )

    if (
      resolvedTarget === null &&
      isNamedArtifactSelector(requirement.target)
    ) {
      resolved.push({
        requirement,
        target_path: requirement.target,
        unresolved_target: requirement.target,
        named_artifacts_declared:
          Object.keys(invocation.output.artifact_targets ?? {}).length > 0,
      })
      continue
    }

    const targetPath = resolvedTarget ?? invocation.output.path
    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      continue
    }

    resolved.push({ requirement, target_path: targetPath })
  }

  return resolved
}

/**
 * Validators whose target a blocked result of the named stage never produces.
 */
const BLOCKED_OUTPUT_EXEMPT_VALIDATORS: Record<string, readonly string[]> = {
  ship: ['RELEASE-VALIDATE-001', 'PR-DESCRIPTION-VALIDATE-001'],
}

/**
 * Why this validator judges nothing on this submission, or null.
 *
 * A blocked stage reports a precondition it lacked, so the release packet and
 * the pull-request copy were never written. Failing every field of an
 * artifact the stage could not produce buries the one thing the operator
 * needs: the missing precondition and the command that supplies it.
 */
function blockedOutputExemption(
  stageSlug: string,
  submittedValue: Record<string, unknown>,
  registryId: string,
): string | null {
  if (submittedValue.result !== 'blocked') {
    return null
  }

  return BLOCKED_OUTPUT_EXEMPT_VALIDATORS[stageSlug]?.includes(registryId)
    ? `Stage '${stageSlug}' reported blocked, so it produced no target for ` +
        `${registryId} to judge.`
    : null
}

export function runHarnessAuthoritativeValidators(
  root: string,
  runId: string,
  invocation: Invocation,
  workspaceFingerprint: string,
  submittedValue: Record<string, unknown>,
  runState?: Record<string, unknown>,
): {
  errors: string[]
  blocking_errors: string[]
  validatorOutcome: StageOutcome | null
} {
  const errors: string[] = []
  const blockingErrors: string[] = []
  const failedRoutes: RequirementFailureRoute[] = []
  const catalog = loadRegistry(root)

  for (const {
    requirement,
    target_path: targetPath,
    unresolved_target: unresolvedTarget,
    named_artifacts_declared: namedArtifactsDeclared,
  } of resolveSubmitValidators(root, invocation, submittedValue, catalog)) {
    if (unresolvedTarget) {
      const message = namedArtifactsDeclared
        ? `harness validator ${requirement.registry_id} could not resolve ` +
          `target ${unresolvedTarget}: the invocation declares named ` +
          `artifacts and none carries that name.`
        : `harness validator ${requirement.registry_id} judged nothing: ` +
          `the invocation declares no named artifact, so ${unresolvedTarget} ` +
          `names no target this stage owed.`

      errors.push(message)

      if (namedArtifactsDeclared && requirement.enforcement !== 'advisory') {
        blockingErrors.push(message)
        failedRoutes.push(requirement.failure_route)
      }

      continue
    }

    const notApplicable = blockedOutputExemption(
      invocation.stage.slug,
      submittedValue,
      requirement.registry_id,
    )
    const result = runRequirement({
      root,
      runId,
      requirement,
      targetPath,
      executor: 'harness',
      workspaceFingerprint,
      invocation: invocation as unknown as Record<string, unknown>,
      runState,
      catalog,
      persist: true,
      ...(notApplicable ? { notApplicable } : {}),
    })

    if (!isPassingResult(result)) {
      const message =
        `harness validator ${requirement.registry_id} failed: ` +
        result.issues.map((issue) => issue.message).join('; ')

      errors.push(message)

      if (requirement.enforcement !== 'advisory') {
        blockingErrors.push(message)
        failedRoutes.push(requirement.failure_route)
      }
    }
  }

  return {
    errors,
    blocking_errors: blockingErrors,
    validatorOutcome: outcomeFromFailureRoutes(failedRoutes),
  }
}
