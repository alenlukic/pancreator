#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calibrateOverhead } from "./calibrate-overhead.mjs";
import { establishExpectedFromRaw } from "./establish-expected.mjs";
import { analyzeTraceSummary, writeFindings } from "./lib/analyzer.mjs";
import { clearComboTraces } from "./lib/prune-combo-traces.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { assertPrototypeModel } from "./lib/model.mjs";
import { runPrototypeTask } from "./lib/run-prototype.mjs";
import { PROTOTYPE_MODELS, TASK_IDS, comboKey } from "./lib/tasks.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";
import { stringifyRepoJson } from "../../../lib/internal/tools/format/canonical-json-format.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolveHarnessRepoRoot();
const TRACE_DIR = path.join(HARNESS_ROOT, "calibration", "traces");
const FINDINGS_DIR = path.join(HARNESS_ROOT, "calibration", "findings");
const RAW_PATH = path.join(HARNESS_ROOT, "calibration", "raw", "matrix-samples.json");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ runs: number; overheadRuns: number; debugStream: boolean; skipOverhead: boolean }} */
  const out = {
    runs: 8,
    overheadRuns: 1,
    debugStream: false,
    skipOverhead: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug-stream") {
      out.debugStream = true;
      continue;
    }
    if (arg === "--skip-overhead") {
      out.skipOverhead = true;
      continue;
    }
    if (arg === "--runs" && argv[i + 1]) {
      out.runs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--runs=")) {
      out.runs = Number(arg.slice("--runs=".length));
      continue;
    }
    if (arg === "--overhead-runs" && argv[i + 1]) {
      out.overheadRuns = Number(argv[i + 1]);
      i += 1;
    }
  }
  if (!Number.isInteger(out.runs) || out.runs <= 0) {
    throw new Error("[context-usage] --runs must be a positive integer");
  }
  return out;
}

/**
 * @param {string[]} argv
 */
export async function calibrateMatrix(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  for (const model of PROTOTYPE_MODELS) {
    assertPrototypeModel(model);
  }

  if (!args.skipOverhead) {
    console.log("[context-usage] matrix: overhead probes");
    await calibrateOverhead(["--runs", String(args.overheadRuns)]);
  }

  /** @type {Record<string, number[]>} */
  const totalsByCombo = {};
  /** @type {Record<string, ReturnType<typeof analyzeTraceSummary>[]>} */
  const findingsByCombo = {};

  for (const taskId of TASK_IDS) {
    for (const model of PROTOTYPE_MODELS) {
      const combo = comboKey(taskId, model);
      const comboTraceDir = path.join(TRACE_DIR, combo);
      fs.mkdirSync(comboTraceDir, { recursive: true });
      clearComboTraces(comboTraceDir);
      totalsByCombo[combo] = [];
      findingsByCombo[combo] = [];
      for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
        console.log(`[context-usage] matrix run ${combo} ${runIndex}/${args.runs}`);
        const result = await runPrototypeTask({
          repoRoot: REPO_ROOT,
          harnessRoot: HARNESS_ROOT,
          traceDir: TRACE_DIR,
          taskId,
          modelId: model,
          runIndex,
          debugStream: args.debugStream,
        });
        if (result.ok && result.metrics) {
          totalsByCombo[combo].push(result.metrics.total_tokens);
          if (result.summary) {
            findingsByCombo[combo].push(analyzeTraceSummary(result.summary));
          }
        } else {
          console.error(`[context-usage] run failed ${combo}: ${result.error_message}`);
        }
      }
      writeFindings(FINDINGS_DIR, combo, findingsByCombo[combo]);
    }
  }

  fs.mkdirSync(path.dirname(RAW_PATH), { recursive: true });
  fs.writeFileSync(
    RAW_PATH,
    stringifyRepoJson(
      {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        runs_per_combo: args.runs,
        totals_by_combo: totalsByCombo,
      },
      REPO_ROOT,
    ),
  );
  console.log(`[context-usage] matrix samples written: ${RAW_PATH}`);

  const expectedPaths = establishExpectedFromRaw(["--raw", RAW_PATH]);
  console.log("\n[context-usage] === calibration summary ===");
  for (const combo of Object.keys(findingsByCombo)) {
    const findings = findingsByCombo[combo];
    const pv = findings.reduce((n, f) => n + f.policy_violations.length, 0);
    const ineff = findings.reduce((n, f) => n + f.inefficiencies.length, 0);
    console.log(`  ${combo}: policy_violations=${pv} inefficiencies=${ineff}`);
  }
  console.log(`  expected baselines: ${expectedPaths.length}`);
  console.log("[context-usage] next: batch-fix prompts/fixtures, then re-run pnpm run context:usage:calibrate");

  return { totalsByCombo, findingsByCombo, expectedPaths };
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  requireLiveEnv();
  if (!ensureCursorSdkRipgrepConfigured(REPO_ROOT)) {
    throw new Error("[context-usage] ripgrep binary not found.");
  }
  await calibrateMatrix();
}
