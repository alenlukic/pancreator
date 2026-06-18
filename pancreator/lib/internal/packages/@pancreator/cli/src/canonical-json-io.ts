import {
  deepCloneJson,
  quoteJsonString,
  stringifyCompactJson,
  stringifyRepoJson,
  wrapOperatorAgentJson,
  type OperatorAgentOperatorMeta,
} from "@pancreator/core";

export { deepCloneJson, quoteJsonString, stringifyCompactJson };

/** Emit terminal / state-machine JSON using repo-local short-hash abbreviation length and canonical indentation. */
export function stringifyCliJson(repoRoot: string, value: unknown): string {
  return stringifyRepoJson(value, repoRoot);
}

/** Emit sectioned `.pan/work/**` JSON artifacts per DOC.OPERATOR_AGENT_FORMAT. */
export function stringifyPanWorkJson(
  repoRoot: string,
  payload: Record<string, unknown>,
  meta: OperatorAgentOperatorMeta,
): string {
  return stringifyCliJson(repoRoot, wrapOperatorAgentJson(meta, payload));
}
