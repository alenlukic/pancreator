#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireLiveEnv } from "./lib/live-env.mjs";
import { runContextUsageOnce } from "./lib/run-once.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(HARNESS_ROOT, "output");

requireLiveEnv();

const debugStream = process.argv.includes("--debug-stream");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const result = await runContextUsageOnce({ debugStream });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUTPUT_DIR, `${stamp}-report.json`);
const report = {
  timestamp: new Date().toISOString(),
  model: "composer-2.5",
  fixture_hash: result.fixture_hash,
  prompt_version: result.prompt_version,
  metrics: result.metrics,
  verification: result.verify,
  budget_comparison: result.budgetComparison,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (result.budgetComparison.warnings?.length) {
  console.warn("[context-usage] budget warnings:");
  for (const warning of result.budgetComparison.warnings) {
    console.warn(`  - ${warning}`);
  }
}

if (!result.budgetComparison.ok) {
  console.error("[context-usage] budget comparison failed:");
  for (const err of result.budgetComparison.errors) {
    console.error(`  - ${err}`);
  }
  console.error(`[context-usage] report written: ${reportPath}`);
  process.exit(1);
}

console.log(`[context-usage] run OK — report: ${reportPath}`);
