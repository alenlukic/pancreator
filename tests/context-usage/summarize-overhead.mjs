#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeModelCalibration } from "./lib/calibration-stats.mjs";
import { resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = path.join(HARNESS_ROOT, "calibration", "raw");
const SUMMARY_DIR = path.join(HARNESS_ROOT, "calibration", "summaries");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "overhead-calibration.json");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   input?: string;
   *   output?: string;
   *   baseline: string;
   *   quantile: number;
   *   confidence: number;
 * }} */
  const out = {
    input: undefined,
    output: undefined,
    baseline: BASELINE_PATH,
    quantile: 0.9,
    confidence: 0.8,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      out.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      out.input = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--output" && argv[i + 1]) {
      out.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      out.output = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--baseline" && argv[i + 1]) {
      out.baseline = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      out.baseline = arg.slice("--baseline=".length);
      continue;
    }
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
  }

  if (!Number.isFinite(out.quantile) || out.quantile <= 0 || out.quantile >= 1) {
    throw new Error("[context-usage] --quantile must be between 0 and 1");
  }
  if (!Number.isFinite(out.confidence) || out.confidence <= 0 || out.confidence >= 1) {
    throw new Error("[context-usage] --confidence must be between 0 and 1");
  }
  return out;
}

/**
 * @param {string} dir
 */
function latestRawFile(dir) {
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    return undefined;
  }
  return path.join(dir, files[files.length - 1]);
}

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input
  ? path.resolve(process.cwd(), args.input)
  : latestRawFile(RAW_DIR);
if (!inputPath) {
  throw new Error("[context-usage] missing calibration input; run calibrate-overhead first");
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (raw?.schema_version !== 1) {
  throw new Error(`[context-usage] unsupported calibration schema: ${raw?.schema_version}`);
}

/** @type {Record<string, unknown>} */
const models = {};
for (const modelEntry of raw.models ?? []) {
  if (!modelEntry?.model) {
    continue;
  }
  const modelId = resolveSdkModelId(String(modelEntry.model));
  models[modelId] = summarizeModelCalibration(modelEntry, {
    quantile: args.quantile,
    confidence: args.confidence,
  });
}

const summary = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source_raw: path.relative(path.resolve(HARNESS_ROOT, "..", ".."), inputPath).replace(/\\/g, "/"),
  method: {
    quantile: args.quantile,
    confidence: args.confidence,
  },
  models,
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = args.output
  ? path.resolve(process.cwd(), args.output)
  : path.join(SUMMARY_DIR, `${stamp}-overhead-summary.json`);
const baselinePath = path.resolve(process.cwd(), args.baseline);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[context-usage] calibration summary written: ${outputPath}`);

fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
fs.writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[context-usage] calibration baseline updated: ${baselinePath}`);
