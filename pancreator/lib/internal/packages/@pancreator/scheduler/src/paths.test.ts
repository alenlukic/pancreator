import { describe, expect, it } from "vitest";

import { InvalidAutomationIdError, SchedulerPathError } from "./errors.js";
import {
  assertPathInScheduler,
  assertSafeAutomationId,
  automationFilePath,
  defaultAutomationsDir,
  defaultRunsDir,
  runLogFilePath,
} from "./paths.js";

describe("paths", () => {
  it("defaultAutomationsDir nests under .pan/automations", () => {
    expect(defaultAutomationsDir("/repo")).toMatch(/\.pan[/\\]automations$/u);
  });

  it("automationFilePath joins yaml file", () => {
    const filePath = automationFilePath("/repo", "hourly-coder");
    expect(filePath).toContain("hourly-coder.yaml");
  });

  it("assertSafeAutomationId rejects traversal", () => {
    expect(() => assertSafeAutomationId("../x")).toThrow(InvalidAutomationIdError);
    expect(() => assertSafeAutomationId("a/b")).toThrow(InvalidAutomationIdError);
  });

  it("runLogFilePath nests under .pan/scheduler/runs", () => {
    expect(defaultRunsDir("/repo")).toMatch(/\.pan[/\\]scheduler[/\\]runs$/u);
    expect(runLogFilePath("/repo", "hourly-coder")).toContain("hourly-coder.jsonl");
  });

  it("assertPathInScheduler rejects escape", () => {
    expect(() => assertPathInScheduler("/repo", "/repo/.pan/automations/x.jsonl")).toThrow(
      SchedulerPathError,
    );
  });
});
