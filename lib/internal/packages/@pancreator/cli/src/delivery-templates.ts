import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DELIVERY_HEADING = "## Delivery operating card";

/** Builds delivery-card AGENTS.md body from package README appendix. */
export function loadDeliveryAgentsTemplate(packageHarnessRoot: string): string {
  const readmePath = path.join(packageHarnessRoot, "README.md");
  if (!existsSync(readmePath)) {
    return "# AGENTS.md — Delivery operating card\n\nSee OPERATION.md for procedures.\n";
  }
  const readme = readFileSync(readmePath, "utf8");
  const idx = readme.indexOf(DELIVERY_HEADING);
  if (idx < 0) {
    return "# AGENTS.md — Delivery operating card\n\nSee OPERATION.md for procedures.\n";
  }
  const body = readme.slice(idx + DELIVERY_HEADING.length).trim();
  return `# AGENTS.md — Delivery operating card

> Cross-tool delivery contract (Linux Foundation Agentic AI Foundation).

${body}
`;
}

/** Copies external OPERATION.md from the package harness for embedded/greenfield seeds. */
export function loadOperationTemplate(packageHarnessRoot: string): string {
  const opPath = path.join(packageHarnessRoot, "OPERATION.md");
  if (!existsSync(opPath)) {
    return "# Pancreator operator how-to\n\nSee AGENTS.md for delivery operating contract.\n";
  }
  return readFileSync(opPath, "utf8");
}

export const PANCREATOR_AUGMENT_MARKER = "<!-- pancreator-harness-augment -->";

export function pancreatorHostAugmentBlock(): string {
  return `${PANCREATOR_AUGMENT_MARKER}

## Pancreator harness

This repository embeds Pancreator under \`.pancreator/\`.

- Delivery operating card: \`.pancreator/AGENTS.md\`
- Operator procedures: \`.pancreator/OPERATION.md\`
- Invoke stage personas at harness root: \`/coder\`, \`/tech-lead\`, etc. (see \`.cursor/agents/\`)
- Feature delivery inbox paths are relative to \`.pancreator/lib/inbox/in/\`
`;
}

/** Appends the Pancreator pointer block to host AGENTS.md when absent. */
export function augmentHostAgentsContent(existing: string): string {
  if (existing.includes(PANCREATOR_AUGMENT_MARKER)) {
    return existing;
  }
  return `${existing.trimEnd()}\n\n${pancreatorHostAugmentBlock()}`;
}

/** Short greenfield README landing page. */
export function greenfieldReadmeTemplate(projectName: string): string {
  return `# ${projectName}

Pancreator-powered agentic delivery.

[Delivery operating card](AGENTS.md) · [Operator guide](OPERATION.md)
`;
}
