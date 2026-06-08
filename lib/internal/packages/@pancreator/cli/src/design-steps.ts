import { resolvePancreatorYamlPath, resolveProjectPath } from "@pancreator/core";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DesignStepsSource = "pancreator_yaml" | "spec_frontmatter";

export interface DesignStepsConfig {
  designSteps: boolean;
  designStepsSource: DesignStepsSource;
}

export interface FeatureDeliveryDesignOptions {
  designSteps: boolean;
  designStepsSource: DesignStepsSource;
}

export function uxSpecRel(featureId: string): string {
  return path.posix.join("lib", "memory", "features", featureId, "ux-spec.md");
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

export const DESIGN_ENGINEER_PERSONA = "design-engineer" as const;
export const DESIGN_REVIEWER_PERSONA = "design-reviewer" as const;

function parseYamlFrontmatterBoolean(raw: string, key: string): boolean | undefined {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (fence === null) {
    return undefined;
  }
  const match = new RegExp(`^${key}:\\s*(true|false)\\s*$`, "imu").exec(fence[1]!);
  if (match === null) {
    return undefined;
  }
  return match[1]!.toLowerCase() === "true";
}

function readPancreatorYamlDesignSteps(raw: string): boolean {
  const blockMatch = /feature_delivery:\s*\n([\s\S]*?)(?=\n\S|\n$|$)/u.exec(raw);
  const block = blockMatch?.[1] ?? "";
  const match = /design_steps:\s*(true|false)/u.exec(block);
  if (match === null) {
    return false;
  }
  return match[1] === "true";
}

/** Resolves design-step toggle: spec frontmatter overrides pancreator.yaml default. */
export async function resolveDesignStepsConfig(
  repoRoot: string,
  featureId: string,
): Promise<DesignStepsConfig> {
  let designSteps = false;
  let designStepsSource: DesignStepsSource = "pancreator_yaml";

  const cfgPath = resolvePancreatorYamlPath(repoRoot);
  if (cfgPath !== undefined) {
    const raw = await readFile(cfgPath, "utf8");
    designSteps = readPancreatorYamlDesignSteps(raw);
  }

  const specPath = resolveProjectPath(repoRoot, "lib", "memory", "features", featureId, "spec.md");
  if (existsSync(specPath)) {
    const specRaw = readFileSync(specPath, "utf8");
    const specOverride = parseYamlFrontmatterBoolean(specRaw, "design_steps");
    if (specOverride !== undefined) {
      designSteps = specOverride;
      designStepsSource = "spec_frontmatter";
    }
  }

  return { designSteps, designStepsSource };
}

export function designStepsEnabled(
  options: FeatureDeliveryDesignOptions | undefined,
): boolean {
  return options?.designSteps === true;
}

export function renderDesignPlanPrompt(input: {
  featureId: string;
  taskId: string;
  runDir: string;
  specPath: string;
}): string {
  const uxSpec = uxSpecRel(input.featureId);
  return `# Design-plan companion — ${input.taskId}

You are \`design-engineer\` in design-plan companion mode for feature \`${input.featureId}\`.

## Input

- Engineering spec: \`${input.specPath}\`

## Output

- UX spec: \`${uxSpec}\`

## Instructions

1. Read the engineering spec and extract UX-relevant requirements.
2. Emit \`${uxSpec}\` per \`lib/personas/design-engineer.md\` design-plan mode.
3. Do not emit plan-stage artifacts; \`tech-lead\` consolidates after you finish.

When complete, the runner or operator delegates \`tech-lead\` with \`${path.posix.join(input.runDir, "next-prompt.md")}\`.
`;
}

export function renderDesignQaPrompt(input: {
  featureId: string;
  taskId: string;
  runDir: string;
}): string {
  const uxSpec = uxSpecRel(input.featureId);
  const designReport = designQaReportRel(input.runDir);
  return `# Design-QA companion — ${input.taskId}

You are \`design-reviewer\` in design-QA companion mode for feature \`${input.featureId}\`.

## Inputs

- UX spec: \`${uxSpec}\`
- Touch-set: \`${path.posix.join(input.runDir, "touch-set.json")}\`
- Review: \`${path.posix.join(input.runDir, "review.md")}\`
- Handoff: \`${path.posix.join(input.runDir, "handoff.md")}\`

## Output

- Design QA report: \`${designReport}\`

## Instructions

1. Run Browser MCP inspections against relevant pages and interactions declared in the ux-spec and touch-set.
2. Emit \`${designReport}\` with \`design_qa_passes: true\` or \`design_qa_passes: false\` and prioritized, typed recommendations per \`lib/personas/design-reviewer.md\`.
3. Run in parallel with \`qa-tester\`; the test gate requires both functional QA and design QA to pass.
`;
}
