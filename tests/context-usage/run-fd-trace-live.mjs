#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertUsageCaptured, createEmptyMetrics, drainRunStream, processStreamEvent } from "./lib/collect-usage.mjs";
import {
  buildFdTracePrompt,
  compareTraceToBudget,
  copyFdFixtureToTemp,
  normalizeTraceToolPaths,
  readFdTraceContext,
  validateTraceReadPaths,
} from "./lib/fd-trace.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { resolveSdkModelId } from "./lib/model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(HARNESS_ROOT, "output");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");

requireLiveEnv();

const args = process.argv.slice(2);
let tracePathArg = "tests/context-usage/traces/fd-skeleton/implement.context.json";
let debugStream = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--debug-stream") {
    debugStream = true;
    continue;
  }
  if (arg === "--trace" && args[i + 1]) {
    tracePathArg = args[i + 1];
    i += 1;
    continue;
  }
  const traceEq = arg.match(/^--trace=(.+)$/u);
  if (traceEq) {
    tracePathArg = traceEq[1];
  }
}

const repoRoot = resolveHarnessRepoRoot();
const traceContextPath = path.isAbsolute(tracePathArg)
  ? tracePathArg
  : path.join(repoRoot, tracePathArg);
const context = readFdTraceContext(traceContextPath);
const fixtureRootAbs = path.join(repoRoot, context.fixture_root);
const stagePromptPath = path.join(fixtureRootAbs, context.stage_prompt.path);
const stagePromptText = fs.readFileSync(stagePromptPath, "utf8");
const prompt = buildFdTracePrompt(context, stagePromptText);
const sdkModelId = resolveSdkModelId(context.persona.model);
const fixtureCwd = await copyFdFixtureToTemp(fixtureRootAbs);

if (!ensureCursorSdkRipgrepConfigured(repoRoot)) {
  throw new Error(
    "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
  );
}

const { Agent } = await import("@cursor/sdk");
const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: sdkModelId },
  local: { cwd: fixtureCwd },
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const metrics = createEmptyMetrics();
const toolPaths = [];
const streamOptions = { debugStream };
const startMs = Date.now();
try {
  const run = await agent.send(prompt, {
    model: { id: sdkModelId },
    onDelta: ({ update }) => {
      processStreamEvent(update, metrics, toolPaths, streamOptions);
    },
  });
  await drainRunStream(run, { metrics, toolPaths, wallStartMs: startMs, ...streamOptions });
  await run.wait();
  assertUsageCaptured(metrics);
} finally {
  agent.close();
}

const normalizedReads = normalizeTraceToolPaths(toolPaths, fixtureCwd);
const readErrors = validateTraceReadPaths(normalizedReads, context);
for (const relArtifact of context.required_artifact_paths) {
  const artifactAbs = path.join(fixtureCwd, relArtifact);
  if (!fs.existsSync(artifactAbs)) {
    readErrors.push(`missing required artifact after run: ${relArtifact}`);
  }
}

if (!fs.existsSync(BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing fd-trace baseline at ${BASELINE_PATH}. Run: node tests/context-usage/establish-fd-trace-baseline.mjs`,
  );
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const budget = baseline?.traces?.[context.trace_id];
if (!budget) {
  throw new Error(
    `[context-usage] baseline has no trace entry for ${context.trace_id}. Rebuild fd-trace baseline.`,
  );
}
const budgetComparison = compareTraceToBudget(metrics, budget);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.join(OUTPUT_DIR, `${stamp}-fd-trace-${context.trace_id}.json`);
const report = {
  timestamp: new Date().toISOString(),
  trace_id: context.trace_id,
  stage_id: context.stage_id,
  model: sdkModelId,
  trace_context: path.relative(repoRoot, traceContextPath).replace(/\\/g, "/"),
  metrics,
  normalized_reads: normalizedReads,
  read_verification: {
    ok: readErrors.length === 0,
    errors: readErrors,
  },
  budget_comparison: budgetComparison,
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

if (readErrors.length > 0 || !budgetComparison.ok) {
  console.error(`[context-usage] fd trace comparison failed (report: ${outPath})`);
  for (const err of readErrors) {
    console.error(`  - ${err}`);
  }
  for (const err of budgetComparison.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`[context-usage] fd trace run OK — report: ${outPath}`);
