import assert from "node:assert/strict";
import { test } from "node:test";

import {
  binomialTailProbability,
  nonparametricQuantileUpperBound,
  summarizeDifferential,
  summarizeMetric,
  summarizeModelCalibration,
} from "./lib/calibration-stats.mjs";

test("calibration-stats: summarizeMetric computes robust centrality values", () => {
  const summary = summarizeMetric([1, 2, 3, 4, 5], { quantile: 0.9, confidence: 0.8 });
  assert.equal(summary.n, 5);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 5);
  assert.equal(summary.median, 3);
  assert.equal(summary.iqr, 2);
  assert.ok(summary.upper_confidence_bound >= summary.p90);
});

test("calibration-stats: binomial tail probability bounds are valid", () => {
  const tail = binomialTailProbability(10, 0.9, 9);
  assert.ok(tail > 0);
  assert.ok(tail <= 1);
});

test("calibration-stats: nonparametric upper bound is conservative", () => {
  const values = [100, 101, 99, 103, 102, 104, 110, 107, 106, 108];
  const upper = nonparametricQuantileUpperBound(values, { quantile: 0.9, confidence: 0.8 });
  const p90 = summarizeMetric(values, { quantile: 0.9, confidence: 0.8 }).p90;
  assert.ok(upper >= p90);
});

test("calibration-stats: summarizeDifferential pairs runs by index order", () => {
  const repo = [
    { run_index: 1, metrics: { input_tokens: 120 } },
    { run_index: 2, metrics: { input_tokens: 130 } },
  ];
  const empty = [
    { run_index: 1, metrics: { input_tokens: 100 } },
    { run_index: 2, metrics: { input_tokens: 105 } },
  ];
  const diff = summarizeDifferential(repo, empty, ["input_tokens"], {
    quantile: 0.9,
    confidence: 0.8,
  });
  assert.equal(diff.pair_count, 2);
  assert.equal(diff.metrics.input_tokens.delta.median, 22.5);
});

test("calibration-stats: summarizeModelCalibration builds envelope maxima and noise floor", () => {
  const model = summarizeModelCalibration(
    {
      model: "composer-2.5",
      samples: {
        repo_root: [
          { run_index: 1, metrics: { input_tokens: 210, cache_read_tokens: 300, total_tokens: 540, output_tokens: 30 } },
          { run_index: 2, metrics: { input_tokens: 220, cache_read_tokens: 310, total_tokens: 560, output_tokens: 32 } },
        ],
        empty_dir: [
          { run_index: 1, metrics: { input_tokens: 180, cache_read_tokens: 260, total_tokens: 470, output_tokens: 30 } },
          { run_index: 2, metrics: { input_tokens: 185, cache_read_tokens: 255, total_tokens: 472, output_tokens: 31 } },
        ],
      },
    },
    { quantile: 0.9, confidence: 0.8 },
  );
  assert.equal(model.model, "composer-2.5");
  assert.ok(model.envelope.maxima.input_tokens >= model.conditions.repo_root.metrics.input_tokens.p90);
  assert.ok(model.envelope.noise_floor.input_tokens >= 0);
});
