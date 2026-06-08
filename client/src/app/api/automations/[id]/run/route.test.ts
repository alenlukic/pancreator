import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/automations/[id]/run/route";
import { createAutomation } from "@pancreator/scheduler";

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

describe("POST /api/automations/[id]/run", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-run-api-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    const personasDir = path.join(tempRoot, "lib", "personas");
    fs.mkdirSync(personasDir, { recursive: true });
    fs.writeFileSync(path.join(personasDir, "coder.md"), "# coder\n");
    process.chdir(tempRoot);
  });

  afterEach(() => {
    const originalRoot = findOriginalRepoRoot();
    process.chdir(originalRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("dispatches a manual run for an existing automation", async () => {
    await createAutomation(tempRoot, validAgentRecord);

    const response = await POST(new Request("http://localhost/api/automations/hourly-coder/run"), {
      params: Promise.resolve({ id: "hourly-coder" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { outcomes: { automationId: string }[] };
    expect(payload.outcomes[0]?.automationId).toBe("hourly-coder");
  });

  it("returns 404 for unknown automation", async () => {
    const response = await POST(new Request("http://localhost/api/automations/missing/run"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(response.status).toBe(404);
  });
});

function findOriginalRepoRoot(): string {
  let dir = path.resolve(__dirname, "../../../../../../..");
  while (true) {
    if (fs.existsSync(path.join(dir, "pancreator.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Repository root not found");
    }
    dir = parent;
  }
}
