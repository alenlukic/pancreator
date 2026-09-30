/**
 * Invocation context entry point. The implementation lives in `./context/`,
 * one module per concern; this module re-exports its public surface so the
 * engine, the renderer, and the tests keep one stable import path.
 */

export {
  DEFAULT_CONTEXT_REFERENCE_READ_TRIGGER,
  buildContextReference,
  contextReferenceStatus,
  inspectContextReference,
} from './context/references.js'
export type { ContextReferenceInspection } from './context/references.js'
export {
  gateEvidenceLabel,
  passedGateEvidence,
} from './context/gate-evidence.js'
export {
  remediationReturn,
  evaluateScopedReturn,
  scopedReturnForStage,
} from './context/remediation-return.js'
export type {
  ScopedReturnRouting,
  ScopedReturnFacts,
  ScopedReturnDecision,
} from './context/remediation-return.js'
export {
  operatorStageRepairContext,
  summarizePriorFailure,
} from './context/prior-failure.js'
export { buildInvocationInputs } from './context/inputs.js'
