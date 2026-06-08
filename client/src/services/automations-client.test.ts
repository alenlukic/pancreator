import { describe, expect, it } from "vitest";
import {
  CRON_PRESETS,
  defaultAgentAutomationDraft,
  deriveAutomationId,
  formatScheduleLabel,
  humanScheduleLabel,
  isValidCronExpression,
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
});
