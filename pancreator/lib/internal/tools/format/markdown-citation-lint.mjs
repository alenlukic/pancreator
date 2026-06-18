/** @typedef {{ rule: string; line: number }} CitationViolation */

/** Flags single-line `{ ... "kind": "lines"|"symbol" ... }` dual-anchor blobs. */
export const COMPACT_DUAL_ANCHOR_INNER =
  /\{[^}\n\r]*"kind"\s*:\s*"(?:symbol|lines)"[^}\n\r]*"contentHash"\s*:/u;

/** Flags JS object-literal dual-anchor form `{kind: lines, ...}`. */
export const JS_LITERAL_CITATION = /\{kind:\s*(?:'|lines|symbol)/u;

/**
 * @param {string} text
 * @param {number} index
 */
function findLineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {number[]}
 */
function listPatternHitLines(text, pattern) {
  const rx = pattern.flags.includes("g")
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
  /** @type {number[]} */
  const lines = [];
  for (const match of text.matchAll(rx)) {
    if (match.index === undefined) continue;
    lines.push(findLineNumber(text, match.index));
  }
  return lines;
}

/**
 * @param {string} text
 * @returns {{ ok: boolean; violations: CitationViolation[] }}
 */
export function lintDeliveryReportCitations(text) {
  /** @type {CitationViolation[]} */
  const violations = [];
  for (const line of listPatternHitLines(text, JS_LITERAL_CITATION)) {
    violations.push({ rule: "js-literal-citation", line });
  }
  for (const line of listPatternHitLines(text, COMPACT_DUAL_ANCHOR_INNER)) {
    violations.push({ rule: "compact-dual-anchor", line });
  }
  violations.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return { ok: violations.length === 0, violations };
}

/**
 * @param {string} text
 * @param {string} repoRelPath
 * @returns {string}
 */
export function formatDeliveryReportCitationError(text, repoRelPath) {
  const { violations } = lintDeliveryReportCitations(text);
  if (violations.length === 0) return "";
  const detail = violations
    .map((v) => `${v.rule} at line ${v.line}`)
    .join("; ");
  return (
    `Delivery report ${repoRelPath} has forbidden citation form (${detail}). ` +
    "Use fenced canonical JSON with double-quoted keys per lib/personas/tech-writer.md §Conformance gates."
  );
}
