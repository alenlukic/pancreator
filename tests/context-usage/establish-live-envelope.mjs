#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBudgetBaseline,
  buildLiveEnvelope,
  comparableBudgetBaseline,
} from "./lib/stats.mjs";
import { HARNESS_MODEL, resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "composer-2.5.json");

const reportArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
if (!reportArg) {
  console.error(
    "[context-usage] usage: node tests/context-usage/establish-live-envelope.mjs <report.json>",
  );
  process.exit(1);
}

const reportPath = path.isAbsolute(reportArg)
  ? reportArg
  : path.resolve(process.cwd(), reportArg);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

if (report.verification?.ok !== true) {
  console.error(
    "[context-usage] refuse to ratify live envelope: report verification failed",
  );
  if (Array.isArray(report.verification?.errors)) {
    for (const err of report.verification.errors) {
      console.error(`  - ${err}`);
    }
  }
  process.exit(1);
}

const metrics = report.metrics ?? {};
for (const key of ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"]) {
  if (!Number.isFinite(Number(metrics[key]))) {
    console.error(`[context-usage] report missing metrics.${key}`);
    process.exit(1);
  }
}

const modelId = resolveSdkModelId(HARNESS_MODEL);
const derived = buildBudgetBaseline({ modelId });
const existing = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : null;

if (
  existing &&
  comparableBudgetBaseline(existing).fixture_hash !== derived.fixture_hash
) {
  console.error(
    "[context-usage] baseline fixture_hash differs from current fixture — re-run: pnpm run context:usage:baseline",
  );
  process.exit(1);
}

const baseline = existing ?? derived;
baseline.live_envelope = buildLiveEnvelope(baseline, {
  ratified_at: new Date().toISOString(),
  source_report: path.relative(path.resolve(HARNESS_ROOT, "..", ".."), reportPath).replace(/\\/g, "/"),
  metrics: {
    input_tokens: metrics.input_tokens,
    output_tokens: metrics.output_tokens,
    cache_read_tokens: metrics.cache_read_tokens,
    cache_write_tokens: metrics.cache_write_tokens ?? 0,
    total_tokens: metrics.total_tokens,
    tool_read_count: metrics.tool_read_count,
  },
});

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`[context-usage] live envelope ratified into: ${BASELINE_PATH}`);
