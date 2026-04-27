import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asTaskId } from "@tesseract/core";
import { appendRunLogRecord } from "./append.js";
import { newSpanId, newTraceId, rfc3339UtcMs } from "./ids.js";
import { isRunLogRecord, type RunLogRecord } from "./record.js";

let dir: string;
beforeEach(() => {
  dir = join(tmpdir(), `run-logger-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRecord(): RunLogRecord {
  return {
    ts: rfc3339UtcMs(),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: "test.op",
    kind: "span",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": "test",
      "gen_ai.provider.name": "test",
      "gen_ai.request.model": "test",
    },
    resource: { "service.name": "tesseract", "service.version": "0.0.0" },
    tesseract: {
      task_id: asTaskId("task-1"),
      pipeline: "p",
      stage_id: "s",
      outcome: "success",
    },
  };
}

describe("appendRunLogRecord", () => {
  it("creates a file, appends one JSONL line, and returns byte offset 0 for first line", async () => {
    const p = join(dir, "run.log.jsonl");
    const r = sampleRecord();
    const out = await appendRunLogRecord(p, r);
    expect(out.run_log_offset).toBe(0);
    const text = await readFile(p, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as unknown;
    expect(isRunLogRecord(parsed)).toBe(true);
  });

  it("returns a non-zero offset for the second line", async () => {
    const p = join(dir, "run.log.jsonl");
    const a = await appendRunLogRecord(p, sampleRecord());
    const b = await appendRunLogRecord(p, sampleRecord());
    expect(a.run_log_offset).toBe(0);
    expect(b.run_log_offset).toBeGreaterThan(0);
    const text = await readFile(p, "utf8");
    expect(text.split("\n").filter(Boolean).length).toBe(2);
  });
});
