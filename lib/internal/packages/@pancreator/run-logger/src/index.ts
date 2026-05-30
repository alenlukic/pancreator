/**
 * @packageDocumentation
 * JSONL run logging aligned with `/lib/memory/handbook/run-log-schema.md` and OpenTelemetry GenAI.
 */

export { appendRunLogRecord, type RunLogAppendResult } from "./append.js";
export { rfc3339UtcMs, newSpanId, newTraceId } from "./ids.js";
export {
  isRunLogRecord,
  type OpenInferenceSpanKind,
  type RunLogRecord,
  type RunLogRecordKind,
  type RunLogStatus,
  type RunLogStatusCode,
  type RunLogPancreatorExtension,
  type PancreatorOutcome,
} from "./record.js";

export const PANCREATOR_RUN_LOGGER_VERSION = "0.0.0" as const;
