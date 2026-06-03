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
 *   allow_only_read_paths?: string[];
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
  if ((context.allow_only_read_paths ?? []).length > 0) {
    lines.push("Read allowlist (hard constraint):");
    for (const readPath of context.allow_only_read_paths ?? []) {
      lines.push(`- ${readPath}`);
    }
    lines.push(
      "If a file is not in the allowlist, do not read it.",
      "Do not use search/glob tools for discovery in this trace.",
    );
  }
  if (context.required_artifact_paths.length > 0) {
    lines.push("Required output artifacts (all MUST exist on disk before finishing):");
    for (const artifact of context.required_artifact_paths) {
      lines.push(`- ${artifact}`);
    }
  }
  lines.push(
    "",
    "Completion contract:",
    "- Write required artifacts only.",
    "- Keep final chat response to one short line: TRACE_DONE",
    "- Do not include explanations, summaries, or markdown in the final response.",
  );
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
  const allowOnly = (context.allow_only_read_paths ?? []).map(normalizePath);
  if (allowOnly.length > 0) {
    for (const observed of normalizedPaths) {
      const allowed = allowOnly.some((relPath) => observed === relPath || observed.endsWith(`/${relPath}`));
      if (!allowed) {
        errors.push(`read outside allowlist: ${observed}`);
      }
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
    live_envelope: null,
  };
}

/**
 * @param {import("./collect-usage.mjs").UsageMetrics} observed
 * @param {ReturnType<typeof buildFdTraceBudget>} budget
 * @param {{ requireLiveEnvelope?: boolean }} [options]
 */
export function compareTraceToBudget(observed, budget, options = {}) {
  const errors = [];
  const liveEnvelope = budget.live_envelope;
  const liveEnvelopeKeys = ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"];
  const hasLiveEnvelope = Boolean(liveEnvelope?.maxima && typeof liveEnvelope.maxima === "object");
  if (options.requireLiveEnvelope && !hasLiveEnvelope) {
    errors.push("missing live_envelope maxima for fd trace budget");
  }
  if (hasLiveEnvelope) {
    for (const key of liveEnvelopeKeys) {
      const max = Number(liveEnvelope.maxima[key]);
      if (!Number.isFinite(max)) {
        errors.push(`live_envelope missing max for ${key}`);
        continue;
      }
      if (observed[key] > max) {
        errors.push(`${key}=${observed[key]} exceeds live envelope max=${max}`);
      }
    }
  } else {
    for (const key of liveEnvelopeKeys) {
      const max = Number(budget.budgets?.[key]?.max);
      if (!Number.isFinite(max)) {
        errors.push(`missing max for ${key}`);
        continue;
      }
      if (observed[key] > max) {
        errors.push(`${key}=${observed[key]} exceeds max=${max}`);
      }
    }
  }

  const policyKeys = ["cache_write_tokens", "duration_ms", "turn_count"];
  for (const key of policyKeys) {
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
 * @param {string[]} normalizedPaths
 * @param {string} fixtureAbs
 * @param {FdTraceContext} context
 */
export function estimateObservedTraceInputs(normalizedPaths, fixtureAbs, context) {
  const required = new Set(context.expected_required_reads.map(normalizePath));
  const allowOnly = new Set((context.allow_only_read_paths ?? []).map(normalizePath));
  /** @type {Array<{
   * path: string;
   * exists: boolean;
   * is_file: boolean;
   * chars: number;
   * estimated_tokens: number;
   * required: boolean;
   * allowlisted: boolean;
   * }>} */
  const files = [];
  for (const relPath of [...new Set(normalizedPaths.map(normalizePath))]) {
    const absPath = path.join(fixtureAbs, relPath);
    let exists = false;
    let isFile = false;
    let chars = 0;
    let estimatedTokens = 0;
    try {
      const stat = fs.statSync(absPath);
      exists = true;
      isFile = stat.isFile();
      if (isFile) {
        const text = fs.readFileSync(absPath, "utf8");
        chars = text.length;
        estimatedTokens = estimateTextTokens(text);
      }
    } catch {
      // keep zero defaults for non-existent/unreadable paths
    }
    files.push({
      path: relPath,
      exists,
      is_file: isFile,
      chars,
      estimated_tokens: estimatedTokens,
      required: required.has(relPath),
      allowlisted: allowOnly.size === 0 ? true : allowOnly.has(relPath),
    });
  }
  return {
    files,
    total_chars: files.reduce((sum, file) => sum + file.chars, 0),
    total_estimated_tokens: files.reduce((sum, file) => sum + file.estimated_tokens, 0),
    required_estimated_tokens: files
      .filter((file) => file.required)
      .reduce((sum, file) => sum + file.estimated_tokens, 0),
    extra_estimated_tokens: files
      .filter((file) => !file.required)
      .reduce((sum, file) => sum + file.estimated_tokens, 0),
  };
}

/**
 * @param {{ event_index: number; path: string }[]} readEvents
 * @param {string} fixtureAbs
 * @param {FdTraceContext} context
 */
export function buildReadSequenceTrace(readEvents, fixtureAbs, context) {
  const required = new Set(context.expected_required_reads.map(normalizePath));
  const seen = new Set();
  let cumulativeEstimatedTokens = 0;
  return readEvents.map((event, idx) => {
    const relPath = normalizePath(event.path);
    const firstSeen = !seen.has(relPath);
    if (firstSeen) {
      seen.add(relPath);
    }
    let exists = false;
    let isFile = false;
    let estimatedTokens = 0;
    try {
      const stat = fs.statSync(path.join(fixtureAbs, relPath));
      exists = true;
      isFile = stat.isFile();
      if (isFile) {
        const text = fs.readFileSync(path.join(fixtureAbs, relPath), "utf8");
        estimatedTokens = estimateTextTokens(text);
      }
    } catch {
      // keep defaults for missing paths
    }
    if (firstSeen) {
      cumulativeEstimatedTokens += estimatedTokens;
    }
    return {
      step_index: idx + 1,
      event_index: event.event_index,
      path: relPath,
      first_seen: firstSeen,
      required: required.has(relPath),
      exists,
      is_file: isFile,
      estimated_tokens: estimatedTokens,
      cumulative_estimated_tokens: cumulativeEstimatedTokens,
    };
  });
}

/**
 * @param {{
 *   context: FdTraceContext;
 *   budget: ReturnType<typeof buildFdTraceBudget>;
 *   promptText: string;
 *   fixtureAbs: string;
 *   normalizedReads: string[];
 *   readEvents: { event_index: number; path: string }[];
 *   observedMetrics: import("./collect-usage.mjs").UsageMetrics;
 * }} input
 */
export function buildFdTraceDisparityAnalysis(input) {
  const promptTokens = estimateTextTokens(input.promptText);
  const requiredInputs = readRequiredTraceInputs(input.context, input.fixtureAbs);
  const observedInputs = estimateObservedTraceInputs(input.normalizedReads, input.fixtureAbs, input.context);
  const readSequence = buildReadSequenceTrace(input.readEvents, input.fixtureAbs, input.context);
  const allowances = {
    tool_calls_est: Number(input.budget.manual_allowances?.tool_calls_est ?? 0),
    tool_results_est: Number(input.budget.manual_allowances?.tool_results_est ?? 0),
    sdk_runtime_est: Number(input.budget.manual_allowances?.sdk_runtime_est ?? 0),
    tool_catalog_est: Number(input.budget.manual_allowances?.tool_catalog_est ?? 0),
    retrieval_allowance_est: Number(input.budget.manual_allowances?.retrieval_allowance_est ?? 0),
  };
  const allowanceTotal =
    allowances.tool_calls_est +
    allowances.tool_results_est +
    allowances.sdk_runtime_est +
    allowances.tool_catalog_est +
    allowances.retrieval_allowance_est;
  const expectedExplainedInput = Number(input.budget.budgets?.input_tokens?.explained ?? 0);
  const observedInput = Number(input.observedMetrics.input_tokens);
  const observedEstimateWithAllowances = promptTokens + observedInputs.total_estimated_tokens + allowanceTotal;
  const inputEnvelopeMax = Number(
    input.budget.live_envelope?.maxima?.input_tokens ?? input.budget.budgets?.input_tokens?.max ?? 0,
  );
  const cacheEnvelopeMax = Number(
    input.budget.live_envelope?.maxima?.cache_read_tokens ??
      input.budget.budgets?.cache_read_tokens?.max ??
      0,
  );
  const totalEnvelopeMax = Number(
    input.budget.live_envelope?.maxima?.total_tokens ?? input.budget.budgets?.total_tokens?.max ?? 0,
  );
  const outputEnvelopeMax = Number(
    input.budget.live_envelope?.maxima?.output_tokens ?? input.budget.budgets?.output_tokens?.max ?? 0,
  );
  return {
    prompt_tokens_est: promptTokens,
    expected_required_inputs: requiredInputs,
    observed_inputs: observedInputs,
    read_sequence: readSequence,
    allowances,
    allowance_total_est: allowanceTotal,
    expected_explained_input_tokens: expectedExplainedInput,
    observed_input_tokens: observedInput,
    observed_estimate_with_allowances: observedEstimateWithAllowances,
    unexplained_input_tokens: observedInput - observedEstimateWithAllowances,
    deltas: {
      observed_minus_expected_explained: observedInput - expectedExplainedInput,
      observed_minus_expected_required_visible:
        observedInput - (promptTokens + requiredInputs.total_estimated_tokens),
      observed_minus_observed_visible: observedInput - (promptTokens + observedInputs.total_estimated_tokens),
    },
    envelope_comparison: {
      input_tokens: {
        observed: observedInput,
        max: inputEnvelopeMax,
        delta: observedInput - inputEnvelopeMax,
      },
      cache_read_tokens: {
        observed: Number(input.observedMetrics.cache_read_tokens),
        max: cacheEnvelopeMax,
        delta: Number(input.observedMetrics.cache_read_tokens) - cacheEnvelopeMax,
      },
      total_tokens: {
        observed: Number(input.observedMetrics.total_tokens),
        max: totalEnvelopeMax,
        delta: Number(input.observedMetrics.total_tokens) - totalEnvelopeMax,
      },
      output_tokens: {
        observed: Number(input.observedMetrics.output_tokens),
        max: outputEnvelopeMax,
        delta: Number(input.observedMetrics.output_tokens) - outputEnvelopeMax,
      },
    },
  };
}

/**
 * @param {string} fixtureRootAbs
 */
export async function copyFdFixtureToTemp(fixtureRootAbs) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "context-usage-fd-trace-"));
  await fs.promises.cp(fixtureRootAbs, tempDir, { recursive: true });
  return tempDir;
}

/**
 * @param {string} traceDir
 */
export function listFdTraceContextFiles(traceDir) {
  if (!fs.existsSync(traceDir)) {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(traceDir, { withFileTypes: true })) {
    const full = path.join(traceDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFdTraceContextFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".context.json")) {
      out.push(full);
    }
  }
  return out.sort();
}
