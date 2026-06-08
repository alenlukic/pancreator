import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stringifyCompactJson } from "@pancreator/core";

import { createAutomation } from "./registry.js";
import { readRunRecords } from "./run-log.js";
import { aggregateTickExitCode, tickAutomations } from "./tick.js";

const validAgentRecord = {
  schemaVersion: 1,
  id: "hourly-coder",
  name: "Hourly coder",
  enabled: true,
  schedule: "0 * * * *",
  trigger: {
    kind: "agent" as const,
    persona: "coder",
    prompt: "Review open tasks.",
  },
  policy: {
    maxConcurrent: 1,
    timeoutMinutes: 60,
  },
};

const validPanRecord = {
  ...validAgentRecord,
  id: "pan-check",
  name: "Pan check",
  trigger: {
    kind: "pan" as const,
    subcommand: "check",
  },
};

describe("tick", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-tick-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("dispatches manual --id with trigger manual", async () => {
    await createAutomation(tempRoot, validAgentRecord);

    const outcomes = await tickAutomations(tempRoot, {
      automationId: "hourly-coder",
      manual: true,
      now: new Date("2026-06-08T12:00:00.000Z"),
      executors: {
        dispatchAgent: async () => ({
          ok: true,
          stdoutSummary: "agent ok",
          stderrSummary: "",
          taskId: "task-1",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
      },
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe("success");
    const records = await readRunRecords(tempRoot, "hourly-coder");
    expect(records.at(-1)?.trigger).toBe("manual");
    expect(records.at(-1)?.taskId).toBe("task-1");
    expect(aggregateTickExitCode(outcomes)).toBe(0);
  });

  it("skips dispatch when maxConcurrent is saturated", async () => {
    await createAutomation(tempRoot, validAgentRecord);
    await tickAutomations(tempRoot, {
      automationId: "hourly-coder",
      manual: true,
      now: new Date("2026-06-08T12:00:00.000Z"),
      executors: {
        dispatchAgent: async () => ({
          ok: true,
          stdoutSummary: "first",
          stderrSummary: "",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
      },
    });

    const lockDir = path.join(tempRoot, ".pan", "scheduler", "locks");
    fs.writeFileSync(
      path.join(lockDir, "hourly-coder.json"),
      stringifyCompactJson({ runIds: ["stale-run"] }),
      "utf8",
    );

    const outcomes = await tickAutomations(tempRoot, {
      automationId: "hourly-coder",
      manual: true,
      now: new Date("2026-06-08T12:05:00.000Z"),
      executors: {
        dispatchAgent: async () => ({
          ok: true,
          stdoutSummary: "should not run",
          stderrSummary: "",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
      },
    });

    expect(outcomes[0]?.status).toBe("skipped");
    const records = await readRunRecords(tempRoot, "hourly-coder");
    expect(records.at(-1)?.stderrSummary).toContain("maxConcurrent");
  });

  it("evaluates due enabled automations on scheduled tick", async () => {
    await createAutomation(tempRoot, validPanRecord);

    const outcomes = await tickAutomations(tempRoot, {
      now: new Date("2026-06-08T13:00:00.000Z"),
      executors: {
        dispatchAgent: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "pan ok",
          stderrSummary: "",
        }),
      },
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.automationId).toBe("pan-check");
    const records = await readRunRecords(tempRoot, "pan-check");
    expect(records.at(-1)?.trigger).toBe("scheduled");
  });
});
