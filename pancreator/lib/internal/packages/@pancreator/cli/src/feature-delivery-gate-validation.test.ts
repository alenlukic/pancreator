import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import {
  touchSetAllowsPath,
  validateImplementationScopeAmendments,
  validateImplementationReport,
  validatePlanMarkdown,
  validateReviewMarkdownForAdvance,
  validateScopeAmendments,
  validateSpotFixJustification,
  validateTouchSetJson,
  validateWorkflowHealthJson,
  validateHighRiskPersonaTranscriptCompliance,
  validateTestReportForAdvance,
  validateDesignQaForAdvance,
  parseSpotFixJustificationFromMarkdown,
} from "./feature-delivery-gate-validation.js";

const validPlan = `# Plan

## Architecture

Summary.

## Acceptance criteria

1. AC-1: API returns 200 within 200 ms p95.

## Shared-layer impact

- client/globals.css

## Tasks

1. Implement endpoint.
`;

const validTouchSet = stringifyCompactJson({
  paths: [{ path: "client/foo.ts", status: "existing" }],
  symbols: [],
  tests: [{ kind: "command", command: "pnpm test" }],
  shared_paths: ["client/globals.css"],
  integration_prerequisites: [],
  acceptance_criteria: [{ id: "AC-1", criterion: "API returns 200", validation_owner: "qa-tester" }],
  manual_qa_test_cases: [{ id: "MQA-1", steps: ["Open the affected surface"], expected: "Behavior matches AC-1" }],
  amendments: [],
});

const validImplementationReport = `implement_gate_passes: true
scope_amendments: none

## Acceptance criteria

- AC-1: pass

## Automated checks

| command | exit code | pass/fail |
| pnpm lint | 0 | pass |
| pnpm typecheck | 0 | pass |
| pnpm test | 0 | pass |

## Coverage delta

statement: 85% (threshold: 80%)
branch: 72% (threshold: 70%)
`;

describe("feature-delivery-gate-validation", () => {
  it("accepts quantified plan artifacts", () => {
    expect(validatePlanMarkdown(validPlan)).toBeNull();
    expect(validateTouchSetJson(validTouchSet)).toBeNull();
  });

  it("rejects plan without acceptance criteria", () => {
    expect(validatePlanMarkdown("# Plan\n\n## Tasks\n\n1. Do work.\n")).toContain("Acceptance criteria");
  });

  it("accepts implementation report with required checks", () => {
    expect(validateImplementationReport(validImplementationReport)).toBeNull();
  });

  it("accepts workspace-scoped automated check commands", () => {
    const report = validImplementationReport.replaceAll("pnpm lint", "pnpm --filter client lint")
      .replaceAll("pnpm typecheck", "pnpm --filter client typecheck")
      .replaceAll("pnpm test", "pnpm --filter client test");
    expect(validateImplementationReport(report)).toBeNull();
  });

  it("does not require repo-wide tests for review_passes advance", () => {
    expect(
      validateReviewMarkdownForAdvance(
        "review_passes: true\nscope_amendments_ratified: true\n",
        "review_passes",
      ),
    ).toBeNull();
    expect(
      validateReviewMarkdownForAdvance(
        "review_passes: false\nscope_amendments_ratified: true\n",
        "review_passes",
      ),
    ).toContain("review_passes: true");
  });

  it("enforces artifact-only review spot-fix scope", () => {
    const justification = parseSpotFixJustificationFromMarkdown(
      [
        "spot_fixable: true",
        "spot_fix_scope: code-bounded",
        "spot_fix_paths: client/foo.ts",
        "spot_fix_rationale: fix typo",
      ].join("\n"),
    );
    expect(validateSpotFixJustification("review_spot_fix", justification)).toContain("artifact-only");
  });

  it("accepts valid review artifact-only spot fix", () => {
    const justification = parseSpotFixJustificationFromMarkdown(
      [
        "spot_fixable: true",
        "spot_fix_scope: artifact-only",
        "spot_fix_paths: .pan/work/day/task/review.md",
        "spot_fix_rationale: add missing verdict field",
      ].join("\n"),
    );
    expect(validateSpotFixJustification("review_spot_fix", justification)).toBeNull();
  });

  it("classifies touch-set paths, shared_paths, and undeclared edits", () => {
    const allowed = touchSetAllowsPath(validTouchSet, "client/globals.css");
    expect(allowed.allowed).toBe(true);
    expect(allowed.category).toBe("shared_paths");
    const inPaths = touchSetAllowsPath(validTouchSet, "client/foo.ts");
    expect(inPaths.allowed).toBe(true);
    expect(inPaths.category).toBe("paths");
    const undeclared = touchSetAllowsPath(validTouchSet, "client/secret.ts");
    expect(undeclared.allowed).toBe(false);
    expect(undeclared.category).toBe("undeclared");
  });

  it("accepts bounded paired-test amendments and requires implementation-report parity", () => {
    const amendedTouchSet = stringifyCompactJson({
      paths: [
        {
          path: "client/src/components/command-center/layout/surface-config.ts",
          status: "existing",
        },
        {
          path: "client/src/components/command-center/layout/surface-config.test.ts",
          status: "existing",
        },
      ],
      symbols: [],
      tests: [{ kind: "command", command: "pnpm test" }],
      shared_paths: ["client/globals.css"],
      integration_prerequisites: [],
      acceptance_criteria: [{ id: "AC-1", criterion: "API returns 200", validation_owner: "qa-tester" }],
      manual_qa_test_cases: [{ id: "MQA-1", steps: ["Open the affected surface"], expected: "Behavior matches AC-1" }],
      amendments: [
        {
          path: "client/src/components/command-center/layout/surface-config.test.ts",
          status: "existing",
          kind: "paired-test",
          reason:
            "Required regression test for declared source client/src/components/command-center/layout/surface-config.ts",
        },
      ],
    });
    expect(validateTouchSetJson(amendedTouchSet)).toBeNull();
    expect(
      validateScopeAmendments(amendedTouchSet, [
        "client/src/components/command-center/layout/surface-config.ts",
        "client/src/components/command-center/layout/surface-config.test.ts",
      ]),
    ).toBeNull();
    const amendedReport = validImplementationReport.replace(
      "scope_amendments: none",
      "scope_amendments: client/src/components/command-center/layout/surface-config.test.ts(paired-test:Required regression test for declared source client/src/components/command-center/layout/surface-config.ts)",
    );
    expect(
      validateImplementationScopeAmendments(
        amendedTouchSet,
        amendedReport,
        [
          "client/src/components/command-center/layout/surface-config.ts",
          "client/src/components/command-center/layout/surface-config.test.ts",
        ],
      ),
    ).toBeNull();
  });

  it("keeps undeclared changed paths advisory while rejecting malformed amendment classes", () => {
    const amendedTouchSet = stringifyCompactJson({
      paths: [{ path: "client/foo.ts", status: "existing" }],
      symbols: [],
      tests: [{ kind: "command", command: "pnpm test" }],
      shared_paths: [],
      integration_prerequisites: [],
      acceptance_criteria: [{ id: "AC-1", criterion: "API returns 200", validation_owner: "qa-tester" }],
      manual_qa_test_cases: [{ id: "MQA-1", steps: ["Open the affected surface"], expected: "Behavior matches AC-1" }],
      amendments: [
        {
          path: "client/elsewhere/bar.ts",
          status: "existing",
          kind: "declared-dir-sibling",
          reason: "not actually a sibling",
        },
      ],
    });
    expect(
      validateScopeAmendments(amendedTouchSet, ["client/foo.ts", "client/elsewhere/bar.ts"]),
    ).toContain("bounded declared-dir-sibling policy");
    expect(
      validateScopeAmendments(validTouchSet, ["client/foo.ts", "client/secret.ts"]),
    ).toBeNull();
  });

  it("validateTestReportForAdvance accepts qa_design_followup with qa_passes true", () => {
    expect(
      validateTestReportForAdvance("qa_passes: true\n", "qa_design_followup"),
    ).toBeNull();
  });

  it("validateTestReportForAdvance accepts inline qa_passes for qa_design_followup", () => {
    expect(
      validateTestReportForAdvance("## Verdict\n`qa_passes: true`", "qa_design_followup"),
    ).toBeNull();
  });

  it("validateTestReportForAdvance accepts excluded qa blockers for qa_design_followup", () => {
    expect(
      validateTestReportForAdvance(
        "qa_passes: false\nexcluded_from_gate: true\nspot_fixable: false\n",
        "qa_design_followup",
      ),
    ).toBeNull();
  });

  it("validateTestReportForAdvance rejects spot-fixable qa blockers for qa_design_followup", () => {
    expect(
      validateTestReportForAdvance(
        "qa_passes: false\nexcluded_from_gate: true\nspot_fixable: true\n",
        "qa_design_followup",
      ),
    ).toContain("spot_fixable: true");
  });

  it("validateTestReportForAdvance allows browser-lock qa blockers for qa_design_followup", () => {
    expect(
      validateTestReportForAdvance(
        [
          "qa_passes: false",
          "excluded_from_gate: false",
          "spot_fixable: false",
          "chrome-devtools:list_pages fails on a locked shared profile",
          "Use --isolated to run multiple browser instances.",
        ].join("\n"),
        "qa_design_followup",
      ),
    ).toBeNull();
  });

  it("validateDesignQaForAdvance requires excluded_from_gate for qa_design_followup", () => {
    expect(
      validateDesignQaForAdvance(
        "design_qa_passes: false\nexcluded_from_gate: true\n",
        "qa_design_followup",
      ),
    ).toBeNull();
  });

  it("validateDesignQaForAdvance allows browser-lock blockers as design follow-up", () => {
    expect(
      validateDesignQaForAdvance(
        [
          "design_qa_passes: false",
          "excluded_from_gate: false",
          "MCP error: The browser is already running for /Users/alen/.cache/chrome-devtools-mcp/chrome-profile.",
          "Use --isolated to run multiple browser instances.",
        ].join("\n"),
        "qa_design_followup",
      ),
    ).toBeNull();
  });

  it("validateDesignQaForAdvance accepts inline design_qa_passes for qa_passes", () => {
    expect(
      validateDesignQaForAdvance(
        "## Verdict\n`design_qa_passes: true`, `excluded_from_gate: false`",
        "qa_passes",
      ),
    ).toBeNull();
  });

  it("validateTestReportForAdvance accepts inline qa_passes for qa_passes", () => {
    expect(
      validateTestReportForAdvance("## Verdict\n`qa_passes: true`", "qa_passes"),
    ).toBeNull();
  });

  it("validateWorkflowHealthJson rejects missing status", () => {
    const error = validateWorkflowHealthJson(
      stringifyCompactJson({
        task_id: "t1",
        feature_id: "f1",
        run_dir: ".pan/work/day/t1",
        repair_count: 0,
        auto_chain_reversal_count: 0,
        findings: [],
        updated_at: "2026-06-19T00:00:00.000Z",
      }),
    );
    expect(error).toContain("status");
  });

  it("validateHighRiskPersonaTranscriptCompliance rejects missing transcript evidence", () => {
    expect(
      validateHighRiskPersonaTranscriptCompliance({
        output_manifest: { consulted_docs: ["DOC.AGENTS", "DOC.REGISTRY"] },
      }),
    ).toContain("transcript_required_doc_evidence");
  });
});
