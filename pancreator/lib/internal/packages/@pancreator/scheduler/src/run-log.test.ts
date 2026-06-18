import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SchedulerPathError } from "./errors.js";
import { assertPathInScheduler } from "./paths.js";
import { acquireLock } from "./lock.js";
import {
  abortRunByTaskId,
  abortSchedulerRunByTaskId,
  appendRunRecord,
  readRunRecords,
  readRunRecordsNewestFirst,
} from "./run-log.js";

describe("run-log", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-run-log-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("materializes .pan/scheduler/runs on first append", async () => {
    await appendRunRecord(tempRoot, "hourly-coder", {
      runId: "run-1",
      startedAt: "2026-06-08T10:00:00.000Z",
      finishedAt: "2026-06-08T10:01:00.000Z",
      status: "success",
      trigger: "manual",
      stdoutSummary: "ok",
      stderrSummary: "",
    });

    const runsDir = path.join(tempRoot, ".pan", "scheduler", "runs");
    expect(fs.existsSync(runsDir)).toBe(true);
    expect(fs.existsSync(path.join(runsDir, ".gitkeep"))).toBe(true);
    expect(fs.existsSync(path.join(runsDir, "hourly-coder.jsonl"))).toBe(true);
  });

  it("reads records newest-first", async () => {
    await appendRunRecord(tempRoot, "hourly-coder", {
      runId: "run-1",
      startedAt: "2026-06-08T10:00:00.000Z",
      status: "success",
      trigger: "scheduled",
      stdoutSummary: "first",
      stderrSummary: "",
    });
    await appendRunRecord(tempRoot, "hourly-coder", {
      runId: "run-2",
      startedAt: "2026-06-08T11:00:00.000Z",
      status: "error",
      trigger: "manual",
      stdoutSummary: "second",
      stderrSummary: "failed",
    });

    const chronological = await readRunRecords(tempRoot, "hourly-coder");
    expect(chronological.map((record) => record.runId)).toEqual(["run-1", "run-2"]);

    const newestFirst = await readRunRecordsNewestFirst(tempRoot, "hourly-coder");
    expect(newestFirst.map((record) => record.runId)).toEqual(["run-2", "run-1"]);
  });

  it("rejects run-log paths outside .pan/scheduler", () => {
    expect(() =>
      assertPathInScheduler(tempRoot, path.join(tempRoot, ".pan", "automations", "x.jsonl")),
    ).toThrow(SchedulerPathError);
  });

  it("aborts a running record by taskId and releases the lock", async () => {
    await acquireLock(tempRoot, "hourly-coder", "run-abort", 1);
    await appendRunRecord(tempRoot, "hourly-coder", {
      runId: "run-abort",
      startedAt: "2026-06-08T10:00:00.000Z",
      status: "running",
      trigger: "manual",
      stdoutSummary: "",
      stderrSummary: "",
      taskId: "hourly-coder-task-1",
    });

    const updated = await abortRunByTaskId(
      tempRoot,
      "hourly-coder",
      "hourly-coder-task-1",
      "2026-06-08T10:05:00.000Z",
    );
    expect(updated?.status).toBe("aborted");
    expect(updated?.finishedAt).toBe("2026-06-08T10:05:00.000Z");

    const lockDir = path.join(tempRoot, ".pan", "scheduler", "locks", "hourly-coder.json");
    const lockState = JSON.parse(fs.readFileSync(lockDir, "utf8")) as { runIds: string[] };
    expect(lockState.runIds).toEqual([]);
  });

  it("scans all run logs when aborting by taskId globally", async () => {
    await appendRunRecord(tempRoot, "pan-check", {
      runId: "run-global",
      startedAt: "2026-06-08T10:00:00.000Z",
      status: "running",
      trigger: "scheduled",
      stdoutSummary: "",
      stderrSummary: "",
      taskId: "pan-check-task-9",
    });

    const updated = await abortSchedulerRunByTaskId(
      tempRoot,
      "pan-check-task-9",
      "2026-06-08T10:05:00.000Z",
    );
    expect(updated?.runId).toBe("run-global");
    expect(updated?.status).toBe("aborted");
  });
});
