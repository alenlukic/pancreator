import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertAdvanceArtifacts,
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

  it("validateStageCompletionArtifacts detects partial plan output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-artifacts-"));
    const runAbs = path.join(root, sampleState.artifacts.runDir);
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "touch-set.json"), "{}", "utf8");

    const validation = validateStageCompletionArtifacts(root, sampleState, "plan");
    expect(validation.ok).toBe(false);
    expect(validation.missing).toEqual([
      "work/172996_05-10-26/38670_1315_demo-feature/plan.md",
      "work/172996_05-10-26/38670_1315_demo-feature/adr-draft.md",
      "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
    ]);
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

  it("requiredArtifactsAfterStageWork covers every pipeline stage", () => {
    for (const stage of [
      "intake",
      "plan",
      "implement",
      "review",
      "test",
      "report",
      "ship",
      "index",
    ]) {
      expect(requiredArtifactsAfterStageWork(sampleState, stage).length).toBeGreaterThan(0);
    }
  });
});
