/** Valid minimal gate artifact bodies for CLI integration tests. */

import { stringifyCliJson, stringifyCompactJson } from "./canonical-json-io.js";

export const VALID_PLAN_MARKDOWN = [
  "# Plan",
  "",
  "## Architecture",
  "",
  "Summary.",
  "",
  "## Acceptance criteria",
  "",
  "1. AC-1: behavior verified.",
  "",
  "## Shared-layer impact",
  "",
  "none",
  "",
  "## Tasks",
  "",
  "1. Implement.",
].join("\n");

export const VALID_HANDOFF_MARKDOWN = "# Handoff\n\n## Validation commands\n\n- pnpm test (coder)\n";

export const VALID_TOUCH_SET_JSON = stringifyCompactJson({
  paths: ["client/foo.ts"],
  symbols: [],
  tests: [{ kind: "command", command: "pnpm test" }],
  shared_paths: [],
  integration_prerequisites: [],
  acceptance_criteria: [{ id: "AC-1", criterion: "verified", validation_owner: "qa-tester" }],
});

export const VALID_IMPLEMENTATION_REPORT_MARKDOWN = [
  "implement_gate_passes: true",
  "",
  "## Acceptance criteria",
  "",
  "- AC-1: pass",
  "",
  "## Automated checks",
  "",
  "| command | exit code | pass/fail |",
  "| pnpm lint | 0 | pass |",
  "| pnpm typecheck | 0 | pass |",
  "| pnpm test | 0 | pass |",
  "",
  "## Coverage delta",
  "",
  "statement: 85%",
].join("\n");

export const VALID_REVIEW_MARKDOWN =
  "review_passes: true\nrepo_wide_tests_pass: true\nlint_typecheck_rerun_required: false\n";

export function gateFixtureBody(repoRoot: string, rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  if (base === "plan.md") return VALID_PLAN_MARKDOWN;
  if (base === "handoff.md") return VALID_HANDOFF_MARKDOWN;
  if (base === "touch-set.json") return VALID_TOUCH_SET_JSON;
  if (base === "implementation-report.md") return VALID_IMPLEMENTATION_REPORT_MARKDOWN;
  if (base === "review.md") return VALID_REVIEW_MARKDOWN;
  if (base === "test-report.md") return "qa_passes: true\n";
  if (base === "compliance-result.json") {
    return stringifyCliJson(repoRoot, {
      compliance_passes: true,
      final_gate: {
        "pnpm lint": 0,
        "pnpm typecheck": 0,
        "pnpm test": 0,
        "node --test tests/*.test.mjs": 0,
      },
    });
  }
  if (base === "ship-ratification.json") {
    return stringifyCliJson(repoRoot, {
      task_id: "mock-task",
      human_ratified_diff: true,
    });
  }
  return "mock-artifact\n";
}
