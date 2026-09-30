/**
 * Cursor token spend: usage events correlated with local transcripts and
 * workflow records, aggregated into the token spend report.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `token-spend/`; new source importers should import the specific module.
 */

export {
  collectSpendRecords,
  aggregateSpendRecords,
  generateTokenSpendReport,
} from './token-spend/report.js'
export {
  cursorProjectDirectory,
  transcriptBrief,
  attributionRoots,
  readTranscripts,
} from './token-spend/transcripts.js'
export { resolveTranscriptWorkflow } from './token-spend/attribution.js'
export { spendEventKey, conversationKeyFromId } from './token-spend/model.js'
export type {
  SpendMetrics,
  SpendSliceRow,
  ToolSpendSliceRow,
  SpendCoverage,
  DailySpendPoint,
  TokenSpendReport,
  GenerateTokenSpendReportOptions,
  SpendRecord,
  CollectSpendRecordsOptions,
  CollectSpendRecordsResult,
  AggregateSpendRecordsResult,
  WorkerBrief,
  TranscriptEvidence,
  AttributionRoot,
  WorkflowIdentity,
  RunEvidence,
  RunStorage,
  WorkflowEvidence,
  EventAttribution,
} from './token-spend/model.js'
