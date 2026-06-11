import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import {
  planStageRequiredArtifactRels,
  seedPlanStageAdvanceArtifacts,
} from "./feature-delivery-gate-fixtures.js";
import {
  assertAdvanceArtifacts,
  parseComplianceVerdict,
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
      planStageRequiredArtifactRels(sampleState.artifacts.runDir, sampleState.featureId),
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
    expect(contract.requiredAfterStageWork).toContain(".pan/work/172996_05-10-26/38670_1315_demo-feature/ux-spec.md");
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
      stringifyCompactJson({ paths: [], tests: [], shared_paths: [], integration_prerequisites: [], acceptance_criteria: [], manual_qa_test_cases: [] }),
      "utf8",
    );

    const validation = validateStageCompletionArtifacts(root, sampleState, "plan");
    expect(validation.ok).toBe(false);
    expect(validation.warningCount).toBe(0);
    expect(validation.missing).toEqual(
      planStageRequiredArtifactRels(sampleState.artifacts.runDir, sampleState.featureId).filter(
        (rel) => !rel.endsWith("/touch-set.json"),
      ),
    );
  });

  it("assertAdvanceArtifacts rejects advance when adr-draft.md is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-advance-adr-"));
    await seedPlanStageAdvanceArtifacts(root, sampleState.artifacts.runDir, sampleState.featureId);
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
    await writeFile(path.join(runAbs, "review.md"), "# review\n\nno verdict line\n", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
    expect(validation.missing).toEqual([]);
    expect(validation.warningCount).toBe(1);
    expect(validation.warnings[0]?.code).toBe("review_passes_unparseable");
  });

  it("AC-P7: validateStageCompletionArtifacts reports one warning for malformed review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p7-malformed-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "review.md"), "# review\n\nno verdict line\n", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
    expect(validation.warningCount).toBe(1);
    expect(validation.missing).toEqual([]);
  });

  it("AC-P7: validateStageCompletionArtifacts reports zero warnings for valid review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p7-valid-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "review.md"), "review_passes: true\n", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
    expect(validation.warningCount).toBe(0);
  });

  it("validateStageCompletionArtifacts is clean for valid review.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-content-ok-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "review.md"), "review_passes: true\n", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "review");
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
      expect(requiredArtifactsAfterStageWork(sampleState, stage).length).toBeGreaterThan(0);
    }
  });

  it("compliance stage contract supports pass, fail, and spot-fix events", () => {
    expect(stageArtifactContract(sampleState, "compliance", "compliance_passes").primaryArtifact).toMatch(
      /compliance-result\.json$/u,
    );
    expect(stageArtifactContract(sampleState, "compliance", "compliance_fails").primaryArtifact).toMatch(
      /compliance-result\.json$/u,
    );
    expect(stageArtifactContract(sampleState, "compliance", "compliance_spot_fix").primaryArtifact).toMatch(
      /compliance-result\.json$/u,
    );
  });

  it("assertAdvanceArtifacts rejects plan advance without acceptance criteria", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-plan-gate-"));
    await seedPlanStageAdvanceArtifacts(root, sampleState.artifacts.runDir, sampleState.featureId);
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
    await writeFile(path.join(runAbs, "review.md"), "review_passes: false\nspot_fixable: true\n", "utf8");

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

  it("assertAdvanceArtifacts rejects implement advance without implement_gate_passes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-implement-gate-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "implementation-report.md"),
      [
        "implement_gate_passes: false",
        "## Automated checks",
        "pnpm lint",
        "pnpm typecheck",
        "pnpm test",
        "## Coverage delta",
        "statement: 0%",
      ].join("\n"),
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
    expect(verdict.failingFinalGateCommands).toContain("node --test tests/*.test.mjs");
  });
});
