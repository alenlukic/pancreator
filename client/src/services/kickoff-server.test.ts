import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertValidHttpUrl,
  assertValidInboxPath,
  buildUrlDirectiveSeed,
  extractTitleFromMarkdown,
  inboxRelativeFromRepoPath,
  launchFeatureDelivery,
  saveKickoffDirective,
  slugifyIntakeBasename,
  summarizeKickoffUrl,
} from "./kickoff-server";

describe("kickoff-server", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-kickoff-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("slugifies intake basenames from titles", () => {
    expect(slugifyIntakeBasename("My Feature Title")).toBe("my-feature-title");
    expect(extractTitleFromMarkdown("# Demo Feature\n", "fallback")).toBe("Demo Feature");
  });

  it("validates inbox and URL inputs", () => {
    expect(assertValidInboxPath("lib/inbox/in/172967_06-08-26/demo.md")).toContain("lib/inbox/in/");
    expect(() => assertValidInboxPath("lib/inbox/notes/demo.md")).toThrow();
    expect(assertValidHttpUrl("https://example.com/page")).toContain("https://");
    expect(() => assertValidHttpUrl("ftp://example.com")).toThrow();
  });

  it("saves kickoff directives with intake naming contract", async () => {
    const now = new Date("2026-06-09T16:59:00.000Z");
    const markdown = [
      "---",
      'title: "Kickoff save test"',
      "feature_id: kickoff-save-test",
      "stage: intake",
      "owner: intake-analyst",
      "status: open",
      'created_at: "2026-06-09T16:59:00.000Z"',
      "references: []",
      "---",
      "",
      "# Kickoff save test",
      "",
      "Body",
      "",
    ].join("\n");

    const result = await saveKickoffDirective({
      repoRoot: tempRoot,
      markdown,
      slug: "kickoff-save-test",
      now,
    });

    expect(result.path).toMatch(/^lib\/inbox\/in\/\d+_\d{2}-\d{2}-\d{2}\/\d+_\d{4}_kickoff-save-test\.md$/u);
    expect(fs.existsSync(path.join(tempRoot, result.path))).toBe(true);
  });

  it("summarizes URL context into directive seed", async () => {
    const html = "<html><head><title>Example Spec</title></head><body><p>Summary text for the kickoff seed.</p></body></html>";
    const summary = await summarizeKickoffUrl({
      url: "https://example.com/spec",
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });

    expect(summary.title).toBe("Example Spec");
    expect(summary.excerpt).toContain("Summary text");
    expect(summary.directiveSeed).toContain("source_url");
    expect(buildUrlDirectiveSeed("T", "E", "https://example.com")).toContain("## Problem");
  });

  it("launches feature delivery through injected runner", async () => {
    const inboxRel = "172967_06-08-26/54352_0854_demo.md";
    const inboxPath = `lib/inbox/in/${inboxRel}`;
    fs.mkdirSync(path.join(tempRoot, "lib/inbox/in/172967_06-08-26"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, inboxPath), "# Demo\n");

    const result = await launchFeatureDelivery({
      inboxPath,
      repoRoot: tempRoot,
      launchRunner: async (relative) => {
        expect(relative).toBe(inboxRelativeFromRepoPath(inboxPath));
        return {
          taskId: "25237_1659_demo",
          featureId: "demo",
          runDir: ".pan/work/172966_06-09-26/25237_1659_demo",
          handoffFile: ".pan/work/172966_06-09-26/25237_1659_demo/handoff.md",
        };
      },
    });

    expect(result.taskId).toBe("25237_1659_demo");
    expect(result.handoffFile).toContain("handoff.md");
  });
});
