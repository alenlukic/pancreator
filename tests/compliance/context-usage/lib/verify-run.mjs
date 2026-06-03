import fs from "node:fs";
import path from "node:path";

import { classifyExclusiveTier } from "../../../../lib/internal/tools/context-budget-report.mjs";
import {
  DEFAULT_SCENARIO_ID,
  REPORT_REL_PATH,
  findForbiddenPaths,
  findMissingRequiredReads,
  getScenarioById,
  normalizePath,
  pathEqualsOrSuffix,
  promptMentionsPath,
  promptMentionsForbiddenPrd,
} from "./expected.mjs";

/**
 * @typedef {{
 *   ok: boolean;
 *   errors: string[];
 * }} VerifyResult
 */

/**
 * @param {Record<string, unknown>} answers
 * @param {Record<string, string | number>} expectedAnswers
 */
export function verifyAnswers(answers, expectedAnswers) {
  const errors = [];
  for (const [key, expected] of Object.entries(expectedAnswers)) {
    const actual = answers[key];
    if (typeof expected === "number") {
      if (Number(actual) !== expected) {
        errors.push(`answers.${key}: expected ${expected}, got ${JSON.stringify(actual)}`);
      }
    } else if (actual !== expected) {
      errors.push(`answers.${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  return errors;
}

/**
 * @param {readonly string[]} observedPaths
 * @param {readonly RegExp[]} forbiddenPathPatterns
 */
export function verifyForbiddenPaths(observedPaths, forbiddenPathPatterns) {
  const forbidden = findForbiddenPaths(observedPaths, forbiddenPathPatterns);
  if (forbidden.length === 0) {
    return [];
  }
  return forbidden.map((p) => `forbidden read: ${p}`);
}

/**
 * @param {readonly string[]} observedPaths
 * @param {readonly string[]} requiredReadPaths
 * @param {readonly string[]} requiredReadTiers
 */
export function verifyRequiredReads(observedPaths, requiredReadPaths, requiredReadTiers) {
  const missingIdx = findMissingRequiredReads(observedPaths, requiredReadPaths);
  if (missingIdx.length === 0) {
    return [];
  }
  return missingIdx.map(
    (i) => `missing required read matching ${requiredReadPaths[i]} (expected tier ${requiredReadTiers[i]})`,
  );
}

/**
 * @param {readonly string[]} observedPaths
 * @param {readonly string[]} requiredReadPaths
 * @param {readonly string[]} requiredReadTiers
 */
export function verifyRequiredReadTiers(observedPaths, requiredReadPaths, requiredReadTiers) {
  const errors = [];
  const normalized = observedPaths.map(normalizePath);
  for (let i = 0; i < requiredReadPaths.length; i += 1) {
    const match = normalized.find((p) => pathEqualsOrSuffix(p, requiredReadPaths[i]));
    if (!match) {
      continue;
    }
    const tier = classifyExclusiveTier(match);
    if (tier !== requiredReadTiers[i]) {
      errors.push(
        `tier mismatch for ${match}: expected ${requiredReadTiers[i]}, got ${tier}`,
      );
    }
  }
  return errors;
}

/**
 * @param {readonly string[]} observedPaths
 * @param {readonly string[] | undefined} allowOnlyReadPaths
 */
export function verifyAllowOnlyPaths(observedPaths, allowOnlyReadPaths) {
  if (!allowOnlyReadPaths || allowOnlyReadPaths.length === 0) {
    return [];
  }
  return observedPaths
    .map(normalizePath)
    .filter((observed) => !allowOnlyReadPaths.some((allowed) => pathEqualsOrSuffix(observed, allowed)))
    .map((path) => `disallowed read for scenario allowlist: ${path}`);
}

/**
 * @param {readonly string[]} observedPaths
 * @param {string | undefined} promptText
 * @param {readonly string[] | undefined} explicitReadOnlyPaths
 */
export function verifyExplicitReadOnlyPaths(observedPaths, promptText, explicitReadOnlyPaths) {
  if (!explicitReadOnlyPaths || explicitReadOnlyPaths.length === 0) {
    return [];
  }
  if (!promptText || promptText.trim().length === 0) {
    return ["scenario requires promptText for explicit-read verification"];
  }
  const errors = [];
  for (const relPath of explicitReadOnlyPaths) {
    const wasRead = observedPaths.some((p) => pathEqualsOrSuffix(p, relPath));
    if (!wasRead) {
      continue;
    }
    if (!promptMentionsPath(promptText, relPath)) {
      errors.push(`explicit-read-only path ${relPath} was read without being named in prompt`);
    }
  }
  return errors;
}

/**
 * @param {number} readCount
 * @param {{ min_unique_read_targets?: number; max_unique_read_targets?: number }} scenario
 */
export function verifyReadCountBounds(readCount, scenario) {
  const errors = [];
  if (typeof scenario.min_unique_read_targets === "number" && readCount < scenario.min_unique_read_targets) {
    errors.push(
      `unique read targets ${readCount} below scenario minimum ${scenario.min_unique_read_targets}`,
    );
  }
  if (typeof scenario.max_unique_read_targets === "number" && readCount > scenario.max_unique_read_targets) {
    errors.push(
      `unique read targets ${readCount} exceed scenario maximum ${scenario.max_unique_read_targets}`,
    );
  }
  return errors;
}

/**
 * Layer A verification: artifact answers, paths, tier policy.
 * @param {{
 *   report: { answers?: Record<string, unknown>; files_read?: string[] };
 *   toolPaths?: string[];
 *   promptText?: string;
 *   scenarioId?: string;
 *   metrics?: { tool_read_count?: number };
 * }} input
 * @returns {VerifyResult}
 */
export function verifyRun(input) {
  const errors = [];
  const scenario = getScenarioById(input.scenarioId ?? DEFAULT_SCENARIO_ID);

  if (input.promptText && promptMentionsForbiddenPrd(input.promptText)) {
    errors.push("prompt regression: instructs reading docs/PRD.md (full PRD forbidden)");
    return { ok: false, errors };
  }

  const answers = input.report?.answers ?? {};
  errors.push(...verifyAnswers(answers, scenario.expected_answers));

  const filesRead = (input.report?.files_read ?? []).map((p) => String(p));
  const toolPaths = (input.toolPaths ?? []).map((p) => String(p));
  const allPaths = [...new Set([...filesRead, ...toolPaths].map(normalizePath))];

  errors.push(...verifyForbiddenPaths(allPaths, scenario.forbidden_path_patterns));
  errors.push(...verifyRequiredReads(allPaths, scenario.required_read_paths, scenario.required_read_tiers));
  errors.push(...verifyRequiredReadTiers(allPaths, scenario.required_read_paths, scenario.required_read_tiers));
  errors.push(...verifyAllowOnlyPaths(allPaths, scenario.allow_only_read_paths));
  errors.push(
    ...verifyExplicitReadOnlyPaths(allPaths, input.promptText, scenario.explicit_read_only_paths),
  );

  const readCount =
    Number(input.metrics?.tool_read_count) ||
    new Set(toolPaths.map(normalizePath)).size;
  errors.push(...verifyReadCountBounds(readCount, scenario));

  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} sandboxCwd
 */
export function readReportFromSandbox(sandboxCwd) {
  const reportPath = path.join(sandboxCwd, REPORT_REL_PATH);
  if (!fs.existsSync(reportPath)) {
    throw new Error(`[context-usage] missing report artifact: ${REPORT_REL_PATH}`);
  }
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

/**
 * @param {string} sandboxCwd
 * @param {string[]} toolPaths
 * @param {string} [promptText]
 * @param {string} [scenarioId]
 * @param {{ tool_read_count?: number }} [metrics]
 */
export function verifySandboxRun(sandboxCwd, toolPaths, promptText, scenarioId, metrics) {
  const report = readReportFromSandbox(sandboxCwd);
  return verifyRun({ report, toolPaths, promptText, scenarioId, metrics });
}
