import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import {
  expectedDelegationSource,
  validateDelegationMarkdown,
  validateInvocationAttestation,
  validateInvocationMarkdown,
  validateQuestionToolAccess,
} from '../validation.js'
import { loadRegistry, validateRegistry } from './registry.js'
import { auditDirectives } from '../governance/audit-directives.js'
import { validateProjectionDrift } from '../projection.js'
import type { HandlerInput, HandlerResult, ValidatorHandler } from './types.js'
import { validateAssessment } from '../validators/assessment.js'
import { validateTargetRepoPrimer } from '../validators/target-repo-primer.js'
import { validateTargetLanguageHandbooks } from '../validators/target-language-handbooks.js'
import { validatePrDescription } from '../validators/pr-description.js'
import {
  operatorArtifactProfileForStage,
  type OperatorArtifactProfile,
} from '../operator-artifact-profiles.js'
import {
  validateOperatorArtifact,
  validateStageOutputStrict,
} from '../validators/operator-artifact.js'
import { validateSimplifiedEnglish } from '../validators/simplified-english.js'
import {
  validateDecompositionArtifact,
  validateHarnessRepairIntake,
  validateImplementationClaims,
  validateIntakeOutput,
  validateInvestigationArtifact,
  validatePlanTrace,
  validateQaOutput,
  validateReleaseOutput,
  validateReviewOutput,
  validateSharedFieldContract,
  validateSpotfixOutcome,
  validateTargetInstructionCoverage,
} from '../validators/stage-validators.js'
import {
  validateAwayDecisionLedger,
  validateHypervisorState,
} from '../validators/autonomy-state.js'

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
    issues: result.errors.map((message) => {
      let code = 'directive.unowned'

      if (message.includes('duplicate group')) {
        code = 'context.duplicate'
      } else if (message.includes('monkeypatch')) {
        code = 'context.monkeypatch'
      } else if (message.includes('disposition')) {
        code = 'context.disposition'
      }

      return { code, message }
    }),
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

function questionToolValidateHandler(input: HandlerInput): HandlerResult {
  const errors = validateQuestionToolAccess(input.root)

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    issues: errors.map((message) => ({
      code: 'question-tool.invalid',
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
  const invocation = input.invocation as {
    delegation?: { supervisor_procedure_path?: string }
  }
  const procedurePath = invocation.delegation?.supervisor_procedure_path
  const procedureAbsolute =
    typeof procedurePath === 'string'
      ? path.join(input.root, procedurePath)
      : null
  const procedure =
    procedureAbsolute && fileExists(procedureAbsolute)
      ? readText(procedureAbsolute)
      : undefined
  const result = validateInvocationMarkdown(
    input.invocation as never,
    markdown,
    procedure,
  )

  return {
    status: result.passed ? 'passed' : 'failed',
    issues: result.checks
      .filter((check) => !check.passed)
      .map((check) => ({ code: check.id, message: check.message })),
  }
}

function delegationValidateHandler(input: HandlerInput): HandlerResult {
  if (!input.invocation) {
    return {
      status: 'invalid',
      issues: [
        { code: 'invocation.missing', message: 'Invocation context required' },
      ],
    }
  }

  // Referenced delivery owes the compact prompt, verbatim delivery the whole
  // card, and a resumed external delegation the persisted revision directive.
  // `expectedDelegationSource` consults the invocation contract and, for
  // external executors, the harness-authored execution record.
  const source = expectedDelegationSource(input.root, input.invocation as never)
  const expected = readText(path.join(input.root, source.path))
  const delegation = readText(path.join(input.root, input.targetPath))
  const result = validateDelegationMarkdown(expected, delegation, source.mode)

  return {
    status: result.passed ? 'passed' : 'failed',
    issues: result.checks
      .filter((check) => !check.passed)
      .map((check) => ({ code: check.id, message: check.message })),
  }
}

function invocationAttestValidateHandler(input: HandlerInput): HandlerResult {
  if (!input.invocation) {
    return {
      status: 'invalid',
      issues: [
        { code: 'invocation.missing', message: 'Invocation context required' },
      ],
    }
  }

  const output = readJson(path.join(input.root, input.targetPath))
  const result = validateInvocationAttestation(
    input.invocation as never,
    output,
  )

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
  const workflow = isRecord(invocation?.workflow) ? invocation.workflow : null
  const workflowSlug =
    workflow && typeof workflow.slug === 'string' ? workflow.slug : undefined

  return operatorArtifactProfileForStage(slug, workflowSlug)
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
  'stage-field-contract-validate': validateSharedFieldContract,
  'assessment-scaffold': () => passed(),
  'assessment-validate': validateAssessment,
  'operator-artifact-validate': operatorArtifactHandler,
  'simplified-english-validate': validateSimplifiedEnglish,
  'intake-validate': validateIntakeOutput,
  'plan-trace-validate': validatePlanTrace,
  'implementation-claims-validate': validateImplementationClaims,
  'target-instruction-coverage-validate': validateTargetInstructionCoverage,
  'review-validate': validateReviewOutput,
  'qa-validate': validateQaOutput,
  'release-validate': validateReleaseOutput,
  'pr-description-validate': validatePrDescription,
  'decomposition-validate': validateDecompositionArtifact,
  'target-repo-primer-validate': validateTargetRepoPrimer,
  'target-language-handbook-validate': validateTargetLanguageHandbooks,
  'harness-repair-validate': validateHarnessRepairIntake,
  'investigation-validate': validateInvestigationArtifact,
  'spotfix-validate': validateSpotfixOutcome,
  'spotfix-escalation-scaffold': () => passed(),
  'hypervisor-state-validate': validateHypervisorState,
  'away-decision-ledger-validate': validateAwayDecisionLedger,
  'projection-validate': projectionValidateHandler,
  'question-tool-validate': questionToolValidateHandler,
  'invocation-validate': invocationValidateHandler,
  'delegation-validate': delegationValidateHandler,
  'invocation-attest-validate': invocationAttestValidateHandler,
}

export const HANDLER_IDS = new Set(Object.keys(HANDLERS))

export function getHandler(handlerId: string): ValidatorHandler | undefined {
  return HANDLERS[handlerId]
}
