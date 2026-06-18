import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import {
  renderOperatorVerificationScaffold,
  validateOperatorVerificationMarkdown,
} from "./operator-verification.js";

describe("operator-verification", () => {
  const sampleState = {
    taskId: "1000_1200_demo-feature",
    featureId: "demo-feature",
    artifacts: { runDir: ".pan/work/172996_05-10-26/1000_1200_demo-feature" },
  };

  it("renderOperatorVerificationScaffold includes required sections", () => {
    const md = renderOperatorVerificationScaffold(sampleState, process.cwd(), new Date("2026-05-10T13:00:00.000Z"));
    expect(md).toContain("## Acceptance criteria");
    expect(md).toContain("## Manual test flows");
    expect(md).toContain("- [ ] AC1:");
    expect(md).toContain("### Flow 1");
  });

  it("validateOperatorVerificationMarkdown accepts scaffold output", () => {
    const md = renderOperatorVerificationScaffold(sampleState, process.cwd(), new Date("2026-05-10T13:00:00.000Z"));
    const validation = validateOperatorVerificationMarkdown(md);
    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual([]);
  });

  it("validateOperatorVerificationMarkdown warns on missing sections", () => {
    const validation = validateOperatorVerificationMarkdown("# Operator verification\n\nNo sections.");
    expect(validation.ok).toBe(false);
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  it("prefers touch-set acceptance criteria and manual QA seeds over spec metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-operator-verification-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "touch-set.json"),
      stringifyCompactJson({
        acceptance_criteria: [
          { id: "P-AC-01", criterion: "Home hides archived runs", validation_owner: "qa-tester" },
        ],
        manual_qa_test_cases: [
          {
            id: "MQA-01",
            steps: ["Open Home surface"],
            expected: "Archived runs stay hidden",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(runAbs, "spec.md"),
      [
        "# Spec",
        "",
        "- Feature id: demo-feature",
        "- Task id: 1000_1200_demo-feature",
      ].join("\n"),
      "utf8",
    );

    const md = renderOperatorVerificationScaffold(
      sampleState,
      root,
      new Date("2026-05-10T13:00:00.000Z"),
    );

    expect(md).toContain("- [ ] AC1: P-AC-01: Home hides archived runs");
    expect(md).toContain("Derived from qa-tester manual verification: MQA-01");
    expect(md).not.toContain("Feature id: demo-feature");
  });
});
