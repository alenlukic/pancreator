import type { TaskId } from "@tesseract/core";

/** OpenInference span kind values aligned with the run-log schema handbook. */
export type OpenInferenceSpanKind =
  | "LLM"
  | "AGENT"
  | "TOOL"
  | "RETRIEVER"
  | "RERANKER"
  | "EMBEDDING"
  | "GUARDRAIL"
  | "EVALUATOR"
  | "CHAIN"
  | "PROMPT";

export type RunLogStatusCode = "OK" | "ERROR" | "CANCELLED";

export type TesseractOutcome =
  | "success"
  | "failure"
  | "aborted"
  | "quarantined"
  | "rolled_back"
  | "skipped";

export type RunLogRecordKind = "span" | "event";

export interface RunLogStatus {
  code: RunLogStatusCode;
  message?: string;
}

export interface RunLogTesseractExtension {
  task_id: TaskId;
  pipeline: string;
  stage_id: string;
  outcome: TesseractOutcome;
  persona?: string;
  checkpoint_seq?: number;
  contract?: { id: string };
  tool_call?: { id: string; parent_turn_id?: string };
  intervention?: { lever: string };
  clock_skew?: boolean;
  token_usage_unavailable?: boolean;
}

/**
 * One JSONL run-log line object; matches `/memory/handbook/run-log-schema.md` Section 3.
 */
export interface RunLogRecord {
  ts: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  kind: RunLogRecordKind;
  status: RunLogStatus;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
  tesseract: RunLogTesseractExtension;
}

export function isRunLogRecord(value: unknown): value is RunLogRecord {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.ts === "string" &&
    typeof o.trace_id === "string" &&
    typeof o.span_id === "string" &&
    typeof o.name === "string" &&
    (o.kind === "span" || o.kind === "event") &&
    typeof o.status === "object" &&
    o.status !== null &&
    typeof (o.status as RunLogStatus).code === "string" &&
    typeof o.attributes === "object" &&
    o.attributes !== null &&
    typeof o.resource === "object" &&
    o.resource !== null &&
    typeof o.tesseract === "object" &&
    o.tesseract !== null &&
    typeof (o.tesseract as RunLogTesseractExtension).task_id === "string" &&
    typeof (o.tesseract as RunLogTesseractExtension).pipeline === "string" &&
    typeof (o.tesseract as RunLogTesseractExtension).stage_id === "string" &&
    typeof (o.tesseract as RunLogTesseractExtension).outcome === "string"
  );
}
