import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESIGN_ENGINEER_PERSONA,
  DESIGN_REVIEWER_PERSONA,
  renderDesignPlanPrompt,
  renderDesignQaPrompt,
  resolveDesignStepsConfig,
} from "./design-steps.js";
import { mergedTestStageVerdict } from "./feature-delivery-stage-artifacts.js";

describe("design-steps", () => {
  it("defaults design steps to false when unset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-design-steps-"));
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
risk_tier: medium
`,
      "utf8",
    );
    const config = await resolveDesignStepsConfig(root, "demo-feature");
    expect(config).toEqual({ designSteps: false, designStepsSource: "pancreator_yaml" });
  });

  it("reads pancreator.yaml feature_delivery.design_steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-design-steps-yaml-"));
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
feature_delivery:
  design_steps: true
`,
      "utf8",
    );
    const config = await resolveDesignStepsConfig(root, "demo-feature");
    expect(config).toEqual({ designSteps: true, designStepsSource: "pancreator_yaml" });
  });

  it("spec frontmatter design_steps overrides pancreator.yaml", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-design-steps-spec-"));
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
feature_delivery:
  design_steps: true
`,
      "utf8",
    );
    const specDir = path.join(root, "lib", "memory", "features", "demo-feature");
    await mkdir(specDir, { recursive: true });
    await writeFile(
      path.join(specDir, "spec.md"),
      `---
design_steps: false
---
# Spec
`,
      "utf8",
    );
    const config = await resolveDesignStepsConfig(root, "demo-feature");
    expect(config).toEqual({ designSteps: false, designStepsSource: "spec_frontmatter" });
  });
});

describe("design companion prompts", () => {
  it("delegates design-plan to the design-engineer plan peer", () => {
    expect(DESIGN_ENGINEER_PERSONA).toBe("design-engineer");
    const prompt = renderDesignPlanPrompt({
      featureId: "demo-feature",
      taskId: "99999_demo",
      runDir: ".pan/work/172999_01-01-26/99999_demo",
      specPath: "lib/memory/features/demo-feature/spec.md",
    });
    expect(prompt).toContain("`design-engineer`");
    expect(prompt).not.toContain("`design-reviewer`");
  });

  it("delegates design-QA to the design-reviewer test peer", () => {
    expect(DESIGN_REVIEWER_PERSONA).toBe("design-reviewer");
    const prompt = renderDesignQaPrompt({
      featureId: "demo-feature",
      taskId: "99999_demo",
      runDir: ".pan/work/172999_01-01-26/99999_demo",
    });
    expect(prompt).toContain("`design-reviewer`");
    expect(prompt).toContain("lib/personas/design-reviewer.md");
    expect(prompt).toContain("holistic craft bar");
    expect(prompt).toContain("mergedTestStageVerdict");
  });
});

describe("renderDesignPlanPrompt", () => {
  it("requires taste profile and Mobbin-fidelity orientation panels", () => {
    const prompt = renderDesignPlanPrompt({
      featureId: "demo-feature",
      taskId: "99999_demo",
      runDir: ".pan/work/172999_01-01-26/99999_demo",
      specPath: "lib/memory/features/demo-feature/spec.md",
    });
    expect(prompt).toContain("design-craft.md");
    expect(prompt).toContain("Mobbin-fidelity");
  });
});

describe("mergedTestStageVerdict", () => {
  it("requires both passes when design steps are on", () => {
    const qaPass = "qa_passes: true";
    const designFail = "design_qa_passes: false\nplan_invalidating: false";
    const verdict = mergedTestStageVerdict({
      qaMarkdown: qaPass,
      designQaMarkdown: designFail,
      designSteps: true,
    });
    expect(verdict.passes).toBe(false);
  });

  it("passes when both qa and design qa pass", () => {
    const verdict = mergedTestStageVerdict({
      qaMarkdown: "qa_passes: true",
      designQaMarkdown: "design_qa_passes: true",
      designSteps: true,
    });
    expect(verdict.passes).toBe(true);
  });

  it("ignores design qa when design steps are off", () => {
    const verdict = mergedTestStageVerdict({
      qaMarkdown: "qa_passes: true",
      designSteps: false,
    });
    expect(verdict.passes).toBe(true);
  });
});
