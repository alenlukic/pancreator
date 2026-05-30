export const CANONICAL_JSON_INDENT_SPACES: 2;
export const MAX_INLINE_ARRAY_CHARS: 96;

export function resolveAbbrevLen(repoRoot?: string): number;
export function abbreviateHashes(root: unknown, abbrevLen: number): unknown;
export function formatCanonicalJson(value: unknown, depth?: number): string;
export function rewriteJsonText(
  text: string,
  abbrevLen: number,
): { changed: boolean; output: string };
