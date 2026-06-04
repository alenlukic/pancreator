import {
  deepCloneJson,
  quoteJsonString,
  stringifyCompactJson,
  stringifyRepoJson,
} from "@pancreator/core";

export { deepCloneJson, quoteJsonString, stringifyCompactJson };

/** Emit terminal / state-machine JSON using repo-local short-hash abbreviation length and canonical indentation. */
export function stringifyCliJson(repoRoot: string, value: unknown): string {
  return stringifyRepoJson(value, repoRoot);
}
