import { describe, expect, it } from "vitest";

import { cronMatches, isAutomationDue } from "./due.js";
import type { RunRecord } from "./run-log.js";

describe("due", () => {
  it("matches hourly cron at minute zero", () => {
    const date = new Date("2026-06-08T11:00:00.000Z");
    expect(cronMatches(date, "0 * * * *")).toBe(true);
    expect(cronMatches(new Date("2026-06-08T11:30:00.000Z"), "0 * * * *")).toBe(false);
  });

  it("is due when a cron slot passed since the last run", () => {
    const records: RunRecord[] = [
      {
        runId: "run-1",
        startedAt: "2026-06-08T10:00:00.000Z",
        status: "success",
        trigger: "scheduled",
        stdoutSummary: "",
        stderrSummary: "",
      },
    ];
    const now = new Date("2026-06-08T11:05:00.000Z");
    expect(isAutomationDue("0 * * * *", records, now)).toBe(true);
  });

  it("is not due before the next cron slot", () => {
    const records: RunRecord[] = [
      {
        runId: "run-1",
        startedAt: "2026-06-08T11:00:00.000Z",
        status: "success",
        trigger: "scheduled",
        stdoutSummary: "",
        stderrSummary: "",
      },
    ];
    const now = new Date("2026-06-08T11:30:00.000Z");
    expect(isAutomationDue("0 * * * *", records, now)).toBe(false);
  });
});
