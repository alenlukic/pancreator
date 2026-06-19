import {
  parseOperatorAgentJsonText,
  sliceOperatorAgentSection,
  wrapOperatorAgentJson,
  wrapOperatorAgentMarkdown,
  type OperatorAgentOperatorMeta,
} from "@pancreator/core";

export function panWorkStateMeta(
  featureId: string,
  taskId: string,
  pipeline: string,
): OperatorAgentOperatorMeta {
  return {
    inThisFile: `Pipeline state ledger for task \`${taskId}\`.`,
    whyItMatters: `Tracks stage progress, artifact paths, and gate status for the ${pipeline} run on feature \`${featureId}\`.`,
    seeAlso: [
      "lib/memory/handbook/pipeline-state-contract.md",
      "lib/memory/handbook/operator-agent-artifact-format.md",
      "AGENTS.md",
    ],
  };
}

export function panWorkMarkdownMeta(input: {
  artifact: string;
  featureId: string;
  taskId: string;
  whyItMatters: string;
  seeAlso?: string[];
}): OperatorAgentOperatorMeta {
  return {
    inThisFile: `${input.artifact} for feature \`${input.featureId}\` (task \`${input.taskId}\`).`,
    whyItMatters: input.whyItMatters,
    seeAlso: input.seeAlso ?? [
      "lib/memory/handbook/operator-agent-artifact-format.md",
      "AGENTS.md",
    ],
  };
}

export function wrapPanWorkMarkdown(
  body: string,
  meta: OperatorAgentOperatorMeta,
): string {
  return wrapOperatorAgentMarkdown(meta, body);
}

export function wrapPanWorkJson(
  payload: Record<string, unknown>,
  meta: OperatorAgentOperatorMeta,
): Record<string, unknown> {
  return wrapOperatorAgentJson(meta, payload);
}

export function readPanWorkMarkdown(content: string): string {
  return sliceOperatorAgentSection(content);
}

export function parsePanWorkJsonText(text: string): unknown {
  return parseOperatorAgentJsonText(text);
}
