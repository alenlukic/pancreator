#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeMetric } from "./lib/calibration-stats.mjs";
import { resolveModelBaselinePath, resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(HARNESS_ROOT, "..", "..", "..");
const FD_BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");
const DEFAULT_TOLERANCE = Object.freeze({
  input_tokens: 2_000,
  cache_read_tokens: 3_000,
  total_tokens: 5_000,
  output_tokens: 500,
});

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = {
    quantile: 0.9,
    confidence: 0.8,
    minRuns: 1,
    reportArgs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quantile" && argv[i + 1]) {
      out.quantile = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--quantile=")) {
      out.quantile = Number(arg.slice("--quantile=".length));
      continue;
    }
    if (arg === "--confidence" && argv[i + 1]) {
      out.confidence = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--confidence=")) {
      out.confidence = Number(arg.slice("--confidence=".length));
      continue;
    }
    if (arg === "--min-runs" && argv[i + 1]) {
      out.minRuns = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--min-runs=")) {
      out.minRuns = Number(arg.slice("--min-runs=".length));
      continue;
    }
    if (!arg.startsWith("-")) {
      out.reportArgs.push(arg);
    }
  }
  if (!Number.isFinite(out.quantile) || out.quantile <= 0 || out.quantile >= 1) {
    throw new Error("[context-usage] --quantile must be between 0 and 1");
  }
  if (!Number.isFinite(out.confidence) || out.confidence <= 0 || out.confidence >= 1) {
    throw new Error("[context-usage] --confidence must be between 0 and 1");
  }
  if (!Number.isInteger(out.minRuns) || out.minRuns < 1) {
    throw new Error("[context-usage] --min-runs must be >= 1");
  }
  return out;
}

/**
 * @param {unknown} value
 */
function isMetricsObject(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const key of ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"]) {
    if (!Number.isFinite(Number(value[key]))) {
      return false;
    }
  }
  return true;
}

const args = parseArgs(process.argv.slice(2));
if (args.reportArgs.length === 0) {
  console.error(
    "[context-usage] usage: node tests/compliance/context-usage/establish-fd-trace-envelope.mjs [--quantile 0.9] [--confidence 0.8] [--min-runs 3] <fd-trace-report-or-suite.json> [more-reports...]",
  );
  process.exit(1);
}

if (!fs.existsSync(FD_BASELINE_PATH)) {
  console.error(
    `[context-usage] fd baseline not found at ${FD_BASELINE_PATH}. Run context:usage:fd-trace:baseline first.`,
  );
  process.exit(1);
}

const fdBaseline = JSON.parse(fs.readFileSync(FD_BASELINE_PATH, "utf8"));
/** @type {Map<string, Array<{ trace: any; reportRuntime: any; sourceReport: string }>>} */
const samplesByTraceId = new Map();
for (const reportArg of args.reportArgs) {
  const reportPath = path.isAbsolute(reportArg) ? reportArg : path.resolve(process.cwd(), reportArg);
  if (!fs.existsSync(reportPath)) {
    console.error(`[context-usage] report not found: ${reportPath}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const sourceReport = path.relative(REPO_ROOT, reportPath).replace(/\\/g, "/");
  const traces = Array.isArray(report.traces)
    ? report.traces
    : report.trace_id
      ? [report]
      : [];
  if (traces.length === 0) {
    console.error(`[context-usage] report does not contain trace results: ${sourceReport}`);
    process.exit(1);
  }
  for (const trace of traces) {
    const traceId = String(trace.trace_id ?? "");
    if (!samplesByTraceId.has(traceId)) {
      samplesByTraceId.set(traceId, []);
    }
    samplesByTraceId.get(traceId).push({
      trace,
      reportRuntime: report.runtime ?? null,
      sourceReport,
    });
  }
}

for (const [traceId, samples] of samplesByTraceId.entries()) {
  const baselineTrace = fdBaseline?.traces?.[traceId];
  if (!baselineTrace) {
    console.error(`[context-usage] baseline is missing trace_id=${traceId}`);
    process.exit(1);
  }
  for (const { trace, sourceReport } of samples) {
    if (trace.read_verification?.ok !== true) {
      console.error(`[context-usage] refusing to ratify ${traceId}: read verification failed (${sourceReport})`);
      for (const err of trace.read_verification?.errors ?? []) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    if (!isMetricsObject(trace.metrics)) {
      console.error(`[context-usage] refusing to ratify ${traceId}: missing required metrics (${sourceReport})`);
      process.exit(1);
    }
  }
  if (samples.length < args.minRuns) {
    console.error(
      `[context-usage] refusing to ratify ${traceId}: sample_count=${samples.length} below --min-runs=${args.minRuns}`,
    );
    process.exit(1);
  }

  const modelId = resolveSdkModelId(String(samples[0].trace.model ?? baselineTrace.model ?? ""));
  const modelBaselinePath = resolveModelBaselinePath(HARNESS_ROOT, modelId);
  const modelBaseline = fs.existsSync(modelBaselinePath)
    ? JSON.parse(fs.readFileSync(modelBaselinePath, "utf8"))
    : null;
  const baselineTolerance = {
    ...DEFAULT_TOLERANCE,
    ...(modelBaseline?.live_envelope?.tolerance ?? {}),
    ...(baselineTrace?.live_envelope?.tolerance ?? {}),
  };

  /** @type {Record<string, number>} */
  const medians = {};
  /** @type {Record<string, number>} */
  const maxima = {};
  /** @type {Record<string, number>} */
  const tolerance = {};
  for (const key of ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"]) {
    const values = samples.map((entry) => Number(entry.trace.metrics[key]));
    const summary = summarizeMetric(values, {
      quantile: args.quantile,
      confidence: args.confidence,
    });
    medians[key] = summary.median;
    maxima[key] = summary.upper_confidence_bound;
    tolerance[key] = Math.max(Number(baselineTolerance[key] ?? 0), maxima[key] - medians[key]);
  }
  const medianCacheWrite = summarizeMetric(
    samples.map((entry) => Number(entry.trace.metrics.cache_write_tokens ?? 0)),
    { quantile: args.quantile, confidence: args.confidence },
  ).median;
  const medianToolReads = summarizeMetric(
    samples.map((entry) => Number(entry.trace.metrics.tool_read_count ?? 0)),
    { quantile: args.quantile, confidence: args.confidence },
  ).median;

  const newestSample = [...samples].sort((a, b) => {
    const aTs = Date.parse(String(a.trace.timestamp ?? ""));
    const bTs = Date.parse(String(b.trace.timestamp ?? ""));
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  })[0];

  baselineTrace.live_envelope = {
    ratified_at: new Date().toISOString(),
    source_report:
      samples.length === 1
        ? samples[0].sourceReport
        : `multi:${samples.length} reports`,
    source_reports: [...new Set(samples.map((entry) => entry.sourceReport))],
    metrics: {
      input_tokens: medians.input_tokens,
      output_tokens: medians.output_tokens,
      cache_read_tokens: medians.cache_read_tokens,
      cache_write_tokens: medianCacheWrite,
      total_tokens: medians.total_tokens,
      tool_read_count: medianToolReads,
    },
    tolerance,
    maxima,
    runtime: newestSample.trace.runtime ?? newestSample.reportRuntime ?? null,
    calibration_method: {
      quantile: args.quantile,
      confidence: args.confidence,
      sample_count: samples.length,
    },
  };
}

fdBaseline.generated_at = new Date().toISOString();
fs.writeFileSync(FD_BASELINE_PATH, `${JSON.stringify(fdBaseline, null, 2)}\n`);
console.log(`[context-usage] fd trace envelope ratified into: ${FD_BASELINE_PATH}`);
