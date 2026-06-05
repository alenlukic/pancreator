import { describe, expect, it } from "vitest";

import {
  renderOperatorVerificationScaffold,
  validateOperatorVerificationMarkdown,
} from "./operator-verification.js";

describe("operator-verification", () => {
  const sampleState = {
    taskId: "1000_1200_demo-feature",
    featureId: "demo-feature",
    artifacts: { runDir: "work/172996_05-10-26/1000_1200_demo-feature" },
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
});
