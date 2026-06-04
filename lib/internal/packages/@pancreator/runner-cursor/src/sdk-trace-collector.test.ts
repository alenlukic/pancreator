import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertUsageCaptured,
  createEmptyMetrics,
  createProductionTraceSink,
  createTraceSink,
  processStreamEvent,
  redactTraceRecord,
} from "./sdk-trace-collector.js";

describe("sdk-trace-collector", () => {
  it("processStreamEvent accumulates turn-ended usage", () => {
    const metrics = createEmptyMetrics();
    const toolPaths: string[] = [];
    processStreamEvent(
      { type: "turn-ended", usage: { input_tokens: 10, output_tokens: 5 } },
      metrics,
      toolPaths,
    );
    expect(metrics.turn_count).toBe(1);
    expect(metrics.input_tokens).toBe(10);
    expect(metrics.output_tokens).toBe(5);
    assertUsageCaptured(metrics);
  });

  it("createTraceSink writes ndjson and summary", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sdk-trace-"));
    const sink = createTraceSink({
      traceDir: dir,
      combo: "task-low.composer-2.5",
      runIndex: 1,
      taskId: "task-low",
      model: "composer-2.5",
    });
    const metrics = createEmptyMetrics();
    processStreamEvent(
      { type: "turn-ended", usage: { input_tokens: 1, output_tokens: 2 } },
      metrics,
      [],
    );
    sink.finish(metrics, []);
    const summaryRaw = await readFile(sink.summaryPath, "utf8");
    const summary = JSON.parse(summaryRaw) as { task_id: string; turn_count: number };
    expect(summary.task_id).toBe("task-low");
    expect(summary.turn_count).toBe(1);
  });

  it("createProductionTraceSink uses stage-invoc naming", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sdk-prod-"));
    const sink = createProductionTraceSink({
      traceDir: dir,
      stageId: "implement",
      invocationIndex: 2,
      taskId: "53589_test",
      model: "composer-2.5",
    });
    expect(path.basename(sink.tracePath)).toMatch(/^implement-2-/u);
  });

  it("redactTraceRecord masks api key patterns", () => {
    const out = redactTraceRecord({
      args: "CURSOR_API_KEY=sk-secretvalue123456789012345",
    });
    expect(String(out.args)).toContain("[REDACTED]");
  });
});
