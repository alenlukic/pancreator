/** Valid minimal gate artifact bodies for CLI integration tests. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
  manual_qa_test_cases: [{ id: "MQA-1", steps: ["Open the affected surface"], expected: "Behavior matches AC-1" }],
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

export const VALID_ADR_MARKDOWN = "# ADR\n\n## Decision\n\nBody.\n";

export const VALID_UX_SPEC_MARKDOWN = "# UX spec\n\n## Surface\n\nPanel layout.\n";

export const VALID_COMPANION_PLAN_MARKDOWN = "# Plan\n\n## Plan\n\nSteps.\n";

export const VALID_ACCEPTANCE_CRITERIA_MARKDOWN =
  "# Acceptance criteria\n\n## Criteria\n\n- AC-1: verified.\n";

export const VALID_MANUAL_QA_MARKDOWN = "# Manual QA test cases\n\n## MQA-1\n\nSteps and expected result.\n";

export function planStageRequiredArtifactRels(runDirRel: string, featureId: string): string[] {
  return [
    `${runDirRel}/product-plan.md`,
    `${runDirRel}/product-acceptance-criteria.md`,
    `${runDirRel}/tech-plan.md`,
    `${runDirRel}/tech-acceptance-criteria.md`,
    `${runDirRel}/manual-qa-test-cases.md`,
    `${runDirRel}/plan.md`,
    `${runDirRel}/adr-draft.md`,
    `${runDirRel}/touch-set.json`,
    `${runDirRel}/handoff.md`,
    `${runDirRel}/design-plan.md`,
    `${runDirRel}/design-acceptance-criteria.md`,
    `lib/memory/features/${featureId}/ux-spec.md`,
  ];
}

export async function seedPlanStageAdvanceArtifacts(
  root: string,
  runDirRel: string,
  featureId = "demo-feature",
): Promise<void> {
  const runDir = path.join(root, runDirRel);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(root, "lib", "memory", "features", featureId), { recursive: true });
  await writeFile(path.join(runDir, "plan.md"), VALID_PLAN_MARKDOWN, "utf8");
  await writeFile(path.join(runDir, "adr-draft.md"), VALID_ADR_MARKDOWN, "utf8");
  await writeFile(path.join(runDir, "touch-set.json"), VALID_TOUCH_SET_JSON, "utf8");
  await writeFile(path.join(runDir, "handoff.md"), VALID_HANDOFF_MARKDOWN, "utf8");
  await writeFile(path.join(runDir, "product-plan.md"), VALID_COMPANION_PLAN_MARKDOWN, "utf8");
  await writeFile(
    path.join(runDir, "product-acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(path.join(runDir, "design-plan.md"), VALID_COMPANION_PLAN_MARKDOWN, "utf8");
  await writeFile(
    path.join(runDir, "design-acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(path.join(runDir, "tech-plan.md"), VALID_COMPANION_PLAN_MARKDOWN, "utf8");
  await writeFile(
    path.join(runDir, "tech-acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(path.join(runDir, "manual-qa-test-cases.md"), VALID_MANUAL_QA_MARKDOWN, "utf8");
  await writeFile(
    path.join(root, "lib", "memory", "features", featureId, "ux-spec.md"),
    VALID_UX_SPEC_MARKDOWN,
    "utf8",
  );
}

export async function seedTestStageAdvanceArtifacts(root: string, runDirRel: string): Promise<void> {
  const runDir = path.join(root, runDirRel);
  await writeFile(path.join(runDir, "test-report.md"), "qa_passes: true\n", "utf8");
  await writeFile(path.join(runDir, "design-qa-report.md"), "design_qa_passes: true\n", "utf8");
}

export function gateFixtureBody(repoRoot: string, rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  if (base === "plan.md") return VALID_PLAN_MARKDOWN;
  if (base === "handoff.md") return VALID_HANDOFF_MARKDOWN;
  if (base === "touch-set.json") return VALID_TOUCH_SET_JSON;
  if (base === "implementation-report.md") return VALID_IMPLEMENTATION_REPORT_MARKDOWN;
  if (base === "review.md") return VALID_REVIEW_MARKDOWN;
  if (base === "test-report.md") return "qa_passes: true\n";
  if (base === "design-qa-report.md") return "design_qa_passes: true\n";
  if (base === "manual-qa-test-cases.md") return VALID_MANUAL_QA_MARKDOWN;
  if (base.endsWith("acceptance-criteria.md")) return VALID_ACCEPTANCE_CRITERIA_MARKDOWN;
  if (base.endsWith("plan.md")) return VALID_COMPANION_PLAN_MARKDOWN;
  if (base === "adr-draft.md") return VALID_ADR_MARKDOWN;
  if (base === "ux-spec.md") return VALID_UX_SPEC_MARKDOWN;
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
