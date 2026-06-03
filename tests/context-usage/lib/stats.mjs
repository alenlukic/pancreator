import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_ROOT } from "./copy-sandbox.mjs";
import { PROMPT_VERSION, REQUIRED_READ_PATHS } from "./expected.mjs";
import { HARNESS_MODEL } from "./model.mjs";

/** @typedef {import("./collect-usage.mjs").UsageMetrics} UsageMetrics */

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = path.join(HARNESS_ROOT, "prompt.md");
const PROMPT_REL_PATH = "tests/context-usage/prompt.md";
const CALIBRATION_BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "overhead-calibration.json");

export const REPO_POLICY_PATHS = [
  "AGENTS.md",
  ".cursorindexingignore",
  ".cursor/agents/coder.md",
  "lib/personas/coder.md",
  "docs/M1.index.md",
];

export const TOKEN_ESTIMATOR = Object.freeze({
  id: "chars_div_4_v1",
  formula: "ceil(chars / 4)",
  note: "Rough manual estimate, not model tokenizer output.",
});

export const MODEL_BUDGET_CONSTANTS = Object.freeze({
  "composer-2.5": Object.freeze({
    expected_read_tool_calls: REQUIRED_READ_PATHS.length,
    expected_write_tool_calls: 1,
    read_tool_call_tokens: 180,
    write_tool_call_tokens: 180,
    read_tool_result_tokens: 75,
    write_tool_result_tokens: 125,
    sdk_runtime_tokens: 9_000,
    tool_catalog_tokens: 3_500,
    retrieval_allowance_tokens: 2_500,
    input_tolerance_tokens: 1_500,
    output_tokens_max: 1_200,
    cache_write_tokens_max: 1_000,
    duration_ms_max: 60_000,
    turn_count_max: 3,
    tool_read_count_min: REQUIRED_READ_PATHS.length,
    tool_read_count_max: REQUIRED_READ_PATHS.length + 2,
    live_envelope_tolerance: Object.freeze({
      input_tokens: 2_000,
      cache_read_tokens: 3_000,
      total_tokens: 5_000,
      output_tokens: 500,
    }),
  }),
});

/** Metrics compared against a ratified live envelope rather than the explainable budget. */
export const LIVE_ENVELOPE_METRIC_KEYS = [
  "input_tokens",
  "cache_read_tokens",
  "total_tokens",
];

/** Metrics compared against deterministic policy budgets regardless of live envelope. */
export const POLICY_BUDGET_METRIC_KEYS = [
  "output_tokens",
  "cache_write_tokens",
  "duration_ms",
  "turn_count",
];

/**
 * @param {string} [calibrationPath]
 */
export function readCalibrationBaseline(calibrationPath = CALIBRATION_BASELINE_PATH) {
  if (!fs.existsSync(calibrationPath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(calibrationPath, "utf8"));
  if (parsed?.schema_version !== 1 || !parsed.models || typeof parsed.models !== "object") {
    return null;
  }
  return parsed;
}

/**
 * @param {ReturnType<typeof readCalibrationBaseline>} calibration
 * @param {string} modelId
 */
export function resolveCalibrationModel(calibration, modelId) {
  if (!calibration?.models || typeof calibration.models !== "object") {
    return null;
  }
  const direct = calibration.models[modelId];
  if (direct && typeof direct === "object") {
    return direct;
  }
  const normalized = modelId.split("[")[0].trim();
  const fallback = calibration.models[normalized];
  if (fallback && typeof fallback === "object") {
    return fallback;
  }
  return null;
}

/**
 * @param {{
 *   generated_at?: string;
 *   source_raw?: string;
 *   method?: { quantile?: number; confidence?: number };
 * }} calibration
 * @param {{
 *   envelope?: { maxima?: Record<string, number>; noise_floor?: Record<string, number>; quantile_target?: number; confidence?: number };
 *   conditions?: { repo_root?: { metrics?: Record<string, { median?: number }> } };
 *   sample_counts?: { repo_root?: number; empty_dir?: number };
 * }} modelCalibration
 */
export function buildLiveEnvelopeFromCalibration(calibration, modelCalibration) {
  const maxima = modelCalibration?.envelope?.maxima;
  if (!maxima || typeof maxima !== "object") {
    return null;
  }
  const repoMetrics = modelCalibration.conditions?.repo_root?.metrics ?? {};
  /** @type {Record<string, number>} */
  const metrics = {};
  /** @type {Record<string, number>} */
  const tolerance = {};
  for (const [key, maxValue] of Object.entries(maxima)) {
    const max = Number(maxValue);
    if (!Number.isFinite(max)) {
      continue;
    }
    const median = Number(repoMetrics[key]?.median);
    metrics[key] = Number.isFinite(median) ? median : max;
    tolerance[key] = Math.max(0, max - metrics[key]);
  }
  return {
    ratified_at: calibration.generated_at ?? new Date().toISOString(),
    source_report: calibration.source_raw ?? "tests/context-usage/baselines/overhead-calibration.json",
    metrics,
    tolerance,
    maxima,
    noise_floor: modelCalibration?.envelope?.noise_floor ?? {},
    calibration_method: {
      quantile: Number(modelCalibration?.envelope?.quantile_target ?? calibration?.method?.quantile ?? 0.9),
      confidence: Number(modelCalibration?.envelope?.confidence ?? calibration?.method?.confidence ?? 0.8),
      repo_root_samples: Number(modelCalibration?.sample_counts?.repo_root ?? 0),
      empty_dir_samples: Number(modelCalibration?.sample_counts?.empty_dir ?? 0),
    },
  };
}

/**
 * @param {string} dir
 */
function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * Stable hash of fixture tree contents for baseline invalidation.
 */
export function computeFixtureHash(fixtureRoot = FIXTURE_ROOT) {
  const hash = crypto.createHash("sha256");
  for (const file of walkFiles(fixtureRoot)) {
    const rel = path.relative(fixtureRoot, file).replace(/\\/g, "/");
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * @param {string} promptPath
 */
export function readPromptVersion(promptPath) {
  const text = fs.readFileSync(promptPath, "utf8");
  const m = text.match(/^prompt_version:\s*(\S+)/m);
  return m ? m[1] : String(PROMPT_VERSION);
}

/**
 * @param {string} text
 */
export function estimateTextTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * @param {{ estimated_tokens: number }[]} entries
 */
export function sumEstimatedTokens(entries) {
  return entries.reduce((sum, entry) => sum + Number(entry.estimated_tokens ?? 0), 0);
}

/**
 * @param {string} absPath
 * @param {string} relPath
 */
function readTokenEntry(absPath, relPath) {
  const text = fs.readFileSync(absPath, "utf8");
  return {
    path: relPath,
    chars: text.length,
    estimated_tokens: estimateTextTokens(text),
  };
}

/**
 * @param {{ fixtureRoot?: string; promptPath?: string }} [options]
 */
export function collectBudgetInputs(options = {}) {
  const fixtureRoot = options.fixtureRoot ?? FIXTURE_ROOT;
  const promptPath = options.promptPath ?? PROMPT_PATH;
  const prompt = readTokenEntry(promptPath, PROMPT_REL_PATH);
  const requiredReadFiles = REQUIRED_READ_PATHS.map((relPath) =>
    readTokenEntry(path.join(fixtureRoot, relPath), relPath),
  );
  const repoPolicyFiles = REPO_POLICY_PATHS.map((relPath) =>
    readTokenEntry(path.join(fixtureRoot, relPath), relPath),
  );
  return {
    prompt,
    required_reads: {
      files: requiredReadFiles,
      total_chars: requiredReadFiles.reduce((sum, entry) => sum + entry.chars, 0),
      total_estimated_tokens: sumEstimatedTokens(requiredReadFiles),
    },
    repo_policy: {
      files: repoPolicyFiles,
      total_chars: repoPolicyFiles.reduce((sum, entry) => sum + entry.chars, 0),
      total_estimated_tokens: sumEstimatedTokens(repoPolicyFiles),
    },
  };
}

/**
 * @param {{
 *   modelId?: string;
 *   fixtureRoot?: string;
 *   promptPath?: string;
 *   calibrationPath?: string;
 *   calibrationBaseline?: ReturnType<typeof readCalibrationBaseline>;
 * }} [options]
 */
export function buildBudgetBaseline(options = {}) {
  const modelId = options.modelId ?? HARNESS_MODEL;
  const constants = MODEL_BUDGET_CONSTANTS[modelId];
  if (!constants) {
    throw new Error(`[context-usage] no deterministic budget constants for model ${modelId}`);
  }

  const fixtureRoot = options.fixtureRoot ?? FIXTURE_ROOT;
  const promptPath = options.promptPath ?? PROMPT_PATH;
  const visible_inputs = collectBudgetInputs({ fixtureRoot, promptPath });

  const tool_call_tokens =
    constants.expected_read_tool_calls * constants.read_tool_call_tokens +
    constants.expected_write_tool_calls * constants.write_tool_call_tokens;
  const tool_result_tokens =
    constants.expected_read_tool_calls * constants.read_tool_result_tokens +
    constants.expected_write_tool_calls * constants.write_tool_result_tokens;
  const explained_input_tokens =
    visible_inputs.prompt.estimated_tokens +
    visible_inputs.required_reads.total_estimated_tokens +
    visible_inputs.repo_policy.total_estimated_tokens +
    tool_call_tokens +
    tool_result_tokens +
    constants.sdk_runtime_tokens +
    constants.tool_catalog_tokens +
    constants.retrieval_allowance_tokens;

  const input_tokens_max = explained_input_tokens + constants.input_tolerance_tokens;

  const baseline = {
    model: modelId,
    fixture_hash: computeFixtureHash(fixtureRoot),
    prompt_version: readPromptVersion(promptPath),
    estimator: TOKEN_ESTIMATOR,
    visible_inputs,
    manual_allowances: {
      tool_calls: {
        read_calls: constants.expected_read_tool_calls,
        write_calls: constants.expected_write_tool_calls,
        read_call_tokens_each: constants.read_tool_call_tokens,
        write_call_tokens_each: constants.write_tool_call_tokens,
        total_estimated_tokens: tool_call_tokens,
      },
      tool_results: {
        read_results: constants.expected_read_tool_calls,
        write_results: constants.expected_write_tool_calls,
        read_result_tokens_each: constants.read_tool_result_tokens,
        write_result_tokens_each: constants.write_tool_result_tokens,
        total_estimated_tokens: tool_result_tokens,
      },
      sdk_runtime: {
        estimated_tokens: constants.sdk_runtime_tokens,
        rationale: "Manual allowance for hidden Cursor SDK runtime instructions.",
      },
      tool_catalog: {
        estimated_tokens: constants.tool_catalog_tokens,
        rationale: "Manual allowance for tool schema and tool-routing scaffolding.",
      },
      retrieval: {
        estimated_tokens: constants.retrieval_allowance_tokens,
        rationale: "Allowance for bounded semantic retrieval and repo-policy reminders.",
      },
    },
    budgets: {
      input_tokens: {
        explained: explained_input_tokens,
        tolerance: constants.input_tolerance_tokens,
        max: input_tokens_max,
      },
      output_tokens: {
        max: constants.output_tokens_max,
      },
      cache_write_tokens: {
        max: constants.cache_write_tokens_max,
      },
      duration_ms: {
        max: constants.duration_ms_max,
      },
      turn_count: {
        max: constants.turn_count_max,
      },
      tool_read_count: {
        min: constants.tool_read_count_min,
        max: constants.tool_read_count_max,
      },
    },
  };

  const calibration =
    options.calibrationBaseline ?? readCalibrationBaseline(options.calibrationPath ?? CALIBRATION_BASELINE_PATH);
  const modelCalibration = resolveCalibrationModel(calibration, modelId);
  const calibratedEnvelope = buildLiveEnvelopeFromCalibration(calibration, modelCalibration);
  if (calibratedEnvelope) {
    baseline.calibration_overhead = calibratedEnvelope;
  }

  return baseline;
}

/**
 * @param {Record<string, number>} metrics
 * @param {Record<string, number>} tolerance
 */
export function buildLiveEnvelopeMaxima(metrics, tolerance) {
  /** @type {Record<string, number>} */
  const maxima = {};
  for (const key of LIVE_ENVELOPE_METRIC_KEYS) {
    const observed = Number(metrics[key]);
    const slack = Number(tolerance[key]);
    if (!Number.isFinite(observed) || !Number.isFinite(slack)) {
      continue;
    }
    maxima[key] = observed + slack;
  }
  if (Number.isFinite(metrics.output_tokens) && Number.isFinite(tolerance.output_tokens)) {
    maxima.output_tokens = metrics.output_tokens + tolerance.output_tokens;
  }
  return maxima;
}

/**
 * @param {ReturnType<typeof buildBudgetBaseline>} baseline
 * @param {{
 *   ratified_at: string;
 *   source_report?: string;
 *   metrics: Record<string, number>;
 *   tolerance?: Record<string, number>;
 * }} envelopeInput
 */
export function buildLiveEnvelope(baseline, envelopeInput) {
  const modelId = baseline.model ?? HARNESS_MODEL;
  const constants = MODEL_BUDGET_CONSTANTS[modelId];
  const tolerance = {
    ...constants.live_envelope_tolerance,
    ...(envelopeInput.tolerance ?? {}),
  };
  const maxima = buildLiveEnvelopeMaxima(envelopeInput.metrics, tolerance);
  return {
    ratified_at: envelopeInput.ratified_at,
    source_report: envelopeInput.source_report,
    metrics: envelopeInput.metrics,
    tolerance,
    maxima,
  };
}

/**
 * @param {ReturnType<typeof buildBudgetBaseline>} baseline
 */
export function comparableBudgetBaseline(baseline) {
  const {
    live_envelope: _liveEnvelope,
    calibration_overhead: _calibrationOverhead,
    ...rest
  } = baseline;
  return rest;
}

/**
 * @param {UsageMetrics} observed
 * @param {ReturnType<typeof buildBudgetBaseline> & { live_envelope?: ReturnType<typeof buildLiveEnvelope> }} baseline
 */
export function compareToBudget(observed, baseline) {
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const currentHash = computeFixtureHash();
  const currentPrompt = readPromptVersion(PROMPT_PATH);

  if (baseline.fixture_hash !== currentHash || String(baseline.prompt_version) !== currentPrompt) {
    return {
      ok: false,
      errors: [
        "fixture_hash or prompt_version differs from committed budget — re-run: pnpm run context:usage:baseline",
      ],
      warnings,
    };
  }

  const explainedInputMax =
    Number(baseline.budgets?.input_tokens?.explained ?? 0) +
    Number(baseline.budgets?.input_tokens?.tolerance ?? 0);
  if (Number.isFinite(explainedInputMax) && observed.input_tokens > explainedInputMax) {
    warnings.push(
      `input_tokens=${observed.input_tokens} exceeds explainable audit ceiling=${explainedInputMax} (SDK/runtime cache is tracked separately via live_envelope)`,
    );
  }

  const liveEnvelope = baseline.live_envelope;
  if (!liveEnvelope?.maxima) {
    errors.push(
      "missing live_envelope in baseline — generate calibration artifacts via pnpm run context:usage:calibrate and pnpm run context:usage:calibrate:summary, then re-run pnpm run context:usage:baseline",
    );
  } else {
    for (const key of LIVE_ENVELOPE_METRIC_KEYS) {
      const max = Number(liveEnvelope.maxima[key]);
      if (!Number.isFinite(max)) {
        errors.push(`live_envelope missing max for ${key}`);
        continue;
      }
      if (observed[key] > max) {
        errors.push(
          `${key}=${observed[key]} exceeds ratified live envelope max=${max} (ratified=${liveEnvelope.metrics?.[key]}, tolerance=${liveEnvelope.tolerance?.[key]})`,
        );
      }
    }
  }

  for (const key of POLICY_BUDGET_METRIC_KEYS) {
    const budget = Number(baseline.budgets?.[key]?.max);
    if (!Number.isFinite(budget)) {
      errors.push(`budget missing max for ${key}`);
      continue;
    }
    if (observed[key] > budget) {
      errors.push(`${key}=${observed[key]} exceeds policy budget max=${budget}`);
    }
  }

  const minReadCount = Number(baseline.budgets?.tool_read_count?.min);
  const maxReadCount = Number(baseline.budgets?.tool_read_count?.max);
  if (!Number.isFinite(minReadCount) || !Number.isFinite(maxReadCount)) {
    errors.push("budget missing tool_read_count bounds");
  } else if (observed.tool_read_count < minReadCount || observed.tool_read_count > maxReadCount) {
    errors.push(
      `tool_read_count=${observed.tool_read_count} outside policy range ${minReadCount}-${maxReadCount}`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
