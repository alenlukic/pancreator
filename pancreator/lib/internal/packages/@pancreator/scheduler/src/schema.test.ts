import { describe, expect, it } from "vitest";

import { AutomationValidationError } from "./errors.js";
import {
  formatScheduleLabel,
  isValidCronExpression,
  toAutomationSummary,
  validateAutomationDocument,
} from "./schema.js";

const validAgentRecord = {
  schemaVersion: 1,
  id: "hourly-coder",
  name: "Hourly coder",
  enabled: true,
  schedule: "0 * * * *",
  trigger: {
    kind: "agent",
    persona: "coder",
    prompt: "Review open tasks.",
  },
  policy: {
    maxConcurrent: 1,
    timeoutMinutes: 60,
  },
};

describe("schema", () => {
  it("accepts a valid agent automation", () => {
    const record = validateAutomationDocument(validAgentRecord);
    expect(record.id).toBe("hourly-coder");
  });

  it("rejects invalid cron expressions", () => {
    expect(() =>
      validateAutomationDocument({
        ...validAgentRecord,
        schedule: "every hour",
      }),
    ).toThrow(AutomationValidationError);
  });

  it("rejects missing agent persona", () => {
    expect(() =>
      validateAutomationDocument({
        ...validAgentRecord,
        trigger: { kind: "agent", persona: "", prompt: "x" },
      }),
    ).toThrow(AutomationValidationError);
  });

  it("accepts pan trigger documents", () => {
    const record = validateAutomationDocument({
      ...validAgentRecord,
      trigger: { kind: "pan", subcommand: "advance task-id" },
    });
    expect(record.trigger.kind).toBe("pan");
  });

  it("maps summaries with schedule labels and status", () => {
    const summary = toAutomationSummary(validateAutomationDocument(validAgentRecord));
    expect(summary).toMatchObject({
      scheduleLabel: "Hourly",
      status: "scheduled",
      persona: "coder",
    });
  });

  it("formats known cron presets", () => {
    expect(formatScheduleLabel("0 0 * * *")).toBe("Daily at midnight");
    expect(isValidCronExpression("0 * * * *")).toBe(true);
    expect(isValidCronExpression("bad cron")).toBe(false);
  });
});
