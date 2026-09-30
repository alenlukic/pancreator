/**
 * The module each refusal table is raised from, the `issue()` call sites no
 * stage-output validator owns, and the registry that binds each table to its
 * validator and stage.
 */

import type {
  GeneratedRefusalCodes,
  RefusalSource,
  StageRefusal,
  StageValidatorRefusals,
} from './shapes.js'
import {
  CLAIMS_REFUSALS,
  PLAN_REFUSALS,
  PR_DESCRIPTION_REFUSALS,
  RELEASE_REFUSALS,
  TARGET_INSTRUCTION_REFUSALS,
} from './delivery.js'
import {
  APPROACH_REFUSALS,
  BUILD_REFUSALS,
  EVALUATE_REFUSALS,
  PROTOTYPE_INTAKE_REFUSALS,
} from './prototype.js'

/** Stage-output validator modules, which `stage-validators.ts` re-exports. */
const STAGE_MODULE_DIRECTORY = 'src/lib/validators/stage'
const FIELD_CONTRACT_MODULE = `${STAGE_MODULE_DIRECTORY}/field-contract.ts`
const EVIDENCE_MODULE = `${STAGE_MODULE_DIRECTORY}/evidence.ts`
const TARGET_INSTRUCTIONS_MODULE = `${STAGE_MODULE_DIRECTORY}/target-instructions.ts`
const CLAIMS_MODULE = `${STAGE_MODULE_DIRECTORY}/claims.ts`
const INTAKE_MODULE = `${STAGE_MODULE_DIRECTORY}/intake.ts`
const PLAN_TRACE_MODULE = `${STAGE_MODULE_DIRECTORY}/plan-trace.ts`
const VERIFY_MODULE = `${STAGE_MODULE_DIRECTORY}/verify.ts`
const RELEASE_MODULE = `${STAGE_MODULE_DIRECTORY}/release.ts`
const RELEASE_OBSERVATIONS_MODULE = `${STAGE_MODULE_DIRECTORY}/release-observations.ts`
const DECOMPOSITION_MODULE = `${STAGE_MODULE_DIRECTORY}/decomposition.ts`
const HARNESS_REPAIR_MODULE = `${STAGE_MODULE_DIRECTORY}/harness-repair.ts`
const INVESTIGATION_MODULE = `${STAGE_MODULE_DIRECTORY}/investigation.ts`
const SPOTFIX_MODULE = `${STAGE_MODULE_DIRECTORY}/spotfix.ts`
const PROTOTYPE_MODULE = 'src/lib/validators/prototype-output.ts'
const PR_DESCRIPTION_MODULE = 'src/lib/validators/pr-description.ts'

/** Where the shared `gitUnavailableIssue` helper raises its refusal. */
const GIT_UNAVAILABLE_SOURCE: RefusalSource = {
  file: EVIDENCE_MODULE,
  functions: ['gitUnavailableIssue'],
}

/**
 * `issue()` call sites in the scanned modules that no stage-output validator
 * owns. Each states why, because an unexplained omission is how a whole
 * handler escapes the completeness proof.
 */
export const UNCOVERED_REFUSAL_SOURCES: readonly {
  file: string
  function: string
  reason: string
}[] = [
  {
    file: FIELD_CONTRACT_MODULE,
    function: 'undeclaredBlockingFieldIssues',
    reason:
      'Repository validation of the shared field contract, which refuses a contract document rather than a stage output.',
  },
  {
    file: FIELD_CONTRACT_MODULE,
    function: 'validateSharedFieldContract',
    reason:
      'Repository validation of the shared field contract, which refuses a contract document rather than a stage output.',
  },
  {
    file: INTAKE_MODULE,
    function: 'validateIntakeOutput',
    reason:
      'INTAKE-VALIDATE-001 refuses a product specification whose shape the planning stage definition declares in its own required_data, and the shared field contract carries no stage entry to hold those refusals against. Moving them under this proof needs an intake entry in that contract.',
  },
  {
    file: DECOMPOSITION_MODULE,
    function: 'validateDecompositionArtifact',
    reason:
      'The target is a decomposition Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: HARNESS_REPAIR_MODULE,
    function: 'validateHarnessRepairIntake',
    reason:
      'The target is a harness-repair intake Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: INVESTIGATION_MODULE,
    function: 'validateInvestigationArtifact',
    reason:
      'The target is an investigation Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: SPOTFIX_MODULE,
    function: 'validateSpotfixOutcome',
    reason:
      'A spotfix runs outside a workflow run, so it holds no stage contract and no shared field contract entry.',
  },
]

/**
 * Every stage-output validator that can refuse a submission, with the source
 * it raises its refusals from.
 *
 * The verify entry is supplied by the caller because that handler generates
 * its item refusals from the rule tables it iterates, and those tables live
 * in `stage/refusal-registry.ts`.
 */
export function stageValidatorRefusals(
  verifyRefusals: readonly StageRefusal[],
  verifyGenerated: readonly GeneratedRefusalCodes[],
): readonly StageValidatorRefusals[] {
  return [
    {
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      stage: 'plan',
      sources: [
        {
          file: PLAN_TRACE_MODULE,
          functions: [
            'validatePlanTrace',
            'criterionProducerIssues',
            'openQuestionDispositionIssues',
            'verificationRecommendationIssues',
          ],
        },
      ],
      refusals: PLAN_REFUSALS,
    },
    {
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      stage: 'implement',
      sources: [
        {
          file: CLAIMS_MODULE,
          functions: ['validateImplementationClaims', 'handoffIssues'],
        },
        GIT_UNAVAILABLE_SOURCE,
      ],
      refusals: CLAIMS_REFUSALS,
    },
    {
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      stage: 'remediate',
      sources: [
        {
          file: CLAIMS_MODULE,
          functions: ['validateImplementationClaims', 'handoffIssues'],
        },
        GIT_UNAVAILABLE_SOURCE,
      ],
      refusals: CLAIMS_REFUSALS,
    },
    {
      registry_id: 'VERIFY-VALIDATE-001',
      stage: 'verify',
      sources: [
        {
          file: VERIFY_MODULE,
          functions: ['validateVerifyOutput', 'checkVerifyItems'],
        },
      ],
      refusals: verifyRefusals,
      generated: verifyGenerated,
    },
    {
      registry_id: 'RELEASE-VALIDATE-001',
      stage: 'ship',
      sources: [
        { file: RELEASE_MODULE, functions: ['validateReleaseOutput'] },
        {
          file: RELEASE_OBSERVATIONS_MODULE,
          functions: ['releaseObservationIssues'],
        },
        GIT_UNAVAILABLE_SOURCE,
      ],
      refusals: RELEASE_REFUSALS,
    },
    {
      registry_id: 'PR-DESCRIPTION-VALIDATE-001',
      stage: 'ship',
      sources: [
        { file: PR_DESCRIPTION_MODULE, functions: ['validatePrDescription'] },
      ],
      refusals: PR_DESCRIPTION_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'prototype:intake',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateIntakeOutput'],
        },
      ],
      refusals: PROTOTYPE_INTAKE_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'approach',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: [
            'validatePrototypeOutput',
            'validateApproachOutput',
            'validatePreconditionEntry',
          ],
        },
      ],
      refusals: APPROACH_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'build',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateBuildOutput'],
        },
      ],
      refusals: BUILD_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'evaluate',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateEvaluateOutput'],
        },
      ],
      refusals: EVALUATE_REFUSALS,
    },
    {
      registry_id: 'TARGET-INSTRUCTION-COVERAGE-VALIDATE-001',
      stage: null,
      sources: [
        {
          file: TARGET_INSTRUCTIONS_MODULE,
          functions: ['validateTargetInstructionCoverage'],
        },
        GIT_UNAVAILABLE_SOURCE,
      ],
      refusals: TARGET_INSTRUCTION_REFUSALS,
    },
  ]
}
