#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireLiveEnv } from "./lib/live-env.mjs";
import { runContextUsageOnce } from "./lib/run-once.mjs";
import { buildBaselineFromSamples, computeFixtureHash, readPromptVersion } from "./lib/stats.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PROMPT_PATH = path.join(HARNESS_ROOT, "prompt.md");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "composer-2.5.json");

requireLiveEnv();

const MAX_ATTEMPTS_PER_SAMPLE = 3;

let samples = 5;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const eq = arg.match(/^--samples=(\d+)$/);
  if (eq) {
    samples = Number(eq[1]);
    continue;
  }
  if (arg === "--samples" && argv[i + 1] && /^\d+$/.test(argv[i + 1])) {
    samples = Number(argv[i + 1]);
    i += 1;
  }
}

/** @type {import("./lib/collect-usage.mjs").UsageMetrics[]} */
const sampleMetrics = [];

for (let i = 0; i < samples; i += 1) {
  console.error(`[context-usage:baseline] sample ${i + 1}/${samples}`);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SAMPLE; attempt += 1) {
    try {
      const result = await runContextUsageOnce({ skipBaseline: true });
      sampleMetrics.push(result.metrics);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS_PER_SAMPLE) {
        console.error(
          `[context-usage:baseline] sample ${i + 1} attempt ${attempt} failed; retrying (${/** @type {Error} */ (err).message})`,
        );
      }
    }
  }
  if (lastError !== undefined) {
    throw lastError;
  }
}

const baseline = buildBaselineFromSamples(sampleMetrics, {
  fixture_hash: computeFixtureHash(),
  prompt_version: readPromptVersion(PROMPT_PATH),
  samples,
});

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
console.log(`[context-usage] baseline written: ${BASELINE_PATH}`);
