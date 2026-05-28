import type { TaskId } from "@daedaline/core";

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

export type DaedalineOutcome =
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

export interface RunLogDaedalineExtension {
  task_id: TaskId;
  pipeline: string;
  stage_id: string;
  outcome: DaedalineOutcome;
  persona?: string;
  checkpoint_seq?: number;
  contract?: { id: string };
  tool_call?: { id: string; parent_turn_id?: string };
  intervention?: { lever: string };
  clock_skew?: boolean;
  token_usage_unavailable?: boolean;
}

/**
 * One JSONL run-log line object; matches `/src/memory/handbook/run-log-schema.md` Section 3.
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
  daedaline: RunLogDaedalineExtension;
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
    typeof o.daedaline === "object" &&
    o.daedaline !== null &&
    typeof (o.daedaline as RunLogDaedalineExtension).task_id === "string" &&
    typeof (o.daedaline as RunLogDaedalineExtension).pipeline === "string" &&
    typeof (o.daedaline as RunLogDaedalineExtension).stage_id === "string" &&
    typeof (o.daedaline as RunLogDaedalineExtension).outcome === "string"
  );
}
