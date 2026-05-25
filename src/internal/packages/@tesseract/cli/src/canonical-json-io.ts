import {
  abbreviateHashes,
  formatCanonicalJson,
  resolveAbbrevLen,
} from "../../../../tools/canonical-json-format.mjs";

/** Emit terminal / state-machine JSON using repo-local short-hash abbreviation length and canonical indentation. */
export function stringifyCliJson(repoRoot: string, value: unknown): string {
  const len = resolveAbbrevLen(repoRoot);
  const abbreviated = abbreviateHashes(value, len);
  return `${formatCanonicalJson(abbreviated, 0)}\n`;
}
