import { describe, expect, it } from "vitest";
import { asTaskId } from "@daedaline/core";
import { isRunLogRecord } from "./record.js";

describe("isRunLogRecord", () => {
  it("accepts a minimal valid record", () => {
    expect(
      isRunLogRecord({
        ts: "2026-01-01T00:00:00.000Z",
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        name: "n",
        kind: "span",
        status: { code: "OK" },
        attributes: {},
        resource: {},
        daedaline: {
          task_id: asTaskId("t"),
          pipeline: "p",
          stage_id: "s",
          outcome: "success",
        },
      })
    ).toBe(true);
  });

  it("rejects a record with a missing daedaline object", () => {
    expect(
      isRunLogRecord({
        ts: "2026-01-01T00:00:00.000Z",
        trace_id: "a",
        span_id: "b",
        name: "n",
        kind: "span",
        status: { code: "OK" },
        attributes: {},
        resource: {},
      })
    ).toBe(false);
  });
});
