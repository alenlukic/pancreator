import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stringifyCompactJson } from "@pancreator/core";
import { createAutomation } from "@pancreator/scheduler";

import { runSchedulerTick } from "./scheduler-tick.js";

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

describe("scheduler-tick", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-scheduler-tick-cli-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    const personasDir = path.join(tempRoot, "lib", "personas");
    fs.mkdirSync(personasDir, { recursive: true });
    fs.writeFileSync(path.join(personasDir, "coder.md"), "# coder\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("dispatches manual --id with injected executors", async () => {
    await createAutomation(tempRoot, validAgentRecord);

    const result = await runSchedulerTick({
      repoRoot: tempRoot,
      automationId: "hourly-coder",
      executors: {
        dispatchAgent: async () => ({
          ok: true,
          stdoutSummary: "manual ok",
          stderrSummary: "",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe("success");
  });

  it("returns non-zero exit code when dispatch fails", async () => {
    await createAutomation(tempRoot, validAgentRecord);

    const result = await runSchedulerTick({
      repoRoot: tempRoot,
      automationId: "hourly-coder",
      executors: {
        dispatchAgent: async () => ({
          ok: false,
          stdoutSummary: "",
          stderrSummary: "dispatch failed",
        }),
        dispatchPan: async () => ({
          ok: true,
          stdoutSummary: "",
          stderrSummary: "",
        }),
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcomes[0]?.status).toBe("error");
  });

  it("skips when maxConcurrent is saturated", async () => {
    await createAutomation(tempRoot, validAgentRecord);
    const lockDir = path.join(tempRoot, ".pan", "scheduler", "locks");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "hourly-coder.json"),
      stringifyCompactJson({ runIds: ["active-run"] }),
      "utf8",
    );

    const result = await runSchedulerTick({
      repoRoot: tempRoot,
      automationId: "hourly-coder",
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

    expect(result.outcomes[0]?.status).toBe("skipped");
    expect(result.exitCode).toBe(0);
  });
});
