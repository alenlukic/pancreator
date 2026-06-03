#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertUsageCaptured, createEmptyMetrics, drainRunStream, processStreamEvent } from "./lib/collect-usage.mjs";
import {
  buildFdTracePrompt,
  compareTraceToBudget,
  copyFdFixtureToTemp,
  readFdTraceContext,
  normalizeTraceToolPaths,
  validateTraceReadPaths,
} from "./lib/fd-trace.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { HARNESS_MODEL, parseModelArg, resolveFdSessionBaselinePath, resolveSdkModelId } from "./lib/model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";
import { buildRuntimeMetadata } from "./lib/runtime-meta.mjs";
import { compareSessionToBaseline } from "./lib/session-trace.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(HARNESS_ROOT, "output");
const FD_TRACE_BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  const parsed = { debugStream: false, modelOverride: undefined };
  parsed.modelOverride = parseModelArg(args, HARNESS_MODEL);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--debug-stream") {
      parsed.debugStream = true;
      continue;
    }
    if (arg === "--model" && args[i + 1]) {
      parsed.modelOverride = resolveSdkModelId(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      parsed.modelOverride = resolveSdkModelId(arg.slice("--model=".length));
    }
  }
  return parsed;
}

requireLiveEnv();

const repoRoot = resolveHarnessRepoRoot();
if (!ensureCursorSdkRipgrepConfigured(repoRoot)) {
  throw new Error(
    "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
  );
}
if (!fs.existsSync(FD_TRACE_BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing fd-trace baseline at ${FD_TRACE_BASELINE_PATH}. Run context:usage:fd-trace:baseline first.`,
  );
}
if (!fs.existsSync(SESSION_BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing fd-session baseline at ${SESSION_BASELINE_PATH}. Run context:usage:fd-trace:session:baseline first.`,
  );
}

const parsedArgs = parseArgs(process.argv.slice(2));
const SESSION_BASELINE_PATH = resolveFdSessionBaselinePath(HARNESS_ROOT, parsedArgs.modelOverride);
const fdTraceBaseline = JSON.parse(fs.readFileSync(FD_TRACE_BASELINE_PATH, "utf8"));
const sessionBaseline = JSON.parse(fs.readFileSync(SESSION_BASELINE_PATH, "utf8"));
const traceSequence = sessionBaseline.trace_sequence ?? [];
if (!Array.isArray(traceSequence) || traceSequence.length === 0) {
  throw new Error("[context-usage] session baseline has empty trace_sequence");
}

const contextPaths = traceSequence.map((traceId) => {
  const trace = fdTraceBaseline?.traces?.[traceId];
  if (!trace?.context_file) {
    throw new Error(`[context-usage] fd-trace baseline missing context_file for ${traceId}`);
  }
  return path.join(repoRoot, trace.context_file);
});

const contexts = contextPaths.map(readFdTraceContext);
const fixtureRoots = [...new Set(contexts.map((ctx) => ctx.fixture_root))];
if (fixtureRoots.length !== 1) {
  throw new Error("[context-usage] session runner expects all trace contexts to share a fixture_root");
}
const fixtureCwd = await copyFdFixtureToTemp(path.join(repoRoot, fixtureRoots[0]));
const modelIds = [...new Set(contexts.map((ctx) => resolveSdkModelId(ctx.persona.model)))];
if (modelIds.length !== 1) {
  throw new Error("[context-usage] session runner expects all trace contexts to share one model");
}
const sdkModelId = parsedArgs.modelOverride ?? modelIds[0];
if (resolveSdkModelId(String(sessionBaseline.model ?? "")) !== sdkModelId) {
  throw new Error(
    `[context-usage] session baseline model=${sessionBaseline.model} does not match requested model=${sdkModelId}`,
  );
}
const { Agent } = await import("@cursor/sdk");
const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: sdkModelId },
  local: { cwd: fixtureCwd, settingSources: ["project"] },
});

/** @type {Array<{
 * trace_id: string;
 * stage_id: string;
 * model: string;
 * trace_context: string;
 * metrics: import("./lib/collect-usage.mjs").UsageMetrics;
 * normalized_reads: string[];
 * read_verification: { ok: boolean; errors: string[] };
 * budget_comparison: { ok: boolean; errors: string[] };
 * ok: boolean;
 * }>} */
const steps = [];
try {
  for (let i = 0; i < contexts.length; i += 1) {
    const context = contexts[i];
    const stagePromptAbs = path.join(fixtureCwd, context.stage_prompt.path);
    const stagePromptText = fs.readFileSync(stagePromptAbs, "utf8");
    const prompt = buildFdTracePrompt(context, stagePromptText);

    const metrics = createEmptyMetrics();
    const toolPaths = [];
    const startMs = Date.now();
    const streamOptions = { debugStream: parsedArgs.debugStream };
    const run = await agent.send(prompt, {
      model: { id: sdkModelId },
      onDelta: ({ update }) => {
        processStreamEvent(update, metrics, toolPaths, streamOptions);
      },
    });
    await drainRunStream(run, { metrics, toolPaths, wallStartMs: startMs, ...streamOptions });
    await run.wait();
    assertUsageCaptured(metrics);

    const normalizedReads = normalizeTraceToolPaths(toolPaths, fixtureCwd);
    const readErrors = validateTraceReadPaths(normalizedReads, context);
    for (const relArtifact of context.required_artifact_paths) {
      const artifactAbs = path.join(fixtureCwd, relArtifact);
      if (!fs.existsSync(artifactAbs)) {
        readErrors.push(`missing required artifact after run: ${relArtifact}`);
      }
    }

    const budget = fdTraceBaseline?.traces?.[context.trace_id];
    if (!budget) {
      throw new Error(`[context-usage] fd-trace baseline missing entry for ${context.trace_id}`);
    }
    const budgetComparison = compareTraceToBudget(metrics, budget, { requireLiveEnvelope: true });
    const readVerification = { ok: readErrors.length === 0, errors: readErrors };
    const ok = readVerification.ok && budgetComparison.ok;
    steps.push({
      trace_id: context.trace_id,
      stage_id: context.stage_id,
      model: sdkModelId,
      trace_context: path.relative(repoRoot, contextPaths[i]).replace(/\\/g, "/"),
      metrics,
      normalized_reads: normalizedReads,
      read_verification: readVerification,
      budget_comparison: budgetComparison,
      ok,
    });
  }
} finally {
  agent.close();
}

const sessionComparison = compareSessionToBaseline(
  steps.map((step) => ({ trace_id: step.trace_id, metrics: step.metrics })),
  sessionBaseline,
);
const stepErrors = steps.flatMap((step) => [
  ...step.read_verification.errors.map((err) => `[${step.trace_id}] ${err}`),
  ...step.budget_comparison.errors.map((err) => `[${step.trace_id}] ${err}`),
]);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUTPUT_DIR, `${stamp}-fd-session-report.json`);
const report = {
  timestamp: new Date().toISOString(),
  mode: "session",
  model: sdkModelId,
  runtime: buildRuntimeMetadata(),
  trace_sequence: traceSequence,
  steps,
  step_verification: {
    ok: stepErrors.length === 0,
    errors: stepErrors,
  },
  session_comparison: sessionComparison,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (stepErrors.length > 0 || !sessionComparison.ok) {
  console.error(`[context-usage] fd session comparison failed (report: ${reportPath})`);
  for (const err of stepErrors) {
    console.error(`  - ${err}`);
  }
  for (const err of sessionComparison.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`[context-usage] fd session run OK — report: ${reportPath}`);
