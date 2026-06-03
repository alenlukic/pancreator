import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFixtureHash, estimateTextTokens } from "./stats.mjs";

/**
 * @typedef {{
 *   name: string;
 *   description: string;
 *   model: string;
 *   max_turns: number;
 *   tools: string[];
 *   disallowed_tools: string[];
 * }} FdTracePersona
 */

/**
 * @typedef {{
 *   schema_version: 1;
 *   trace_id: string;
 *   fixture_root: string;
 *   stage_id: string;
 *   message: string;
 *   stage_prompt: { path: string };
 *   required_artifact_paths: string[];
 *   expected_required_reads: string[];
 *   forbidden_read_patterns: string[];
 *   persona: FdTracePersona;
 * }} FdTraceContext
 */

const FD_TRACE_MODEL_CONSTANTS = Object.freeze({
  "composer-2.5": Object.freeze({
    read_tool_call_tokens: 180,
    write_tool_call_tokens: 180,
    read_tool_result_tokens: 75,
    write_tool_result_tokens: 125,
    sdk_runtime_tokens: 9_000,
    tool_catalog_tokens: 3_500,
    retrieval_allowance_tokens: 4_000,
    input_tolerance_tokens: 2_000,
    output_tokens_max: 2_000,
    cache_read_tokens_max: 30_000,
    cache_write_tokens_max: 1_000,
    duration_ms_max: 120_000,
    turn_count_max: 3,
  }),
});

/**
 * @param {string} text
 */
export function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * @param {string} relOrAbs
 */
export function normalizePath(relOrAbs) {
  return relOrAbs.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * @param {string} filePath
 * @returns {FdTraceContext}
 */
export function readFdTraceContext(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed?.schema_version !== 1) {
    throw new Error(`[context-usage] invalid fd trace schema in ${filePath}`);
  }
  return /** @type {FdTraceContext} */ (parsed);
}

/**
 * @param {FdTraceContext} context
 * @param {string} stagePromptText
 */
export function buildFdTracePrompt(context, stagePromptText) {
  const lines = [
    context.message,
    "",
    `Persona: ${context.persona.name}`,
    `Persona contract: ${context.persona.description}`,
    `Model: ${context.persona.model}`,
    `Max turns: ${context.persona.max_turns}`,
    `Allowed tools: ${context.persona.tools.join(", ") || "(none)"}`,
    `Disallowed tools: ${context.persona.disallowed_tools.join(", ") || "(none)"}`,
  ];
  if (context.required_artifact_paths.length > 0) {
    lines.push("Required output artifacts (all MUST exist on disk before finishing):");
    for (const artifact of context.required_artifact_paths) {
      lines.push(`- ${artifact}`);
    }
  }
  lines.push("", "## Stage prompt", "", stagePromptText.trim());
  return lines.join("\n");
}

/**
 * @param {string[]} observedToolPaths
 * @param {string} fixtureCwd
 */
export function normalizeTraceToolPaths(observedToolPaths, fixtureCwd) {
  const normalized = [];
  const root = `${path.resolve(fixtureCwd).replace(/\\/g, "/")}/`;
  for (const rawPath of observedToolPaths) {
    const p = rawPath.replace(/\\/g, "/");
    if (p.startsWith(root)) {
      normalized.push(p.slice(root.length));
      continue;
    }
    normalized.push(normalizePath(p));
  }
  return [...new Set(normalized)];
}

/**
 * @param {string[]} normalizedPaths
 * @param {FdTraceContext} context
 */
export function validateTraceReadPaths(normalizedPaths, context) {
  const errors = [];
  const required = context.expected_required_reads.map(normalizePath);
  for (const relPath of required) {
    const found = normalizedPaths.some((p) => p === relPath || p.endsWith(`/${relPath}`));
    if (!found) {
      errors.push(`missing required read: ${relPath}`);
    }
  }
  const forbidden = context.forbidden_read_patterns.map((pattern) => new RegExp(pattern, "i"));
  for (const observed of normalizedPaths) {
    if (forbidden.some((re) => re.test(observed))) {
      errors.push(`forbidden read: ${observed}`);
    }
  }
  return errors;
}

/**
 * @param {FdTraceContext} context
 * @param {string} fixtureAbs
 */
export function readRequiredTraceInputs(context, fixtureAbs) {
  const files = context.expected_required_reads.map((relPath) => {
    const absPath = path.join(fixtureAbs, relPath);
    const text = fs.readFileSync(absPath, "utf8");
    return {
      path: relPath,
      chars: text.length,
      estimated_tokens: estimateTextTokens(text),
    };
  });
  return {
    files,
    total_chars: files.reduce((sum, file) => sum + file.chars, 0),
    total_estimated_tokens: files.reduce((sum, file) => sum + file.estimated_tokens, 0),
  };
}

/**
 * @param {FdTraceContext} context
 * @param {string} promptText
 * @param {string} fixtureAbs
 */
export function buildFdTraceBudget(context, promptText, fixtureAbs) {
  const modelBase = context.persona.model.split("[")[0].trim();
  const constants = FD_TRACE_MODEL_CONSTANTS[modelBase];
  if (!constants) {
    throw new Error(`[context-usage] no fd-trace budget constants for model ${context.persona.model}`);
  }
  const expectedReadCalls = context.expected_required_reads.length;
  const requiredInputs = readRequiredTraceInputs(context, fixtureAbs);
  const promptTokens = estimateTextTokens(promptText);
  const toolCallTokens =
    expectedReadCalls * constants.read_tool_call_tokens + constants.write_tool_call_tokens;
  const toolResultTokens =
    expectedReadCalls * constants.read_tool_result_tokens + constants.write_tool_result_tokens;
  const explainedInputTokens =
    promptTokens +
    requiredInputs.total_estimated_tokens +
    toolCallTokens +
    toolResultTokens +
    constants.sdk_runtime_tokens +
    constants.tool_catalog_tokens +
    constants.retrieval_allowance_tokens;
  const inputMax = explainedInputTokens + constants.input_tolerance_tokens;

  return {
    trace_id: context.trace_id,
    stage_id: context.stage_id,
    model: modelBase,
    fixture_hash: computeFixtureHash(fixtureAbs),
    prompt_hash: hashText(promptText),
    prompt_tokens_est: promptTokens,
    required_inputs: requiredInputs,
    manual_allowances: {
      tool_calls_est: toolCallTokens,
      tool_results_est: toolResultTokens,
      sdk_runtime_est: constants.sdk_runtime_tokens,
      tool_catalog_est: constants.tool_catalog_tokens,
      retrieval_allowance_est: constants.retrieval_allowance_tokens,
    },
    budgets: {
      input_tokens: {
        explained: explainedInputTokens,
        tolerance: constants.input_tolerance_tokens,
        max: inputMax,
      },
      output_tokens: { max: constants.output_tokens_max },
      cache_read_tokens: { max: constants.cache_read_tokens_max },
      cache_write_tokens: { max: constants.cache_write_tokens_max },
      total_tokens: {
        max:
          inputMax +
          constants.output_tokens_max +
          constants.cache_read_tokens_max +
          constants.cache_write_tokens_max,
      },
      duration_ms: { max: constants.duration_ms_max },
      turn_count: { max: constants.turn_count_max },
      tool_read_count: { min: expectedReadCalls, max: expectedReadCalls + 3 },
    },
  };
}

/**
 * @param {import("./collect-usage.mjs").UsageMetrics} observed
 * @param {ReturnType<typeof buildFdTraceBudget>} budget
 */
export function compareTraceToBudget(observed, budget) {
  const errors = [];
  const maxKeys = [
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "total_tokens",
    "duration_ms",
    "turn_count",
  ];
  for (const key of maxKeys) {
    const max = Number(budget.budgets?.[key]?.max);
    if (!Number.isFinite(max)) {
      errors.push(`missing max for ${key}`);
      continue;
    }
    if (observed[key] > max) {
      errors.push(`${key}=${observed[key]} exceeds max=${max}`);
    }
  }
  const minReads = Number(budget.budgets.tool_read_count.min);
  const maxReads = Number(budget.budgets.tool_read_count.max);
  if (observed.tool_read_count < minReads || observed.tool_read_count > maxReads) {
    errors.push(
      `tool_read_count=${observed.tool_read_count} outside range ${minReads}-${maxReads}`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} fixtureRootAbs
 */
export async function copyFdFixtureToTemp(fixtureRootAbs) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "context-usage-fd-trace-"));
  await fs.promises.cp(fixtureRootAbs, tempDir, { recursive: true });
  return tempDir;
}
