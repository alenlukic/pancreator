import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Builds delivery AGENTS.md from the package harness agent operating card. */
export function loadDeliveryAgentsTemplate(packageHarnessRoot: string): string {
  const agentsPath = path.join(packageHarnessRoot, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    return "# AGENTS.md — Agent operating card\n\nSee OPERATION.md for human procedures.\n";
  }
  return readFileSync(agentsPath, "utf8");
}

/** Copies external OPERATION.md from the package harness for embedded/greenfield seeds. */
export function loadOperationTemplate(packageHarnessRoot: string): string {
  const opPath = path.join(packageHarnessRoot, "OPERATION.md");
  if (!existsSync(opPath)) {
    return "# Pancreator operator how-to\n\nSee AGENTS.md for agent operating instructions.\n";
  }
  return readFileSync(opPath, "utf8");
}

export const PANCREATOR_AUGMENT_MARKER = "<!-- pancreator-harness-augment -->";

export function pancreatorHostAugmentBlock(): string {
  return `${PANCREATOR_AUGMENT_MARKER}

## Pancreator harness

This repository embeds Pancreator under \`.pancreator/\`.

- Agent operating card: \`.pancreator/AGENTS.md\`
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

[Operator guide](OPERATION.md)

Agent operating instructions live in \`AGENTS.md\` (explicit-read).
`;
}
