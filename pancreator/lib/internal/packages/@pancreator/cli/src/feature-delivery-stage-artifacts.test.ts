import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import {
  planStageRequiredArtifactRels,
  seedPlanStageAdvanceArtifacts,
  VALID_IMPLEMENTATION_REPORT_MARKDOWN,
  VALID_PLAN_MARKDOWN,
  VALID_REVIEW_MARKDOWN,
} from "./feature-delivery-gate-fixtures.js";
import {
  assertAdvanceArtifacts,
  mergedTestStageVerdict,
  parseComplianceVerdict,
  parseDesignQaVerdict,
  parseQaVerdict,
  requiredArtifactsAfterStageWork,
  stageArtifactContract,
  validateStageCompletionArtifacts,
} from "./feature-delivery-stage-artifacts.js";

const sampleState = {
  featureId: "demo-feature",
  artifacts: {
    runDir: ".pan/work/172996_05-10-26/38670_1315_demo-feature",
    handoffFile: ".pan/work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
  },
};

describe("feature-delivery-stage-artifacts", () => {
  it("plan stage requires consolidated outputs after work and three for advance", () => {
    const contract = stageArtifactContract(sampleState, "plan");
    expect(contract.primaryArtifact).toMatch(/touch-set\.json$/u);
    expect(contract.requiredAfterStageWork).toEqual(
      planStageRequiredArtifactRels(
        sampleState.artifacts.runDir,
        sampleState.featureId,
      ),
    );
    expect(contract.acceptedAdvanceArtifacts).toEqual([
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/plan.md",
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
    ]);
  });

  it("plan stage always requires ux-spec in the consolidated flow", () => {
    const contract = stageArtifactContract(
      {
        ...sampleState,
        options: { designSteps: true, designStepsSource: "pancreator_yaml" },
      },
      "plan",
    );
    expect(contract.requiredAfterStageWork).toContain(
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/ux-spec.md",
    );
  });

  it("test stage requires design-qa-report when design steps are on", () => {
    const contract = stageArtifactContract(
      {
        ...sampleState,
        options: { designSteps: true, designStepsSource: "spec_frontmatter" },
      },
      "test",
    );
    expect(contract.requiredAfterStageWork).toEqual([
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/test-report.md",
      ".pan/work/172996_05-10-26/38670_1315_demo-feature/design-qa-report.md",
    ]);
  });

  it("validateStageCompletionArtifacts detects partial plan output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-artifacts-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "touch-set.json"),
      stringifyCompactJson({
        paths: [],
        tests: [],
        shared_paths: [],
        integration_prerequisites: [],
        acceptance_criteria: [],
        manual_qa_test_cases: [],
      }),
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "plan",
    );
    expect(validation.ok).toBe(false);
    expect(validation.warningCount).toBe(0);
    expect(validation.missing).toEqual(
      planStageRequiredArtifactRels(
        sampleState.artifacts.runDir,
        sampleState.featureId,
      ).filter((rel) => !rel.endsWith("/touch-set.json")),
    );
  });

  it("assertAdvanceArtifacts rejects advance when adr-draft.md is missing", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "pan-stage-advance-adr-"),
    );
    await seedPlanStageAdvanceArtifacts(
      root,
      sampleState.artifacts.runDir,
      sampleState.featureId,
    );
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(root, sampleState.artifacts.runDir, "adr-draft.md"));

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "plan",
        ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
        "human_approval",
      ),
    ).toThrow(/adr-draft\.md/u);
  });

  it("assertAdvanceArtifacts rejects advance when plan.md is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-advance-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "touch-set.json"), "{}", "utf8");
    await writeFile(path.join(runAbs, "handoff.md"), "# handoff", "utf8");

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "plan",
        ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
        "human_approval",
      ),
    ).toThrow(/plan\.md/u);
  });

  it("validateStageCompletionArtifacts warns on malformed review.md content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-content-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      "# review\n\nno verdict line\n",
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "review",
    );
    expect(validation.missing).toEqual([]);
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("review_passes_unparseable");
  });

  it("treats prose-only review verdicts as unparseable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-review-prose-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      "# review\n\n`review_passes: false`, `scope_amendments_ratified: true`\n",
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("review_passes_unparseable");
  });

  it("requires scope_amendments_ratified as a dedicated review field", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-review-scope-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "review.md"), "review_passes: true\n", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("review_scope_unparseable");
  });

  it("AC-P7: validateStageCompletionArtifacts reports one warning for malformed review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p7-malformed-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      "# review\n\nno verdict line\n",
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "review",
    );
    expect(validation.warningCount).toBe(1);
    expect(validation.missing).toEqual([]);
  });

  it("AC-P7: validateStageCompletionArtifacts reports zero warnings for valid review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p7-valid-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      VALID_REVIEW_MARKDOWN,
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "review",
    );
    expect(validation.warningCount).toBe(0);
  });

  it("validateStageCompletionArtifacts is clean for valid review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-content-ok-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      VALID_REVIEW_MARKDOWN,
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "review",
    );
    expect(validation.warningCount).toBe(0);
  });

  it("requiredArtifactsAfterStageWork covers every pipeline stage", () => {
    for (const stage of [
      "plan",
      "implement",
      "review",
      "test",
      "report",
      "compliance",
      "ship",
      "index",
    ]) {
      expect(
        requiredArtifactsAfterStageWork(sampleState, stage).length,
      ).toBeGreaterThan(0);
    }
  });

  it("compliance stage contract supports pass, fail, and spot-fix events", () => {
    expect(
      stageArtifactContract(sampleState, "compliance", "compliance_passes")
        .primaryArtifact,
    ).toMatch(/compliance-result\.json$/u);
    expect(
      stageArtifactContract(sampleState, "compliance", "compliance_fails")
        .primaryArtifact,
    ).toMatch(/compliance-result\.json$/u);
    expect(
      stageArtifactContract(sampleState, "compliance", "compliance_spot_fix")
        .primaryArtifact,
    ).toMatch(/compliance-result\.json$/u);
  });

  it("assertAdvanceArtifacts rejects plan advance without acceptance criteria", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-plan-gate-"));
    await seedPlanStageAdvanceArtifacts(
      root,
      sampleState.artifacts.runDir,
      sampleState.featureId,
    );
    await writeFile(
      path.join(root, sampleState.artifacts.runDir, "touch-set.json"),
      stringifyCompactJson({
        paths: [],
        tests: [],
        shared_paths: [],
        integration_prerequisites: [],
        manual_qa_test_cases: [],
      }),
      "utf8",
    );

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "plan",
        ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
        "human_approval",
      ),
    ).toThrow(/acceptance_criteria array/u);
  });

  it("assertAdvanceArtifacts rejects review_spot_fix without justification", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-spot-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "review.md"),
      "review_passes: false\nscope_amendments_ratified: true\nspot_fixable: true\n\n## Fixes applied\n- clarified review artifact wording\n",
      "utf8",
    );

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "review",
        ".pan/work/172996_05-10-26/38670_1315_demo-feature/review.md",
        "review_spot_fix",
      ),
    ).toThrow(/spot_fix_scope/u);
  });

  it("accepts plan criteria delegated to referenced acceptance-criteria docs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-plan-delegated-ac-"));
    await seedPlanStageAdvanceArtifacts(
      root,
      sampleState.artifacts.runDir,
      sampleState.featureId,
    );
    const delegatedPlan = VALID_PLAN_MARKDOWN.replace(
      "1. AC-1: behavior verified.",
      [
        "- `P-AC-01` through `P-AC-06` from `product/acceptance-criteria.md` apply.",
        "- `D-AC-01` through `D-AC-09` from `design/acceptance-criteria.md` apply.",
        "- `T-AC-01` through `T-AC-09` from `tech/acceptance-criteria.md` apply.",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, sampleState.artifacts.runDir, "plan.md"),
      delegatedPlan,
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(root, sampleState, "plan");
    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual([]);
  });

  it("assertAdvanceArtifacts rejects implement advance without implement_gate_passes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-implement-gate-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "implementation-report.md"),
      VALID_IMPLEMENTATION_REPORT_MARKDOWN
        .replace("implement_gate_passes: true", "implement_gate_passes: false")
        .replace("- definition_of_done: pass", "- definition_of_done: fail")
        .replace("- gate_decision: advance", "- gate_decision: hold"),
      "utf8",
    );

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "implement",
        ".pan/work/172996_05-10-26/38670_1315_demo-feature/implementation-report.md",
        "implementation_complete",
      ),
    ).toThrow(/implement_gate_passes: true/u);
  });

  it("validateStageCompletionArtifacts rejects path-style consulted_docs in compliance-result.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-compliance-manifest-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "compliance-result.json"),
      stringifyCompactJson({
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
        output_manifest: {
          persona_contract: "PERSONA.COMPLIANCE_AUDITOR",
          stage_contract: "PIPE.FEATURE_DELIVERY.COMPLIANCE",
          required_docs: [
            "DOC.AGENTS",
            "DOC.REGISTRY",
            "DOC.PERSONA_CONTRACTS",
            "DOC.OUTPUT_MANIFEST",
            "DOC.PIPELINE_STATE",
            "DOC.COMPLIANCE_RUNS",
            "DOC.RUN_LOG_SCHEMA",
          ],
          consulted_docs: ["AGENTS.md"],
          produced_artifacts: [".pan/work/day/task/compliance-result.json"],
          scope_amendments: [],
          validation: [{ name: "gate", result: "pass" }],
          definition_of_done: "pass",
          gate_decision: "advance",
          remediation_route: "none",
        },
      }),
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "compliance",
    );
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("output_manifest_noncompliant");
  });

  it("validateStageCompletionArtifacts rejects conflicting implementation verdicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-implement-conflict-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "implementation-report.md"),
      `${VALID_IMPLEMENTATION_REPORT_MARKDOWN}\nimplement_gate_passes: false\n`,
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "implement",
    );
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("verdict_conflict");
  });

  it("validateStageCompletionArtifacts rejects pass verdicts paired with remediate manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-design-qa-conflict-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "design-qa-report.md"),
      [
        "design_qa_passes: true",
        "",
        "## Findings",
        "",
        "- P1: duplicate primary CTA remains",
        "",
        "## Output manifest",
        "",
        "- persona_contract: PERSONA.DESIGN_REVIEWER",
        "- stage_contract: PIPE.FEATURE_DELIVERY.TEST",
        "- required_docs: DOC.AGENTS, DOC.REGISTRY, DOC.OUTPUT_MANIFEST",
        "- consulted_docs: DOC.AGENTS, DOC.REGISTRY, DOC.OUTPUT_MANIFEST",
        "- produced_artifacts: .pan/work/day/task/design-qa-report.md",
        "- scope_amendments: none",
        "- validation: none",
        "- definition_of_done: pass",
        "- gate_decision: remediate",
        "- remediation_route: PERSONA.CODER",
      ].join("\n"),
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(
      root,
      sampleState,
      "test",
    );
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("verdict_conflict");
  });

  it("parseDesignQaVerdict infers excluded_from_gate for browser lock blockers", () => {
    const verdict = parseDesignQaVerdict(
      [
        "design_qa_passes: false",
        "excluded_from_gate: false",
        "MCP error: The browser is already running for /Users/alen/.cache/chrome-devtools-mcp/chrome-profile.",
        "Use --isolated to run multiple browser instances.",
      ].join("\n"),
    );
    expect(verdict.passes).toBe(false);
    expect(verdict.excludedFromGate).toBe(true);
  });

  it("parseDesignQaVerdict reads inline verdict fields in prose", () => {
    const verdict = parseDesignQaVerdict(
      "`design_qa_passes: true`, `plan_invalidating: false`, `excluded_from_gate: false`",
    );
    expect(verdict.passes).toBe(true);
    expect(verdict.planInvalidating).toBe(false);
    expect(verdict.excludedFromGate).toBe(false);
  });

  it("parseQaVerdict reads inline verdict fields in prose", () => {
    const verdict = parseQaVerdict(
      "## Verdict\n`qa_passes: true`, `plan_invalidating: false`, `excluded_from_gate: false`",
    );
    expect(verdict.passes).toBe(true);
    expect(verdict.planInvalidating).toBe(false);
    expect(verdict.excludedFromGate).toBe(false);
  });

  it("parseQaVerdict infers excluded_from_gate for browser lock blockers", () => {
    const verdict = parseQaVerdict(
      [
        "qa_passes: false",
        "core_reentry_required: true",
        "excluded_from_gate: false",
        "chrome-devtools:list_pages fails on a locked shared profile",
        "The browser is already running for /Users/alen/.cache/chrome-devtools-mcp/chrome-profile.",
        "Use --isolated to run multiple browser instances.",
      ].join("\n"),
    );
    expect(verdict.passes).toBe(false);
    expect(verdict.excludedFromGate).toBe(true);
    expect(verdict.coreReentryRequired).toBe(false);
  });

  it("mergedTestStageVerdict treats excluded qa blockers as follow-up only", () => {
    const verdict = mergedTestStageVerdict({
      qaMarkdown: [
        "qa_passes: false",
        "plan_invalidating: false",
        "core_reentry_required: false",
        "spot_fixable: false",
        "excluded_from_gate: true",
      ].join("\n"),
      designQaMarkdown: "design_qa_passes: true\n",
      designSteps: true,
    });
    expect(verdict.designFollowupOnly).toBe(true);
    expect(verdict.passes).toBe(false);
  });

  it("parseComplianceVerdict reads final gate command statuses", () => {
    const verdict = parseComplianceVerdict(
      stringifyCompactJson({
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 1,
        },
      }),
    );
    expect(verdict.passes).toBe(true);
    expect(verdict.finalGateObserved).toBe(true);
    expect(verdict.failingFinalGateCommands).toContain(
      "node --test tests/*.test.mjs",
    );
  });
});
