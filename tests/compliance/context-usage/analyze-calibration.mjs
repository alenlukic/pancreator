#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeTraceSummary, writeFindings } from "./lib/analyzer.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TRACE_ROOT = path.join(HARNESS_ROOT, "calibration", "traces");
const FINDINGS_DIR = path.join(HARNESS_ROOT, "calibration", "findings");

/**
 * Re-analyze existing *.summary.json artifacts under calibration/traces/.
 */
function main() {
  if (!fs.existsSync(TRACE_ROOT)) {
    console.error("[context-usage] no traces directory");
    process.exit(1);
  }
  for (const combo of fs.readdirSync(TRACE_ROOT)) {
    const comboDir = path.join(TRACE_ROOT, combo);
    if (!fs.statSync(comboDir).isDirectory()) {
      continue;
    }
    const summaries = fs
      .readdirSync(comboDir)
      .filter((name) => name.endsWith(".summary.json"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(comboDir, name), "utf8")));
    const findings = summaries.map((summary) => analyzeTraceSummary(summary));
    const out = writeFindings(FINDINGS_DIR, combo, findings);
    console.log(`[context-usage] findings written: ${out}`);
  }
}

main();
