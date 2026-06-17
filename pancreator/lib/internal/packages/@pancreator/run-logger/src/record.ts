import type { TaskId } from "@pancreator/core";

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

export type PancreatorOutcome =
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

export interface RunLogPancreatorExtension {
  task_id: TaskId;
  pipeline: string;
  stage_id: string;
  outcome: PancreatorOutcome;
  persona?: string;
  checkpoint_seq?: number;
  contract?: { id: string };
  tool_call?: { id: string; parent_turn_id?: string };
  intervention?: { lever: string };
  clock_skew?: boolean;
  token_usage_unavailable?: boolean;
}

/**
 * One JSONL run-log line object; matches `/lib/memory/handbook/run-log-schema.md` Section 3.
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
  pancreator: RunLogPancreatorExtension;
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
    typeof o.pancreator === "object" &&
    o.pancreator !== null &&
    typeof (o.pancreator as RunLogPancreatorExtension).task_id === "string" &&
    typeof (o.pancreator as RunLogPancreatorExtension).pipeline === "string" &&
    typeof (o.pancreator as RunLogPancreatorExtension).stage_id === "string" &&
    typeof (o.pancreator as RunLogPancreatorExtension).outcome === "string"
  );
}
