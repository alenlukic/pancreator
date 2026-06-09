import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildSdkAgentCreateOptions,
  buildSdkPrompt,
  findMissingArtifactPaths,
  PERSONA_MCP_SETTING_SOURCES,
  resolveSdkLocalOptions,
  type CursorSdkInvokeParams,
} from "./sdk-transport.js";
import type { RunnerPersonaInput } from "./types.js";

const persona: RunnerPersonaInput = {
  name: "tech-lead",
  description:
    "When the feature-delivery pipeline reaches plan, the tech-lead SHALL emit plan.md, adr-draft.md, touch-set.json, and handoff.md.",
  model: "gpt-5.3-codex",
  permissionMode: "default",
  tools: ["Read", "Write"],
  disallowedTools: [],
  mcpServers: [],
  maxTurns: 30,
  skills: [],
  isolation: "worktree",
  memory: "project",
  effort: "high",
  color: "cyan",
  metadata: {},
};

describe("sdk-transport prompt and verification helpers", () => {
  it("buildSdkPrompt inlines stage prompt and lists all required artifacts", () => {
    const params: CursorSdkInvokeParams = {
      message: "Execute feature-delivery stage plan for task demo.",
      persona,
      stagePromptContent: "# Plan stage\nOutput: plan.md",
      requiredArtifactPaths: [
        ".pan/work/demo/plan.md",
        ".pan/work/demo/touch-set.json",
        ".pan/work/demo/handoff.md",
      ],
    };
    const prompt = buildSdkPrompt(params);
    expect(prompt).toContain("Persona contract:");
    expect(prompt).toContain("plan.md, adr-draft.md, touch-set.json");
    expect(prompt).toContain("Required output artifacts (all MUST exist on disk before finishing):");
    expect(prompt).toContain("- .pan/work/demo/plan.md");
    expect(prompt).toContain("## Stage prompt");
    expect(prompt).toContain("# Plan stage");
  });

  it("buildSdkPrompt uses modelOverride when provided", () => {
    const prompt = buildSdkPrompt({
      message: "run",
      persona,
      modelOverride: "composer-2.5[fast=false]",
    });
    expect(prompt).toContain("Model: composer-2.5[fast=false]");
  });

  it("resolveSdkLocalOptions keeps inline-only settings when persona declares no MCP servers", () => {
    expect(resolveSdkLocalOptions(persona, "/repo")).toEqual({ cwd: "/repo" });
  });

  it("resolveSdkLocalOptions loads operator MCP setting sources when persona declares MCP servers", () => {
    expect(
      resolveSdkLocalOptions(
        { ...persona, mcpServers: ["chrome-devtools", "pancreator-memory"] },
        "/repo",
      ),
    ).toEqual({
      cwd: "/repo",
      settingSources: [...PERSONA_MCP_SETTING_SOURCES],
    });
  });

  it("buildSdkPrompt lists declared MCP servers and setting sources", () => {
    const prompt = buildSdkPrompt({
      message: "run design QA",
      persona: { ...persona, name: "design-reviewer", mcpServers: ["chrome-devtools"] },
    });
    expect(prompt).toContain("MCP servers: chrome-devtools");
    expect(prompt).toContain("MCP setting sources: user, project, plugins");
  });

  it("buildSdkAgentCreateOptions wires persona MCP dependencies into Agent.create options", () => {
    const options = buildSdkAgentCreateOptions({
      apiKey: "test-key",
      sdkModelId: "composer-2.5",
      persona: { ...persona, mcpServers: ["chrome-devtools"] },
      cwd: "/repo",
    });
    expect(options).toEqual({
      apiKey: "test-key",
      model: { id: "composer-2.5" },
      local: {
        cwd: "/repo",
        settingSources: [...PERSONA_MCP_SETTING_SOURCES],
      },
    });
  });

  it("findMissingArtifactPaths returns repo-relative gaps deterministically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-verify-"));
    const existing = path.join(root, ".pan/work/demo/touch-set.json");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "{}", "utf8");

    const missing = findMissingArtifactPaths(root, [
      ".pan/work/demo/plan.md",
      ".pan/work/demo/touch-set.json",
    ]);
    expect(missing).toEqual([".pan/work/demo/plan.md"]);
  });
});
