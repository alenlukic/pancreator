import { describe, expect, it } from "vitest";
import { CursorRunner } from "./cursor-runner.js";
import type { RunnerPersonaInput } from "./types.js";

const samplePersona: RunnerPersonaInput = {
  name: "tech-writer",
  description: "When the pipeline reaches report, the tech-writer SHALL emit a report.",
  model: "gpt-5.4-mini",
  permissionMode: "default",
  tools: ["Read", "Write"],
  disallowedTools: ["Bash(git push:*)"],
  mcpServers: [],
  maxTurns: 30,
  skills: [],
  isolation: "worktree",
  memory: "project",
  effort: "medium",
  color: "slate",
  metadata: { "tesseract-risk-tier": "low" },
};

describe("CursorRunner", () => {
  it("returns a dry-run envelope with resolved routing fields", async () => {
    const runner = new CursorRunner();
    const env = await runner.invoke({
      persona: samplePersona,
      message: "Draft the report for feature-1",
      requestId: "req-fixed",
    });
    expect(env.dryRun).toBe(true);
    expect(env.runner).toBe("cursor");
    expect(env.schemaVersion).toBe("1");
    expect(env.requestId).toBe("req-fixed");
    expect(env.personaName).toBe("tech-writer");
    expect(env.userMessage).toBe("Draft the report for feature-1");
    expect(env.resolved.model).toBe("gpt-5.4-mini");
    expect(env.resolved.routingDescription).toBe(samplePersona.description);
    expect(env.resolved.toolAllowlist).toEqual(["Read", "Write"]);
    expect(env.resolved.maxTurns).toBe(30);
  });

  it("generates a request id when omitted", async () => {
    const runner = new CursorRunner();
    const a = await runner.invoke({ persona: samplePersona, message: "m1" });
    const b = await runner.invoke({ persona: samplePersona, message: "m2" });
    expect(a.requestId).toHaveLength(16);
    expect(a.requestId).not.toBe(b.requestId);
  });
});
