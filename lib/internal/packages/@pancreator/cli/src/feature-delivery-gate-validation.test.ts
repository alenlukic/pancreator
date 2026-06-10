import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import {
  touchSetAllowsPath,
  validateImplementationReport,
  validatePlanMarkdown,
  validateReviewMarkdownForAdvance,
  validateSpotFixJustification,
  validateTouchSetJson,
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
  paths: ["client/foo.ts"],
  symbols: [],
  tests: [{ kind: "command", command: "pnpm test" }],
  shared_paths: ["client/globals.css"],
  integration_prerequisites: [],
  acceptance_criteria: [{ id: "AC-1", criterion: "API returns 200", validation_owner: "qa-tester" }],
});

const validImplementationReport = `implement_gate_passes: true

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

  it("requires repo-wide tests for review_passes advance", () => {
    expect(
      validateReviewMarkdownForAdvance("review_passes: true\nrepo_wide_tests_pass: true\n", "review_passes"),
    ).toBeNull();
    expect(validateReviewMarkdownForAdvance("review_passes: true\n", "review_passes")).toContain(
      "repo_wide_tests_pass",
    );
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

  it("classifies shared_paths separately from undeclared edits", () => {
    const allowed = touchSetAllowsPath(validTouchSet, "client/globals.css");
    expect(allowed.allowed).toBe(true);
    expect(allowed.category).toBe("shared_paths");
    const undeclared = touchSetAllowsPath(validTouchSet, "client/secret.ts");
    expect(undeclared.allowed).toBe(false);
    expect(undeclared.category).toBe("undeclared");
  });
});
