/**
 * Stage-output validators. Each validator lives in `./stage/`; this module
 * re-exports them so the requirement handlers, repository validation, and the
 * tests keep one stable import path.
 */

export {
  undeclaredBlockingFieldIssues,
  validateSharedFieldContract,
} from './stage/field-contract.js'
export {
  VERIFY_REFUSALS,
  STAGE_VALIDATOR_REFUSALS,
  VALIDATOR_BLOCKING_FIELDS,
} from './stage/refusal-registry.js'
export { isSpotfixDiffExempt, attemptTestDelta } from './stage/evidence.js'
export type { TestDelta } from './stage/evidence.js'
export { validateTargetInstructionCoverage } from './stage/target-instructions.js'
export { validateImplementationClaims } from './stage/claims.js'
export { validateIntakeOutput } from './stage/intake.js'
export { validatePlanTrace } from './stage/plan-trace.js'
export { profileCommandInText, validateVerifyOutput } from './stage/verify.js'
export { validateReleaseOutput } from './stage/release.js'
export { validateDecompositionArtifact } from './stage/decomposition.js'
export { validateHarnessRepairIntake } from './stage/harness-repair.js'
export { validateInvestigationArtifact } from './stage/investigation.js'
export { validateSpotfixOutcome } from './stage/spotfix.js'
