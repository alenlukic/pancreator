import { describe, expect, it } from "vitest";
import { CursorRunner } from "./cursor-runner.js";
import type { CursorSdkTransport } from "./sdk-transport.js";
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
  metadata: { "pancreator-risk-tier": "low" },
};

const mockSdkTransport: CursorSdkTransport = async (params) => ({
  status: "ok",
  resultText: `completed:${params.persona.name}:${params.persona.model}`,
});

describe("CursorRunner", () => {
  it("returns a manual dry-run envelope with resolved routing fields", async () => {
    const runner = new CursorRunner({ invocation: "manual" });
    const env = await runner.invoke({
      persona: samplePersona,
      message: "Draft the report for feature-1",
      requestId: "req-fixed",
      stagePromptPath: "src/work/demo/next-prompt.md",
      artifactPath: "src/work/demo/report.md",
      ledger: { taskId: "t1", pipelineId: "feature-delivery", stageId: "report" },
    });
    expect(env.dryRun).toBe(true);
    expect(env.invocation).toBe("manual");
    expect(env.runner).toBe("cursor");
    expect(env.schemaVersion).toBe("1");
    expect(env.requestId).toBe("req-fixed");
    expect(env.personaName).toBe("tech-writer");
    expect(env.resolved.stagePromptPath).toBe("src/work/demo/next-prompt.md");
    expect(env.resolved.artifactPath).toBe("src/work/demo/report.md");
    expect(env.resolved.maxTurns).toBe(30);
    expect(env.resolved.toolAllowlist).toEqual(["Read", "Write"]);
    expect(env.resolved.toolDenylist).toEqual(["Bash(git push:*)"]);
    expect(env.runLogFragment?.attributes["openinference.span.kind"]).toBe("AGENT");
    expect(env.sdkResult).toBeUndefined();
  });

  it("sdk mode invokes transport and returns non-dry-run completion", async () => {
    const runner = new CursorRunner({ invocation: "sdk", sdkTransport: mockSdkTransport });
    const env = await runner.invoke({
      persona: samplePersona,
      message: "Implement stage",
      artifactPath: "src/work/demo/implementation-report.md",
    });
    expect(env.dryRun).toBe(false);
    expect(env.invocation).toBe("sdk");
    expect(env.sdkResult?.status).toBe("ok");
    expect(env.sdkResult?.artifactPath).toBe("src/work/demo/implementation-report.md");
    expect(env.sdkResult?.resultText).toContain("tech-writer");
    expect(env.sdkResult?.resultText).toContain("gpt-5.4-mini");
  });

  it("sdk mode preserves IDE model qualifiers on the persona passed to transport", async () => {
    const captured: string[] = [];
    const runner = new CursorRunner({
      invocation: "sdk",
      sdkTransport: async (params) => {
        captured.push(params.persona.model);
        return { status: "ok", resultText: "ok" };
      },
    });
    const env = await runner.invoke({
      persona: { ...samplePersona, name: "coder", model: "composer-2.5[fast=false]" },
      message: "Implement stage",
    });
    expect(captured).toEqual(["composer-2.5[fast=false]"]);
    expect(env.resolved.model).toBe("composer-2.5[fast=false]");
  });

  it("sdk mode surfaces transport errors without throwing", async () => {
    const runner = new CursorRunner({
      invocation: "sdk",
      sdkTransport: async () => ({ status: "error", errorMessage: "no api key" }),
    });
    const env = await runner.invoke({ persona: samplePersona, message: "m" });
    expect(env.sdkResult?.status).toBe("error");
    expect(env.sdkResult?.errorMessage).toBe("no api key");
  });

  it("generates a request id when omitted", async () => {
    const runner = new CursorRunner();
    const a = await runner.invoke({ persona: samplePersona, message: "m1" });
    const b = await runner.invoke({ persona: samplePersona, message: "m2" });
    expect(a.requestId).toHaveLength(16);
    expect(a.requestId).not.toBe(b.requestId);
  });
});
