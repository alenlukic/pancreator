/**
 * Workflow validation entry point. The implementation lives in
 * `./validation/`, one module per concern; this module re-exports its public
 * surface so the CLI, the engine, the requirement handlers, and the tests keep
 * one stable import path.
 */

export {
  POLICIES_HEADING,
  PRIOR_FAILURE_HEADING,
  DELEGATION_HEADING,
  AGENT_REQUIREMENTS_HEADING,
  HARNESS_REQUIREMENTS_HEADING,
  normalizeMarkdownContent,
  invocationValidationPath,
  delegationPath,
  deliveryPromptPath,
  relocateMisplacedDelegationArtifact,
  delegationValidationPath,
  delegationExecutionPath,
  sessionRecordPath,
  loadDelegationExecutionRecord,
  expectedDelegationSource,
  attestationValidationPath,
  buildValidationArtifact,
} from './validation/artifacts.js'
export type {
  ValidationCheck,
  ValidationResultArtifact,
  ValidationArtifactLoad,
  InvocationValidationStatus,
} from './validation/artifacts.js'
export {
  validateInvocationMarkdown,
  validateDelegationMarkdown,
} from './validation/invocation-markdown.js'
export {
  attestationModelMatches,
  normalizeContractMarkdown,
  validateInvocationAttestation,
  loadValidationArtifact,
  loadInvocationValidationStatus,
} from './validation/attestation.js'
export { validateStageOutput } from './validation/stage-output.js'
export type {
  StageOutputValidation,
  StageOutputIssue,
  StageOutputValidationOptions,
} from './validation/stage-output.js'
export {
  resolveShellCheck,
  repositoryCheckBaselinesCaptured,
  absoluteJudgingDisclosure,
  loadRepositoryCheckBaseline,
  isEnvironmentBlockedDelta,
} from './validation/baselines.js'
export type { RepositoryCheckBaselineLoad } from './validation/baselines.js'
export { classifyGateTestFailures } from './validation/shell-check.js'
export {
  FINGERPRINT_BOUND_STATE_CRITERIA,
  evaluateStateCriterion,
  shipHeadMatchesRelease,
  runEntryGateCriterion,
} from './validation/state-criteria.js'
export { evaluateDeterministicCriteria } from './validation/deterministic-criteria.js'
export {
  validateHarnessInstructionCoverage,
  validateQuestionToolAccess,
  validateAwaitShellBan,
  validateShellMonitor,
} from './validation/governance.js'
export {
  validateRepository,
  validateSupervisorDelegationGuidance,
} from './validation/repository.js'
