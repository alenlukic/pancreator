import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectPath } from "@pancreator/core";
import { parseSimpleYaml } from "./simple-yaml.js";

export const PRODUCT_ENGINEER_PERSONA = "product-engineer" as const;
export const DESIGN_ENGINEER_PERSONA = "design-engineer" as const;
export const DESIGN_REVIEWER_PERSONA = "design-reviewer" as const;

export interface FeatureDeliveryDesignOptions {
  designSteps?: boolean;
  designStepsSource?: "pancreator_yaml" | "spec_frontmatter";
}

export function designStepsEnabled(_options: FeatureDeliveryDesignOptions | undefined): boolean {
  // Feature-delivery now treats product/design/technical planning and design QA
  // as core flow. The option is retained only as state provenance for older
  // ledgers and config compatibility.
  return true;
}

function readYamlBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end < 0) return {};
  return parseSimpleYaml(content.slice(4, end)) as Record<string, unknown>;
}

async function readOptionalText(pathAbs: string): Promise<string | null> {
  try {
    return await readFile(pathAbs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function resolveDesignStepsConfig(repoRoot: string, featureId: string): Promise<Required<FeatureDeliveryDesignOptions>> {
  const pancreatorYaml = await readOptionalText(resolveProjectPath(repoRoot, "pancreator.yaml"));
  let designSteps = false;
  let source: Required<FeatureDeliveryDesignOptions>["designStepsSource"] = "pancreator_yaml";
  if (pancreatorYaml !== null) {
    const parsed = parseSimpleYaml(pancreatorYaml) as Record<string, unknown>;
    const featureDelivery = parsed.feature_delivery;
    if (featureDelivery !== null && typeof featureDelivery === "object" && !Array.isArray(featureDelivery)) {
      designSteps = readYamlBoolean(featureDelivery as Record<string, unknown>, "design_steps") ?? designSteps;
    }
  }

  const spec = await readOptionalText(resolveProjectPath(repoRoot, "lib", "memory", "features", featureId, "spec.md"));
  if (spec !== null) {
    const frontmatter = parseFrontmatter(spec);
    const specDesignSteps = readYamlBoolean(frontmatter, "design_steps");
    if (specDesignSteps !== undefined) {
      designSteps = specDesignSteps;
      source = "spec_frontmatter";
    }
  }
  return { designSteps, designStepsSource: source };
}

export function uxSpecRel(featureId: string): string {
  return path.posix.join("lib", "memory", "features", featureId, "ux-spec.md");
}

export function productPlanPromptRel(runDir: string): string {
  return path.posix.join(runDir, "product-plan-prompt.md");
}

export function designPlanPromptRel(runDir: string): string {
  return path.posix.join(runDir, "design-plan-prompt.md");
}

export function designQaPromptRel(runDir: string): string {
  return path.posix.join(runDir, "design-qa-prompt.md");
}

export function designQaReportRel(runDir: string): string {
  return path.posix.join(runDir, "design-qa-report.md");
}

export function productPlanRel(runDir: string): string {
  return path.posix.join(runDir, "product-plan.md");
}

export function productAcceptanceCriteriaRel(runDir: string): string {
  return path.posix.join(runDir, "product-acceptance-criteria.md");
}

export function designPlanRel(runDir: string): string {
  return path.posix.join(runDir, "design-plan.md");
}

export function designAcceptanceCriteriaRel(runDir: string): string {
  return path.posix.join(runDir, "design-acceptance-criteria.md");
}

export function techPlanRel(runDir: string): string {
  return path.posix.join(runDir, "tech-plan.md");
}

export function techAcceptanceCriteriaRel(runDir: string): string {
  return path.posix.join(runDir, "tech-acceptance-criteria.md");
}

export function manualQaTestCasesRel(runDir: string): string {
  return path.posix.join(runDir, "manual-qa-test-cases.md");
}

export function renderProductPlanPrompt(input: {
  featureId: string;
  taskId: string;
  runDir: string;
  sourcePath: string;
  specPath?: string;
}): string {
  return `# Product-plan companion prompt — ${input.featureId}

You are \`${PRODUCT_ENGINEER_PERSONA}\`. Read \`lib/personas/product-engineer.md\`, the source directive at \`${input.sourcePath}\`, active state at \`${path.posix.join(input.runDir, "state.json")}\`${input.specPath ? `, and \`${input.specPath}\` when present` : ""}.

Emit exactly these artifacts:

- \`${productPlanRel(input.runDir)}\`
- \`${productAcceptanceCriteriaRel(input.runDir)}\`

The artifacts MUST define product behavior, edge cases, scope/non-goals, a product implementation plan, and \`P-AC-\` criteria specific enough for a less sophisticated implementation model to execute without product re-planning. Do not write source code, tests, technical plans, design plans, or touch-set files.
`;
}

export function renderDesignPlanPrompt(input: {
  featureId: string;
  taskId: string;
  runDir: string;
  sourcePath: string;
  specPath?: string;
}): string {
  return `# Design-plan companion prompt — ${input.featureId}

You are \`${DESIGN_ENGINEER_PERSONA}\`. Read \`lib/personas/design-engineer.md\`, \`lib/memory/handbook/engineering/design-craft.md\`, the source directive at \`${input.sourcePath}\`${input.specPath ? `, \`${input.specPath}\` when present` : ""}, active state at \`${path.posix.join(input.runDir, "state.json")}\`, and \`${productPlanRel(input.runDir)}\` when present.

Emit exactly these artifacts:

- \`${designPlanRel(input.runDir)}\`
- \`${designAcceptanceCriteriaRel(input.runDir)}\`
- \`${uxSpecRel(input.featureId)}\`

The design plan and \`D-AC-\` criteria MUST be specific enough for a less sophisticated implementation model to execute without design re-planning. Keep the UX spec aligned with the taste profile, the holistic craft bar, and Mobbin-fidelity orientation-panel standards from \`design-craft.md\`. Do not run design QA; \`${DESIGN_REVIEWER_PERSONA}\` owns that during test.
`;
}

export function renderDesignQaPrompt(input: {
  featureId: string;
  taskId: string;
  runDir: string;
}): string {
  return `# Design-QA companion prompt — ${input.featureId}

You are \`${DESIGN_REVIEWER_PERSONA}\`. Read \`lib/personas/design-reviewer.md\`, \`lib/memory/handbook/engineering/design-craft.md\`, \`${uxSpecRel(input.featureId)}\`, \`${designPlanRel(input.runDir)}\`, \`${designAcceptanceCriteriaRel(input.runDir)}\`, \`${path.posix.join(input.runDir, "review.md")}\`, and the current local diff.

Run global UI/UX/design rules QA with the Chrome DevTools MCP server. Your gate enforces holistic craft bar, spacing, hierarchy, interaction states, accessibility basics, responsive behavior, copy clarity, and global UI/UX/design rules. Do NOT gate task-specific product/design/technical acceptance criteria; reviewer and qa-tester own those. Use the plan only to locate affected surfaces.

Emit exactly one artifact at \`${designQaReportRel(input.runDir)}\` with \`design_qa_passes: true\` or \`design_qa_passes: false\`. The test stage combines this with \`test-report.md\` via \`mergedTestStageVerdict\`, so design QA failure blocks the pipeline and routes back to coder unless \`plan_invalidating: true\` is explicitly justified.
`;
}
