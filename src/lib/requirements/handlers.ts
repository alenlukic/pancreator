import path from 'node:path'

import { isRecord, readText } from '../io.js'
import {
  validateDelegationMarkdown,
  validateInvocationMarkdown,
} from '../validation.js'
import { loadRegistry, validateRegistry } from './registry.js'
import { auditDirectives } from '../governance/audit-directives.js'
import { validateProjectionDrift } from '../projection.js'
import type { HandlerInput, HandlerResult, ValidatorHandler } from './types.js'
import { validateAssessment } from '../validators/assessment.js'
import { validateTargetRepoPrimer } from '../validators/target-repo-primer.js'
import {
  operatorArtifactProfileForStage,
  type OperatorArtifactProfile,
} from '../operator-artifact-profiles.js'
import {
  validateOperatorArtifact,
  validateStageOutputStrict,
} from '../validators/operator-artifact.js'
import {
  validateDecompositionArtifact,
  validateImplementationClaims,
  validateIntakeOutput,
  validateInvestigationArtifact,
  validatePlanTrace,
  validateQaOutput,
  validateReleaseOutput,
  validateReviewOutput,
  validateSpotfixOutcome,
} from '../validators/stage-validators.js'

function passed(): HandlerResult {
  return { status: 'passed', issues: [] }
}

function registryValidate(input: HandlerInput): HandlerResult {
  const catalog = input.catalog ?? loadRegistry(input.root)
  const errors = validateRegistry(catalog, new Set(HANDLER_IDS))

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    issues: errors.map((message) => ({ code: 'registry.invalid', message })),
  }
}

function directiveAuditHandler(input: HandlerInput): HandlerResult {
  const result = auditDirectives(input.root)

  return {
    status: result.errors.length === 0 ? 'passed' : 'failed',
    issues: result.errors.map((message) => ({
      code: 'directive.unowned',
      message,
    })),
  }
}

function projectionValidateHandler(input: HandlerInput): HandlerResult {
  const result = validateProjectionDrift(input.root)

  return {
    status: result.errors.length === 0 ? 'passed' : 'failed',
    issues: result.errors.map((message) => ({
      code: 'projection.drift',
      message,
    })),
  }
}

function invocationValidateHandler(input: HandlerInput): HandlerResult {
  if (!input.invocation) {
    return {
      status: 'invalid',
      issues: [
        { code: 'invocation.missing', message: 'Invocation context required' },
      ],
    }
  }

  const markdown = readText(path.join(input.root, input.targetPath))
  const result = validateInvocationMarkdown(input.invocation as never, markdown)

  return {
    status: result.passed ? 'passed' : 'failed',
    issues: result.checks
      .filter((check) => !check.passed)
      .map((check) => ({ code: check.id, message: check.message })),
  }
}

function delegationValidateHandler(input: HandlerInput): HandlerResult {
  const canonicalPath = String(input.requirement.arguments.canonical ?? '')
  const canonical = readText(path.join(input.root, canonicalPath))
  const delegation = readText(path.join(input.root, input.targetPath))
  const result = validateDelegationMarkdown(canonical, delegation)

  return {
    status: result.passed ? 'passed' : 'failed',
    issues: result.checks
      .filter((check) => !check.passed)
      .map((check) => ({ code: check.id, message: check.message })),
  }
}

function profileForInvocation(
  invocation: Record<string, unknown> | undefined,
): OperatorArtifactProfile {
  const stage = isRecord(invocation?.stage) ? invocation.stage : null
  const slug = stage && typeof stage.slug === 'string' ? stage.slug : ''

  return operatorArtifactProfileForStage(slug)
}

function operatorArtifactHandler(input: HandlerInput): HandlerResult {
  return validateOperatorArtifact(input, profileForInvocation(input.invocation))
}

export const HANDLERS: Record<string, ValidatorHandler> = {
  'req-resolve': () => passed(),
  'registry-validate': registryValidate,
  'directive-audit': directiveAuditHandler,
  'stage-scaffold': () => passed(),
  'stage-output-validate': validateStageOutputStrict,
  'assessment-scaffold': () => passed(),
  'assessment-validate': validateAssessment,
  'operator-artifact-validate': operatorArtifactHandler,
  'intake-validate': validateIntakeOutput,
  'plan-trace-validate': validatePlanTrace,
  'implementation-claims-validate': validateImplementationClaims,
  'review-validate': validateReviewOutput,
  'qa-validate': validateQaOutput,
  'release-validate': validateReleaseOutput,
  'decomposition-validate': validateDecompositionArtifact,
  'target-repo-primer-validate': validateTargetRepoPrimer,
  'investigation-validate': validateInvestigationArtifact,
  'spotfix-validate': validateSpotfixOutcome,
  'spotfix-escalation-scaffold': () => passed(),
  'projection-validate': projectionValidateHandler,
  'invocation-validate': invocationValidateHandler,
  'delegation-validate': delegationValidateHandler,
}

export const HANDLER_IDS = new Set(Object.keys(HANDLERS))

export function getHandler(handlerId: string): ValidatorHandler | undefined {
  return HANDLERS[handlerId]
}
