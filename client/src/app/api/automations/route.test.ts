import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST, PUT } from "@/app/api/automations/route";
import { stringifyCompactJson } from "@/lib/json-io";

const validAgentRecord = {
  schemaVersion: 1 as const,
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

describe("/api/automations", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-automations-api-"));
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

  it("creates, lists, updates, and deletes automations", async () => {
    const createResponse = await POST(
      new Request("http://localhost/api/automations", {
        method: "POST",
        body: stringifyCompactJson(validAgentRecord),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string };
    expect(created.id).toBe("hourly-coder");

    const listResponse = await GET(new Request("http://localhost/api/automations"));
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      automations: { id: string }[];
      personas: string[];
    };
    expect(listed.automations).toHaveLength(1);
    expect(Array.isArray(listed.personas)).toBe(true);

    const updateResponse = await PUT(
      new Request("http://localhost/api/automations", {
        method: "PUT",
        body: stringifyCompactJson({ ...validAgentRecord, enabled: false }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as { enabled: boolean };
    expect(updated.enabled).toBe(false);

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/automations?id=hourly-coder", { method: "DELETE" }),
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await GET(new Request("http://localhost/api/automations"));
    const empty = (await afterDelete.json()) as { automations: unknown[] };
    expect(empty.automations).toHaveLength(0);
  });

  it("returns validation errors for invalid payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/automations", {
        method: "POST",
        body: stringifyCompactJson({
          ...validAgentRecord,
          schedule: "not-a-cron",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { errors: string[] };
    expect(payload.errors.some((message) => message.includes("schedule"))).toBe(true);
  });

  it("rejects unsafe delete ids", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/automations?id=../escape", { method: "DELETE" }),
    );
    expect(response.status).toBe(400);
  });
});

function findOriginalRepoRoot(): string {
  let dir = path.resolve(__dirname, "../../../../..");
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
