import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CursorRunner } from "@pancreator/runner-cursor";

import { createAutomation } from "./registry.js";
import { readRunRecords } from "./run-log.js";
import { SCHEDULER_DRY_RUN_MESSAGE } from "./executors.js";
import { createSchedulerTickExecutors } from "./executors.js";
import { tickAutomations } from "./tick.js";

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

describe("scheduler executors", () => {
  let tempRoot = "";
  const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-scheduler-executors-"));
    const personasDir = path.join(tempRoot, "lib", "personas");
    fs.mkdirSync(personasDir, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, "lib/personas/coder.md"), path.join(personasDir, "coder.md"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("records dry-run skips when runner invocation is manual", async () => {
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    await createAutomation(tempRoot, validAgentRecord);
    const executors = await createSchedulerTickExecutors(tempRoot, { invocation: "manual" });

    const outcomes = await tickAutomations(tempRoot, {
      automationId: "hourly-coder",
      manual: true,
      executors,
    });

    expect(outcomes[0]?.status).toBe("skipped");
    const record = (await readRunRecords(tempRoot, "hourly-coder")).at(-1);
    expect(record?.executionMode).toBe("dry-run");
    expect(record?.stderrSummary).toBe(SCHEDULER_DRY_RUN_MESSAGE);
    expect(record?.stdoutSummary).toBe("Review open tasks.");
  });

  it("invokes the SDK when runner invocation is sdk", async () => {
    fs.writeFileSync(
      path.join(tempRoot, "pancreator.yaml"),
      "runner:\n  cursor:\n    invocation: sdk\n",
    );
    await createAutomation(tempRoot, validAgentRecord);

    const originalInvoke = CursorRunner.prototype.invoke;
    CursorRunner.prototype.invoke = async function invoke(input) {
      return {
        schemaVersion: "1",
        runner: "cursor",
        dryRun: false,
        invocation: "sdk",
        personaName: input.persona.name,
        requestId: "req-test",
        userMessage: input.message,
        resolved: {
          model: input.persona.model,
          routingDescription: input.persona.description,
          toolAllowlist: [...input.persona.tools],
          toolDenylist: [...input.persona.disallowedTools],
          maxTurns: input.persona.maxTurns,
          invocation: "sdk",
          ledger: input.ledger,
        },
        runLogFragment: {
          trace_id: "trace",
          span_id: "span",
          name: "cursor.runner.sdk",
          attributes: {},
        },
        sdkResult: {
          status: "ok",
          resultText: "archived 3 directories",
        },
      };
    };

    try {
      const executors = await createSchedulerTickExecutors(tempRoot);
      const outcomes = await tickAutomations(tempRoot, {
        automationId: "hourly-coder",
        manual: true,
        executors,
      });
      expect(outcomes[0]?.status).toBe("success");
      const record = (await readRunRecords(tempRoot, "hourly-coder")).at(-1);
      expect(record?.executionMode).toBe("live");
      expect(record?.stdoutSummary).toBe("archived 3 directories");
    } finally {
      CursorRunner.prototype.invoke = originalInvoke;
    }
  });
});
