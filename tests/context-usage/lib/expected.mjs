/** @typedef {{ path: string; tier: string }} TierExpectation */
/** @typedef {{
 *   id: string;
 *   prompt_file: string;
 *   expected_answers: Record<string, string | number>;
 *   forbidden_path_patterns: RegExp[];
 *   required_read_paths: string[];
 *   required_read_tiers: string[];
 *   min_unique_read_targets?: number;
 *   max_unique_read_targets?: number;
 *   allow_only_read_paths?: string[];
 *   explicit_read_only_paths?: string[];
 * }} ScenarioSpec */

export const PROMPT_VERSION = 1;
export const DEFAULT_SCENARIO_ID = "bounded_task";

/** Paths that MUST NOT appear in tool logs or files_read unless a scenario overrides. */
export const COMMON_FORBIDDEN_PATH_PATTERNS = [
  /^docs\/PRD\.md$/i,
  /^docs\/BOOTSTRAP\.md$/i,
  /^archive\/work\//i,
  /^archive\/inbox\//i,
  /^lib\/inbox\//i,
];

/** Backward-compatible alias for existing callsites/tests. */
export const FORBIDDEN_PATH_PATTERNS = COMMON_FORBIDDEN_PATH_PATTERNS;

/** Default bounded-task required reads for backward compatibility. */
export const REQUIRED_READ_PATHS = [
  "lib/memory/active/current.md",
  "lib/memory/handbook/routing.md",
  "docs/PRD.summary.md",
  "work/99999_sandbox/task/handoff.md",
  "lib/internal/packages/demo-svc/handler.ts",
];

/** Each required read: regex on normalized posix path. */
export const REQUIRED_READ_PATTERNS = REQUIRED_READ_PATHS.map((rel) => toExactPathRegex(rel));

/** Expected tier for each required-read pattern (same order as REQUIRED_READ_PATTERNS). */
export const REQUIRED_READ_TIERS = [
  "active_memory",
  "internal_operating",
  "product_context",
  "active_work",
  "source_code",
];

/** @type {Record<string, ScenarioSpec>} */
export const SCENARIOS = {
  bounded_task: {
    id: "bounded_task",
    prompt_file: "tests/context-usage/prompt.md",
    expected_answers: {
      active_feature: "tier-sandbox-probe",
      handbook_anchor: "alpha-7f3c",
      product_route_token: "route-summary-only",
      handoff_stage: "implement",
      handler_export_count: 2,
    },
    forbidden_path_patterns: COMMON_FORBIDDEN_PATH_PATTERNS,
    required_read_paths: REQUIRED_READ_PATHS,
    required_read_tiers: REQUIRED_READ_TIERS,
    min_unique_read_targets: 5,
    max_unique_read_targets: 7,
  },
  summary_first_routing: {
    id: "summary_first_routing",
    prompt_file: "tests/context-usage/prompts/summary-first-routing.md",
    expected_answers: {
      product_route_token: "route-summary-only",
      m1_index_anchor: "m1-index-sandbox",
      prd_index_anchor: "prd-index-sandbox",
    },
    forbidden_path_patterns: [
      ...COMMON_FORBIDDEN_PATH_PATTERNS,
      /^lib\/memory\/handbook\//i,
    ],
    required_read_paths: [
      "docs/PRD.summary.md",
      "docs/M1.index.md",
      "docs/PRD.index.md",
    ],
    required_read_tiers: [
      "product_context",
      "product_context",
      "product_context",
    ],
    max_unique_read_targets: 4,
  },
  simple_source_task: {
    id: "simple_source_task",
    prompt_file: "tests/context-usage/prompts/simple-source-task.md",
    expected_answers: {
      handler_export_count: 2,
    },
    forbidden_path_patterns: [
      ...COMMON_FORBIDDEN_PATH_PATTERNS,
      /^docs\/PRD\.summary\.md$/i,
      /^docs\/M1\.index\.md$/i,
      /^lib\/memory\//i,
      /^work\//i,
    ],
    required_read_paths: ["lib/internal/packages/demo-svc/handler.ts"],
    required_read_tiers: ["source_code"],
    allow_only_read_paths: ["lib/internal/packages/demo-svc/handler.ts"],
    max_unique_read_targets: 2,
  },
  generated_artifact_preference: {
    id: "generated_artifact_preference",
    prompt_file: "tests/context-usage/prompts/generated-artifact-preference.md",
    expected_answers: {
      durable_spec_anchor: "durable-tier-sandbox-001",
    },
    forbidden_path_patterns: [
      ...COMMON_FORBIDDEN_PATH_PATTERNS,
      /^lib\/memory\/features\/tier-sandbox\/index\.json$/i,
    ],
    required_read_paths: ["lib/memory/features/tier-sandbox/spec.md"],
    required_read_tiers: ["durable_memory"],
    max_unique_read_targets: 3,
  },
  explicit_read_generated_index: {
    id: "explicit_read_generated_index",
    prompt_file: "tests/context-usage/prompts/explicit-read-generated-index.md",
    expected_answers: {
      generated_machine_anchor: "index-json-tier-sandbox",
    },
    forbidden_path_patterns: COMMON_FORBIDDEN_PATH_PATTERNS,
    required_read_paths: ["lib/memory/features/tier-sandbox/index.json"],
    required_read_tiers: ["generated_machine"],
    explicit_read_only_paths: ["lib/memory/features/tier-sandbox/index.json"],
    max_unique_read_targets: 2,
  },
};

/** Backward-compatible alias for older tests. */
export const EXPECTED_ANSWERS = SCENARIOS.bounded_task.expected_answers;

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
 * @param {string} relPath
 */
export function toExactPathRegex(relPath) {
  return new RegExp(`^${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/**
 * @param {string} observedPath
 * @param {string} relPath
 */
export function pathEqualsOrSuffix(observedPath, relPath) {
  const p = normalizePath(observedPath);
  const rel = normalizePath(relPath);
  return p === rel || p.endsWith(`/${rel}`);
}

/**
 * @param {string} id
 * @returns {ScenarioSpec}
 */
export function getScenarioById(id) {
  const scenario = SCENARIOS[id];
  if (!scenario) {
    const known = Object.keys(SCENARIOS).join(", ");
    throw new Error(`Unknown context-usage scenario "${id}". Known scenarios: ${known}`);
  }
  return scenario;
}

/**
 * @param {readonly string[]} paths
 * @param {readonly RegExp[]} forbiddenPathPatterns
 */
export function findForbiddenPaths(paths, forbiddenPathPatterns) {
  return paths
    .map(normalizePath)
    .filter((p) => forbiddenPathPatterns.some((re) => re.test(p)));
}

/**
 * @param {readonly string[]} paths
 * @param {readonly string[]} requiredReadPaths
 * @returns {number[]} indices of missing required reads
 */
export function findMissingRequiredReads(paths, requiredReadPaths) {
  const normalized = paths.map(normalizePath);
  const requiredPatterns = requiredReadPaths.map(toExactPathRegex);
  const missing = [];
  for (let i = 0; i < requiredPatterns.length; i += 1) {
    if (!normalized.some((p) => requiredPatterns[i].test(p) || pathEqualsOrSuffix(p, requiredReadPaths[i]))) {
      missing.push(i);
    }
  }
  return missing;
}

/**
 * @param {string} promptText
 * @param {string} relPath
 */
export function promptMentionsPath(promptText, relPath) {
  const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(promptText);
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
