import { describe, expect, it } from "vitest";
import {
  CRON_PRESETS,
  defaultAgentAutomationDraft,
  deriveAutomationId,
  filterAutomationSummaries,
  formatNextRunLabel,
  formatScheduleLabel,
  humanScheduleLabel,
  isValidCronExpression,
  nextCronFireAfter,
  previewNextRunLabel,
} from "@/services/automations-client";

describe("automations-client", () => {
  it("exposes cron presets including hourly", () => {
    expect(CRON_PRESETS.map((preset) => preset.id)).toEqual([
      "hourly",
      "daily",
      "weekly",
      "custom",
    ]);
    expect(CRON_PRESETS[0]?.cron).toBe("0 * * * *");
  });

  it("validates 5-field cron expressions", () => {
    expect(isValidCronExpression("0 * * * *")).toBe(true);
    expect(isValidCronExpression("every hour")).toBe(false);
    expect(isValidCronExpression("0 * * *")).toBe(false);
  });

  it("formats known schedule labels", () => {
    expect(formatScheduleLabel("0 * * * *")).toBe("Hourly");
    expect(formatScheduleLabel("0 0 * * *")).toBe("Daily at midnight");
    expect(formatScheduleLabel("15 4 * * 2")).toBe("15 4 * * 2");
    expect(humanScheduleLabel("0 0 * * 1")).toBe("Weekly on Monday");
  });

  it("derives automation ids from names", () => {
    expect(deriveAutomationId("Hourly Review")).toBe("hourly-review");
    expect(deriveAutomationId("  ---  ")).toBe("");
  });

  it("builds a default agent automation draft", () => {
    const draft = defaultAgentAutomationDraft("Hourly review");
    expect(draft).toMatchObject({
      schemaVersion: 1,
      id: "hourly-review",
      name: "Hourly review",
      enabled: true,
      schedule: "0 * * * *",
      trigger: { kind: "agent", persona: "", prompt: "" },
      policy: { maxConcurrent: 1, timeoutMinutes: 60 },
    });
  });

  it("computes the next cron fire after a reference time", () => {
    const after = new Date("2026-06-09T10:15:00.000Z");
    const next = nextCronFireAfter("0 * * * *", after);
    expect(next?.toISOString()).toBe("2026-06-09T11:00:00.000Z");
  });

  it("formats preview and next-run labels for hourly schedules", () => {
    const nowMs = Date.parse("2026-06-09T10:15:00.000Z");
    expect(formatNextRunLabel("0 * * * *", nowMs)).toBe("in 45m");
    expect(previewNextRunLabel("0 * * * *", nowMs)).toBe("in 45m");
  });

  it("filters automations by search and paused status", () => {
    const automations = [
      {
        id: "a",
        name: "Alpha",
        enabled: false,
        schedule: "0 * * * *",
        scheduleLabel: "Hourly",
        status: "paused" as const,
        triggerKind: "agent" as const,
        persona: "coder",
      },
      {
        id: "b",
        name: "Beta",
        enabled: true,
        schedule: "0 0 * * *",
        scheduleLabel: "Daily at midnight",
        status: "scheduled" as const,
        triggerKind: "agent" as const,
      },
    ];
    const filtered = filterAutomationSummaries(automations, "alpha", "paused", {});
    expect(filtered.map((item) => item.id)).toEqual(["a"]);
  });
});

