import { describe, expect, it } from "vitest";
import { emitCursorMdcFromPersonaRule, parsePersonaRuleYaml } from "./persona-rule.js";

describe("parsePersonaRuleYaml", () => {
  it("parses a minimal rule", () => {
    const rule = parsePersonaRuleYaml(
      `persona: coder
description: Implement tasks.
globs:
  - lib/internal/packages/**/src/**/*
alwaysApply: false
`,
      "coder",
    );
    expect(rule.persona).toBe("coder");
    expect(rule.globs).toHaveLength(1);
    expect(rule.alwaysApply).toBe(false);
  });

  it("rejects persona/file name mismatch", () => {
    expect(() =>
      parsePersonaRuleYaml(
        `persona: reviewer
description: Review.
globs:
  - work/**/review.md
`,
        "coder",
      ),
    ).toThrow(/does not match file name/);
  });
});

describe("emitCursorMdcFromPersonaRule", () => {
  it("emits Cursor mdc with project-root-relative persona include", () => {
    const mdc = emitCursorMdcFromPersonaRule(
      {
        persona: "coder",
        description: "Implement tasks.",
        globs: ["tests/**/*.mjs"],
        alwaysApply: false,
      },
      ".",
    );
    expect(mdc).toMatch(/^---\n/u);
    expect(mdc).toContain("description: Implement tasks.");
    expect(mdc).toContain("@lib/personas/coder.md");
  });

  it("prefixes persona include for embedded project roots", () => {
    const mdc = emitCursorMdcFromPersonaRule(
      {
        persona: "intake-analyst",
        description: "Intake work.",
        globs: ["lib/inbox/in/**/*.md"],
        alwaysApply: false,
      },
      ".pancreator",
    );
    expect(mdc).toContain("@.pancreator/lib/personas/intake-analyst.md");
  });
});
