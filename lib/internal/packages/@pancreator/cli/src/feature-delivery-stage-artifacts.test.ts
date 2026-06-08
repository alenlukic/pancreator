import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringifyCompactJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

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
    runDir: "work/172996_05-10-26/38670_1315_demo-feature",
    handoffFile: "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
  },
};

describe("feature-delivery-stage-artifacts", () => {
  it("plan stage requires four outputs after work and three for advance", () => {
    const contract = stageArtifactContract(sampleState, "plan");
    expect(contract.primaryArtifact).toMatch(/touch-set\.json$/u);
    expect(contract.requiredAfterStageWork).toEqual([
      "work/172996_05-10-26/38670_1315_demo-feature/plan.md",
      "work/172996_05-10-26/38670_1315_demo-feature/adr-draft.md",
      "work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
      "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
    ]);
    expect(contract.acceptedAdvanceArtifacts).toEqual([
      "work/172996_05-10-26/38670_1315_demo-feature/plan.md",
      "work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
      "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
    ]);
  });

  it("plan stage requires ux-spec when design steps are on", () => {
    const contract = stageArtifactContract(
      {
        ...sampleState,
        options: { designSteps: true, designStepsSource: "pancreator_yaml" },
      },
      "plan",
    );
    expect(contract.requiredAfterStageWork[0]).toBe("lib/memory/features/demo-feature/ux-spec.md");
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
      "work/172996_05-10-26/38670_1315_demo-feature/test-report.md",
      "work/172996_05-10-26/38670_1315_demo-feature/design-qa-report.md",
    ]);
  });

  it("validateStageCompletionArtifacts detects partial plan output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-artifacts-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "touch-set.json"), "{}", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "plan");
    expect(validation.ok).toBe(false);
    expect(validation.warningCount).toBe(0);
    expect(validation.missing).toEqual([
      "work/172996_05-10-26/38670_1315_demo-feature/plan.md",
      "work/172996_05-10-26/38670_1315_demo-feature/adr-draft.md",
      "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
    ]);
  });

  it("assertAdvanceArtifacts rejects advance when adr-draft.md is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-advance-adr-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "plan.md"), "# Plan\n\n## Scope\n\nBody.\n", "utf8");
    await writeFile(path.join(runAbs, "touch-set.json"), "{}", "utf8");
    await writeFile(path.join(runAbs, "handoff.md"), "# handoff", "utf8");

    expect(() =>
      assertAdvanceArtifacts(
        root,
        sampleState,
        "plan",
        "work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
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
        "work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
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
      "intake",
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
