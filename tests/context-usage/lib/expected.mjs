/** @typedef {{ path: string; tier: string }} TierExpectation */

export const PROMPT_VERSION = 1;

export const EXPECTED_ANSWERS = {
  active_feature: "tier-sandbox-probe",
  handbook_anchor: "alpha-7f3c",
  product_route_token: "route-summary-only",
  handoff_stage: "implement",
  handler_export_count: 2,
};

/** Paths that MUST NOT appear in tool logs or files_read. */
export const FORBIDDEN_PATH_PATTERNS = [
  /^docs\/PRD\.md$/i,
  /^docs\/BOOTSTRAP\.md$/i,
  /^archive\/work\//i,
  /^archive\/inbox\//i,
  /^lib\/inbox\//i,
];

/** Each required read: regex on normalized posix path. */
export const REQUIRED_READ_PATTERNS = [
  /^lib\/memory\/active\/current\.md$/i,
  /^lib\/memory\/handbook\/routing\.md$/i,
  /^docs\/PRD\.summary\.md$/i,
  /^work\/99999_sandbox\/task\/handoff\.md$/i,
  /^lib\/internal\/packages\/demo-svc\/handler\.ts$/i,
];

/** Expected tier for each required-read pattern (same order as REQUIRED_READ_PATTERNS). */
export const REQUIRED_READ_TIERS = [
  "active_memory",
  "internal_operating",
  "product_context",
  "active_work",
  "source_code",
];

export const REPORT_REL_PATH = "work/99999_sandbox/task/context-usage-report.json";

export const READ_TOOL_NAMES = new Set([
  "read",
  "Read",
  "grep",
  "Grep",
  "glob",
  "Glob",
  "search",
  "Search",
]);

/**
 * @param {string} rel
 */
export function normalizePath(rel) {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * @param {string} rel
 */
export function isForbiddenPath(rel) {
  const p = normalizePath(rel);
  return FORBIDDEN_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * @param {readonly string[]} paths
 */
export function findForbiddenPaths(paths) {
  return paths.filter(isForbiddenPath);
}

/**
 * @param {readonly string[]} paths
 * @returns {number[]} indices of missing required reads
 */
export function findMissingRequiredReads(paths) {
  const normalized = paths.map(normalizePath);
  const missing = [];
  for (let i = 0; i < REQUIRED_READ_PATTERNS.length; i += 1) {
    if (!normalized.some((p) => REQUIRED_READ_PATTERNS[i].test(p))) {
      missing.push(i);
    }
  }
  return missing;
}

/**
 * True when the prompt instructs reading full `docs/PRD.md` (regression).
 * Prohibition lines such as "Do not read `docs/PRD.md`" are allowed.
 * @param {string} promptText
 */
export function promptMentionsForbiddenPrd(promptText) {
  if (!/\bdocs\/PRD\.md\b/i.test(promptText)) {
    return false;
  }

  const prohibition = /\b(do\s+not|don't|never|must\s+not|without\s+reading|forbidden|prohibited)\b/i;
  const readInstruction =
    /\b(read|open|grep|search|load|view|use)\b[^.\n]{0,80}\bdocs\/PRD\.md\b/i;

  for (const line of promptText.split(/\r?\n/u)) {
    if (!/\bdocs\/PRD\.md\b/i.test(line)) {
      continue;
    }
    if (prohibition.test(line)) {
      continue;
    }
    if (readInstruction.test(line)) {
      return true;
    }
  }

  return false;
}
