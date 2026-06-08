import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDesignStepsConfig } from "./design-steps.js";
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
