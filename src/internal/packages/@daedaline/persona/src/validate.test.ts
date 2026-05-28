import { describe, expect, it } from "vitest";
import { assertPersonaSpec, isPersonaSpec } from "./validate.js";

describe("assertPersonaSpec", () => {
  it("throws when name is missing", () => {
    expect(() =>
      assertPersonaSpec({
        description: "d",
        model: "inherit",
        permissionMode: "default",
        tools: [],
        disallowedTools: [],
        mcpServers: [],
        maxTurns: 1,
        skills: [],
        isolation: "worktree",
        memory: "project",
        effort: "low",
        color: "slate",
        metadata: {
          "daedaline-risk-tier": "low",
          "daedaline-pipeline-stages": ["a"],
          "daedaline-bootstrap-only": false,
          "daedaline-stability": "experimental",
          "daedaline-checklist": ["x"],
        },
      } as Record<string, unknown>),
    ).toThrow(/name/);
  });
});

describe("isPersonaSpec", () => {
  it("returns false for non-objects", () => {
    expect(isPersonaSpec(null)).toBe(false);
    expect(isPersonaSpec("x")).toBe(false);
  });
});
