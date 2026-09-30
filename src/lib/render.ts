/**
 * Card rendering entry point. The implementation lives in `./render/`, one
 * module per concern; this module re-exports its public surface so the CLI,
 * the engine, the watch evidence, and the tests keep one stable import path.
 */

export {
  splitInvocationContract,
  buildInvocationContractManifest,
} from './render/contract.js'
export type { InvocationContractBlock } from './render/contract.js'
export {
  EVIDENCE_REPORT_CASE_PREFIX,
  EVIDENCE_REPORT_COMPLETE_MARKER,
  readEvidenceReportState,
  evidenceWorkerAttempts,
  orderedWorkerActions,
  renderInvocationDeliveryPrompt,
} from './render/delivery-prompt.js'
export type {
  InvocationWorkerAction,
  EvidenceReportState,
} from './render/delivery-prompt.js'
export { renderSupervisorProcedureMarkdown } from './render/supervisor-procedure.js'
export { renderEvidenceWorkerBrief } from './render/evidence-worker-brief.js'
export {
  invocationPolicyPointers,
  renderInvocationMarkdown,
} from './render/invocation-markdown.js'
export { renderStatus } from './render/status.js'
