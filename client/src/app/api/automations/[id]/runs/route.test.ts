import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/automations/[id]/runs/route";
import { appendRunRecord, createAutomation } from "@pancreator/scheduler";

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

describe("GET /api/automations/[id]/runs", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-runs-api-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    process.chdir(tempRoot);
  });

  afterEach(() => {
    const originalRoot = findOriginalRepoRoot();
    process.chdir(originalRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns run records newest-first", async () => {
    await createAutomation(tempRoot, validAgentRecord);
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

    const response = await GET(new Request("http://localhost/api/automations/hourly-coder/runs"), {
      params: Promise.resolve({ id: "hourly-coder" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { runs: { runId: string }[] };
    expect(payload.runs.map((run) => run.runId)).toEqual(["run-2", "run-1"]);
  });

  it("returns empty runs for automation without history", async () => {
    await createAutomation(tempRoot, validAgentRecord);

    const response = await GET(new Request("http://localhost/api/automations/hourly-coder/runs"), {
      params: Promise.resolve({ id: "hourly-coder" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { runs: unknown[] };
    expect(payload.runs).toEqual([]);
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
