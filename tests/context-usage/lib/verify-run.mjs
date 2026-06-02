import fs from "node:fs";
import path from "node:path";

import { classifyExclusiveTier } from "../../../lib/internal/tools/context-budget-report.mjs";
import {
  EXPECTED_ANSWERS,
  REPORT_REL_PATH,
  REQUIRED_READ_PATTERNS,
  REQUIRED_READ_TIERS,
  findForbiddenPaths,
  findMissingRequiredReads,
  normalizePath,
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
 */
export function verifyAnswers(answers) {
  const errors = [];
  for (const [key, expected] of Object.entries(EXPECTED_ANSWERS)) {
    const actual = answers[key];
    if (key === "handler_export_count") {
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
 */
export function verifyForbiddenPaths(observedPaths) {
  const forbidden = findForbiddenPaths(observedPaths);
  if (forbidden.length === 0) {
    return [];
  }
  return forbidden.map((p) => `forbidden read: ${p}`);
}

/**
 * @param {readonly string[]} observedPaths
 */
export function verifyRequiredReads(observedPaths) {
  const missingIdx = findMissingRequiredReads(observedPaths);
  if (missingIdx.length === 0) {
    return [];
  }
  return missingIdx.map(
    (i) => `missing required read matching ${REQUIRED_READ_PATTERNS[i]} (expected tier ${REQUIRED_READ_TIERS[i]})`,
  );
}

/**
 * @param {readonly string[]} observedPaths
 */
export function verifyRequiredReadTiers(observedPaths) {
  const errors = [];
  const normalized = observedPaths.map(normalizePath);
  for (let i = 0; i < REQUIRED_READ_PATTERNS.length; i += 1) {
    const match = normalized.find((p) => REQUIRED_READ_PATTERNS[i].test(p));
    if (!match) {
      continue;
    }
    const tier = classifyExclusiveTier(match);
    if (tier !== REQUIRED_READ_TIERS[i]) {
      errors.push(
        `tier mismatch for ${match}: expected ${REQUIRED_READ_TIERS[i]}, got ${tier}`,
      );
    }
  }
  return errors;
}

/**
 * Layer A verification: artifact answers, paths, tier policy.
 * @param {{
 *   report: { answers?: Record<string, unknown>; files_read?: string[] };
 *   toolPaths?: string[];
 *   promptText?: string;
 * }} input
 * @returns {VerifyResult}
 */
export function verifyRun(input) {
  const errors = [];

  if (input.promptText && promptMentionsForbiddenPrd(input.promptText)) {
    errors.push("prompt regression: instructs reading docs/PRD.md (full PRD forbidden)");
    return { ok: false, errors };
  }

  const answers = input.report?.answers ?? {};
  errors.push(...verifyAnswers(answers));

  const filesRead = (input.report?.files_read ?? []).map((p) => String(p));
  const toolPaths = (input.toolPaths ?? []).map((p) => String(p));
  const allPaths = [...new Set([...filesRead, ...toolPaths].map(normalizePath))];

  errors.push(...verifyForbiddenPaths(allPaths));
  errors.push(...verifyRequiredReads(allPaths));
  errors.push(...verifyRequiredReadTiers(allPaths));

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
 */
export function verifySandboxRun(sandboxCwd, toolPaths, promptText) {
  const report = readReportFromSandbox(sandboxCwd);
  return verifyRun({ report, toolPaths, promptText });
}
