import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { POST } from "@/app/api/execute/route";
import {
  executePanCommand,
  normalizePanCommand,
  validatePanCommand,
  type PanExecuteResult,
} from "@/services/pan-execute";

describe("POST /api/execute", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-execute-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rejects commands outside the allowlist with HTTP 400", async () => {
    const rejection = validatePanCommand("run feature-delivery demo.md");
    expect(rejection).toMatchObject({
      verb: "run",
    });

    const request = new Request("http://localhost/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({ command: "run feature-delivery demo.md" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; verb: string };
    expect(payload.verb).toBe("run");
    expect(payload.error).toContain("allowlisted");
  });

  it("rejects shell metacharacters before spawn", async () => {
    const rejection = validatePanCommand("advance task-id; rm -rf /");
    expect(rejection?.error).toContain("metacharacter");

    const request = new Request("http://localhost/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({ command: "advance task-id; rm -rf /" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns batch status deferral without spawning pan", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const result = await executePanCommand("batch status");
      expect(result).toMatchObject({
        deferred: true,
        exitCode: 125,
        deferralMessage: "Batch/parallel feature-delivery is disabled",
      });

      const request = new Request("http://localhost/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ command: "batch status" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as PanExecuteResult;
      expect(payload.deferred).toBe(true);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("normalizes pnpm-prefixed commands before validation", () => {
    expect(normalizePanCommand("pnpm -w exec pan check")).toBe("check");
  });
});
