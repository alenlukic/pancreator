/**
 * @packageDocumentation
 * JSONL run logging aligned with `/memory/handbook/run-log-schema.md` and OpenTelemetry GenAI.
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
  type RunLogTesseractExtension,
  type TesseractOutcome,
} from "./record.js";

export const TESSERACT_RUN_LOGGER_VERSION = "0.0.0" as const;
