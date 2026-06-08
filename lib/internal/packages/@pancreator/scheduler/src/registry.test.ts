import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutomationValidationError } from "./errors.js";
import {
  createAutomation,
  deleteAutomation,
  ensureAutomationsDir,
  listAutomations,
  listDueAutomations,
  updateAutomation,
} from "./registry.js";

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

describe("registry", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-scheduler-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("materializes .pan/automations on first access", async () => {
    const dir = await ensureAutomationsDir(tempRoot);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, ".gitkeep"))).toBe(true);
  });

  it("creates, lists, updates, and deletes automations", async () => {
    const created = await createAutomation(tempRoot, validAgentRecord);
    expect(created.id).toBe("hourly-coder");

    const listed = await listAutomations(tempRoot);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.scheduleLabel).toBe("Hourly");

    const updated = await updateAutomation(tempRoot, {
      ...validAgentRecord,
      enabled: false,
    });
    expect(updated.enabled).toBe(false);

    await deleteAutomation(tempRoot, "hourly-coder");
    expect(await listAutomations(tempRoot)).toHaveLength(0);
  });

  it("excludes disabled records from due evaluation", async () => {
    await createAutomation(tempRoot, validAgentRecord);
    await createAutomation(tempRoot, {
      ...validAgentRecord,
      id: "paused-coder",
      name: "Paused coder",
      enabled: false,
    });

    const due = await listDueAutomations(tempRoot);
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe("hourly-coder");
  });

  it("rejects duplicate create ids", async () => {
    await createAutomation(tempRoot, validAgentRecord);
    await expect(createAutomation(tempRoot, validAgentRecord)).rejects.toThrow(
      AutomationValidationError,
    );
  });

  it("rejects path traversal ids", async () => {
    await expect(
      createAutomation(tempRoot, {
        ...validAgentRecord,
        id: "../escape",
      }),
    ).rejects.toThrow();
  });
});
