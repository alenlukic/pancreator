import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { FIXTURE_ROOT } from "./copy-sandbox.mjs";
import { PROMPT_VERSION } from "./expected.mjs";

/** @typedef {import("./collect-usage.mjs").UsageMetrics} UsageMetrics */

export const METRIC_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
  "duration_ms",
  "turn_count",
  "tool_read_count",
];

/** Minimum absolute guardrails when baseline sd === 0 or samples < 3. */
export const DEGENERATE_GUARDRAILS = {
  input_tokens: 500_000,
  output_tokens: 100_000,
  cache_read_tokens: 2_000_000,
  cache_write_tokens: 500_000,
  total_tokens: 2_500_000,
  duration_ms: 600_000,
  turn_count: 50,
  tool_read_count: 100,
};

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
 * @param {number} value
 * @param {number} mean
 * @param {number} sd
 * @param {number} samples
 * @param {keyof typeof DEGENERATE_GUARDRAILS} metric
 */
export function exceedsThreshold(value, mean, sd, samples, metric) {
  if (samples < 3 || sd === 0) {
    const cap = Math.max(DEGENERATE_GUARDRAILS[metric], mean * 2);
    return value > cap;
  }
  return value > mean + 3 * sd;
}

/**
 * @param {UsageMetrics} observed
 * @param {{
 *   fixture_hash: string;
 *   prompt_version: string;
 *   samples: number;
 *   metrics: Record<string, { mean: number; sd: number }>;
 * }} baseline
 */
export function compareToBaseline(observed, baseline) {
  const errors = [];
  const currentHash = computeFixtureHash();
  const currentPrompt = String(PROMPT_VERSION);

  if (baseline.fixture_hash !== currentHash || String(baseline.prompt_version) !== currentPrompt) {
    return {
      ok: false,
      errors: [
        "fixture_hash or prompt_version differs from baseline — re-run: pnpm run context:usage:baseline",
      ],
    };
  }

  const samples = Number(baseline.samples ?? 0);
  for (const key of METRIC_KEYS) {
    const stats = baseline.metrics?.[key];
    if (!stats) {
      errors.push(`baseline missing metric stats for ${key}`);
      continue;
    }
    const value = observed[key];
    const mean = Number(stats.mean);
    const sd = Number(stats.sd);
    if (exceedsThreshold(value, mean, sd, samples, key)) {
      errors.push(
        `${key}=${value} exceeds threshold (mean=${mean}, sd=${sd}, samples=${samples})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {UsageMetrics[]} sampleMetrics
 * @param {{ fixture_hash: string; prompt_version: string; samples: number }} meta
 */
export function buildBaselineFromSamples(sampleMetrics, meta) {
  /** @type {Record<string, { mean: number; sd: number }>} */
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const values = sampleMetrics.map((m) => m[key]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
    const sd = Math.sqrt(variance);
    metrics[key] = { mean, sd };
  }
  return { ...meta, metrics };
}
