import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  contextReviewReportRel,
  DEFAULT_CONTEXT_REVIEW_WORKSPACE,
  extractTouchSetPaths,
  renderContextReviewPrompt,
  resolveAgentTranscriptsDir,
} from "./context-review.js";

describe("context-review", () => {
  it("resolves agent transcripts dir from repo root slug", () => {
    const prev = process.env.PAN_AGENT_TRANSCRIPTS_DIR;
    delete process.env.PAN_AGENT_TRANSCRIPTS_DIR;
    const dir = resolveAgentTranscriptsDir("/Users/alen/Dev/daedaline");
    expect(dir).toContain(path.join(".cursor", "projects", "Users-alen-Dev-daedaline", "agent-transcripts"));
    if (prev === undefined) {
      delete process.env.PAN_AGENT_TRANSCRIPTS_DIR;
    } else {
      process.env.PAN_AGENT_TRANSCRIPTS_DIR = prev;
    }
  });

  it("honors PAN_AGENT_TRANSCRIPTS_DIR override", () => {
    process.env.PAN_AGENT_TRANSCRIPTS_DIR = "/.tmp/custom-transcripts";
    expect(resolveAgentTranscriptsDir("/any/root")).toBe("/.tmp/custom-transcripts");
    delete process.env.PAN_AGENT_TRANSCRIPTS_DIR;
  });

  it("extracts paths from touch-set.json", () => {
    const raw = `{
  "paths": ["lib/foo.ts", "lib/bar/"],
  "allowed_paths": ["lib/foo.ts", "tests/baz.test.ts"]
}`;
    expect(extractTouchSetPaths(raw).sort()).toEqual(["lib/bar/", "lib/foo.ts", "tests/baz.test.ts"].sort());
  });

  it("renders context review prompt without task id", () => {
    const workspace = ".sandbox/my-pass";
    const prompt = renderContextReviewPrompt({
      reviewLabel: "my-pass",
      workspaceDir: workspace,
      scopePaths: ["lib/internal/packages/@pancreator/cli/src/context-review.ts"],
      contextPaths: [".docs/PRD.summary.md"],
      transcriptsDir: "/home/op/.cursor/projects/demo/agent-transcripts",
    });
    expect(prompt).toContain("context-reviewer");
    expect(prompt).toContain(contextReviewReportRel(workspace));
    expect(prompt).toContain("advisory");
    expect(prompt).toContain("does **not** require a feature-delivery task id");
    expect(prompt).toContain(".docs/PRD.summary.md");
    expect(prompt).toContain("lib/inbox/notes/");
  });

  it("renders optional run-dir artifact hints when supplied", () => {
    const prompt = renderContextReviewPrompt({
      reviewLabel: "with-run",
      workspaceDir: ".sandbox/with-run",
      scopePaths: [],
      runDir: ".pan/work/172996_05-10-26/demo-feature",
      contextPaths: [],
      transcriptsDir: "/.tmp/transcripts",
    });
    expect(prompt).toContain(".pan/work/172996_05-10-26/demo-feature/plan.md");
    expect(prompt).toContain("touch-set.json");
  });
});

describe("scaffoldContextReview integration", () => {
  it("writes context-review-prompt.md under default sandbox workspace", async () => {
    const { scaffoldContextReview } = await import("./context-review.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-context-review-"));

    const result = await scaffoldContextReview({
      repoRoot: root,
      scopePaths: ["lib/personas/context-reviewer.md"],
      contextPaths: ["AGENTS.md"],
    });
    expect(result.status).toBe("ok");
    expect(result.workspace).toBe(DEFAULT_CONTEXT_REVIEW_WORKSPACE);
    expect(result.promptFile).toBe(`${DEFAULT_CONTEXT_REVIEW_WORKSPACE}/context-review-prompt.md`);
    expect(result.expectedArtifact).toBe(`${DEFAULT_CONTEXT_REVIEW_WORKSPACE}/context-review.md`);
    expect(result.persona).toBe("context-reviewer");

    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(path.join(root, result.promptFile), "utf8");
    expect(prompt).toContain("lib/personas/context-reviewer.md");
    expect(prompt).toContain("AGENTS.md");
  });

  it("accepts scope and context paths as a single string (commander single-flag shape)", async () => {
    const { scaffoldContextReview } = await import("./context-review.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-context-review-string-"));

    const result = await scaffoldContextReview({
      repoRoot: root,
    scopePaths: "lib/personas/context-reviewer.md",
      contextPaths: "AGENTS.md",
    });
    expect(result.scopePaths).toEqual(["lib/personas/context-reviewer.md"]);

    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(path.join(root, result.promptFile), "utf8");
    expect(prompt).toContain("AGENTS.md");
  });

  it("merges touch-set scope when --run-dir is supplied", async () => {
    const { scaffoldContextReview } = await import("./context-review.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-context-review-run-"));
    const runDirRel = ".pan/work/172996_05-10-26/demo-feature";
    const runAbs = path.join(root, runDirRel);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "touch-set.json"),
      '{"paths":["lib/personas/context-reviewer.md"]}\n',
      "utf8",
    );

    const result = await scaffoldContextReview({
      repoRoot: root,
      workspace: ".sandbox/from-run",
      runDir: runDirRel,
    });
    expect(result.runDir).toBe(runDirRel);
    expect(result.scopePaths).toContain("lib/personas/context-reviewer.md");

    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(path.join(root, result.promptFile), "utf8");
    expect(prompt).toContain(runDirRel);
  });
});
