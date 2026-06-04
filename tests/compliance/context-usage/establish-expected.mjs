#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildExpectedBaseline, computeVariableSamples } from "./lib/expected.mjs";
import { resolveOverheadBaselinePath, resolveSdkModelId } from "./lib/model.mjs";
import {
  PROTOTYPE_MODELS,
  TASK_IDS,
  comboKey,
  resolveExpectedBaselinePath,
} from "./lib/tasks.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_RAW = path.join(HARNESS_ROOT, "calibration", "raw", "matrix-samples.json");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ rawPath: string; quantile: number; confidence: number }} */
  const out = { rawPath: DEFAULT_RAW, quantile: 0.9, confidence: 0.8 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--raw" && argv[i + 1]) {
      out.rawPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--raw=")) {
      out.rawPath = path.resolve(process.cwd(), arg.slice("--raw=".length));
      continue;
    }
    if (arg === "--quantile" && argv[i + 1]) {
      out.quantile = Number(argv[i + 1]);
      i += 1;
    }
    if (arg === "--confidence" && argv[i + 1]) {
      out.confidence = Number(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

/**
 * @param {string} overheadPath
 */
function loadOverheadBaseline(overheadPath) {
  if (!fs.existsSync(overheadPath)) {
    throw new Error(`[context-usage] missing overhead baseline: ${overheadPath}`);
  }
  return JSON.parse(fs.readFileSync(overheadPath, "utf8"));
}

/**
 * @param {string[]} argv
 */
export function establishExpectedFromRaw(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!fs.existsSync(args.rawPath)) {
    throw new Error(`[context-usage] missing calibration raw file: ${args.rawPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(args.rawPath, "utf8"));
  /** @type {Record<string, Record<string, number[]>>} */
  const totals = raw.totals_by_combo ?? {};

  /** @type {string[]} */
  const written = [];

  for (const taskId of TASK_IDS) {
    for (const model of PROTOTYPE_MODELS) {
      const sdkModelId = resolveSdkModelId(model);
      const combo = comboKey(taskId, sdkModelId);
      const observed = totals[combo];
      if (!observed || observed.length === 0) {
        console.warn(`[context-usage] skip expected baseline (no samples): ${combo}`);
        continue;
      }
      const overheadPath = resolveOverheadBaselinePath(HARNESS_ROOT, sdkModelId);
      const overheadBaseline = loadOverheadBaseline(overheadPath);
      const overheadMedian = overheadBaseline.total_tokens.median;
      const variableTotals = computeVariableSamples(observed, overheadMedian);
      const expected = buildExpectedBaseline({
        taskId,
        model: sdkModelId,
        overheadBaseline,
        variableTotals,
        quantile: args.quantile,
        confidence: args.confidence,
      });
      const outPath = resolveExpectedBaselinePath(HARNESS_ROOT, taskId, sdkModelId);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(expected, null, 2)}\n`);
      written.push(outPath);
      console.log(
        `[context-usage] expected baseline ${combo}: upper=${expected.expected_total_tokens.upper_confidence_bound}`,
      );
    }
  }

  return written;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  establishExpectedFromRaw();
}
