#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBudgetBaseline,
  buildLiveEnvelope,
  comparableBudgetBaseline,
} from "./lib/stats.mjs";
import { HARNESS_MODEL, parseModelArg, resolveModelBaselinePath, resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let reportArg;
  let allowRuntimeChange = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-runtime-change") {
      allowRuntimeChange = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      reportArg = arg;
      break;
    }
  }
  return {
    reportArg,
    allowRuntimeChange,
    modelId: parseModelArg(argv, HARNESS_MODEL),
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.reportArg) {
  console.error(
    "[context-usage] usage: node tests/compliance/context-usage/establish-live-envelope.mjs [--model <id>] [--allow-runtime-change] <report.json>",
  );
  process.exit(1);
}

const BASELINE_PATH = resolveModelBaselinePath(HARNESS_ROOT, args.modelId);
const reportPath = path.isAbsolute(args.reportArg)
  ? args.reportArg
  : path.resolve(process.cwd(), args.reportArg);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

if (resolveSdkModelId(String(report.model ?? "")) !== args.modelId) {
  console.error(
    `[context-usage] refuse to ratify live envelope: report.model=${report.model} does not match selected model=${args.modelId}`,
  );
  process.exit(1);
}
if (!report.runtime?.sdk_version) {
  console.error("[context-usage] refuse to ratify live envelope: report.runtime.sdk_version is required");
  process.exit(1);
}

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

const derived = buildBudgetBaseline({ modelId: args.modelId });
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
if (
  existing?.live_envelope?.runtime?.sdk_version &&
  existing.live_envelope.runtime.sdk_version !== report.runtime.sdk_version &&
  !args.allowRuntimeChange
) {
  console.error(
    `[context-usage] refuse to ratify live envelope: existing sdk_version=${existing.live_envelope.runtime.sdk_version} differs from report sdk_version=${report.runtime.sdk_version}. Re-run with --allow-runtime-change to intentionally re-anchor.`,
  );
  process.exit(1);
}

const baseline = existing ?? derived;
baseline.live_envelope = buildLiveEnvelope(baseline, {
  ratified_at: new Date().toISOString(),
  source_report: path
    .relative(path.resolve(HARNESS_ROOT, "..", "..", ".."), reportPath)
    .replace(/\\/g, "/"),
  metrics: {
    input_tokens: metrics.input_tokens,
    output_tokens: metrics.output_tokens,
    cache_read_tokens: metrics.cache_read_tokens,
    cache_write_tokens: metrics.cache_write_tokens ?? 0,
    total_tokens: metrics.total_tokens,
    tool_read_count: metrics.tool_read_count,
  },
  runtime: report.runtime,
});

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`[context-usage] live envelope ratified into: ${BASELINE_PATH}`);
