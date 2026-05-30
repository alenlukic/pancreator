import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildSdkPrompt,
  findMissingArtifactPaths,
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
        "work/demo/plan.md",
        "work/demo/touch-set.json",
        "work/demo/handoff.md",
      ],
    };
    const prompt = buildSdkPrompt(params);
    expect(prompt).toContain("Persona contract:");
    expect(prompt).toContain("plan.md, adr-draft.md, touch-set.json");
    expect(prompt).toContain("Required output artifacts (all MUST exist on disk before finishing):");
    expect(prompt).toContain("- work/demo/plan.md");
    expect(prompt).toContain("## Stage prompt");
    expect(prompt).toContain("# Plan stage");
  });

  it("findMissingArtifactPaths returns repo-relative gaps deterministically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-verify-"));
    const existing = path.join(root, "work/demo/touch-set.json");
    await mkdir(path.dirname(existing), { recursive: true });
    await writeFile(existing, "{}", "utf8");

    const missing = findMissingArtifactPaths(root, [
      "work/demo/plan.md",
      "work/demo/touch-set.json",
    ]);
    expect(missing).toEqual(["work/demo/plan.md"]);
  });
});
