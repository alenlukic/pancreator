import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEATURE_DELIVERY_SDK_HEARTBEAT_MS,
  createFeatureDeliverySdkProgressReporter,
  withFeatureDeliverySdkStageHeartbeat,
} from "./feature-delivery-sdk-progress.js";

describe("feature-delivery-sdk-progress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PAN_FD_PROGRESS;
  });

  it("emits ndjson progress on stderr when format is ndjson", async () => {
    const err: string[] = [];
    const reporter = createFeatureDeliverySdkProgressReporter({
      writeErr: (chunk) => err.push(chunk),
      format: "ndjson",
      now: () => new Date("2026-06-02T12:00:00.000Z"),
    });

    await withFeatureDeliverySdkStageHeartbeat(
      reporter,
      {
        taskId: "task-1",
        featureId: "feat-1",
        stageId: "plan",
        persona: "tech-lead",
        now: new Date("2026-06-02T12:00:00.000Z"),
      },
      async () => {
        await vi.advanceTimersByTimeAsync(FEATURE_DELIVERY_SDK_HEARTBEAT_MS);
        return "done";
      },
    );

    const lines = err.join("").trim().split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const parsed = lines.map((line) => JSON.parse(line) as { kind: string; event?: string });
    expect(parsed[0]).toMatchObject({ event: "feature_delivery_progress", kind: "stage_enter", stageId: "plan" });
    expect(parsed.some((row) => row.kind === "heartbeat")).toBe(true);
    expect(parsed.at(-1)).toMatchObject({ kind: "stage_complete", stageId: "plan" });
  });

  it("emits human-readable text when format is text", async () => {
    const err: string[] = [];
    const reporter = createFeatureDeliverySdkProgressReporter({
      writeErr: (chunk) => err.push(chunk),
      format: "text",
    });

    await withFeatureDeliverySdkStageHeartbeat(
      reporter,
      {
        taskId: "task-1",
        featureId: "feat-1",
        stageId: "intake",
        persona: "intake-analyst",
      },
      async () => "ok",
    );

    const joined = err.join("");
    expect(joined).toContain("[pan fd] task-1: entering intake (intake-analyst)");
    expect(joined).toContain("[pan fd] task-1: finished intake (intake-analyst)");
  });

  it("skips progress emission when reporter is undefined", async () => {
    await expect(
      withFeatureDeliverySdkStageHeartbeat(undefined, {
        taskId: "task-1",
        featureId: "feat-1",
        stageId: "plan",
      }, async () => "ok"),
    ).resolves.toBe("ok");
  });
});
