import { describe, expect, it } from "vitest";

import {
  normalizeClientWorkspaceTestCommand,
  normalizeTouchSetTestCommands,
  renderTransitions,
} from "./feature-delivery-run.js";

describe("feature-delivery-run introspection routes", () => {
  it("renderTransitions includes qa_design_followup and repo_wide_blocker", () => {
    const transitions = renderTransitions({
      id: "feature-delivery",
      stages: [{ id: "test", persona: "qa-tester" }],
    });
    expect(transitions.some((row) => row.on === "qa_design_followup")).toBe(true);
    expect(transitions.some((row) => row.on === "repo_wide_blocker")).toBe(true);
  });

  it("normalizeClientWorkspaceTestCommand rewrites client/src to src", () => {
    expect(
      normalizeClientWorkspaceTestCommand(
        "pnpm test -- client/src/app/page.test.ts",
        "client",
      ),
    ).toBe("pnpm test -- src/app/page.test.ts");
  });

  it("normalizeTouchSetTestCommands normalizes client workspace entries", () => {
    const normalized = normalizeTouchSetTestCommands([
      {
        working_directory: "pancreator/client",
        command: "pnpm test -- client/src/components/foo.test.ts",
      },
    ]);
    expect(normalized[0]?.command).toBe("pnpm test -- src/components/foo.test.ts");
  });
});
