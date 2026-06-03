#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertUsageCaptured,
  createEmptyMetrics,
  drainRunStream,
  extractReadPathsFromToolEvent,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import {
  buildFdTraceDisparityAnalysis,
  buildFdTracePrompt,
  compareTraceToBudget,
  copyFdFixtureToTemp,
  listFdTraceContextFiles,
  normalizeTraceToolPaths,
  readFdTraceContext,
  validateTraceReadPaths,
} from "./lib/fd-trace.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { resolveSdkModelId } from "./lib/model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";
import { buildRuntimeMetadata } from "./lib/runtime-meta.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(HARNESS_ROOT, "output");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");
const TRACE_ROOT = path.join(HARNESS_ROOT, "traces");

requireLiveEnv();

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  const parsed = {
    tracePathArg: "tests/compliance/context-usage/traces/fd-skeleton/implement.context.json",
    runAll: false,
    debugStream: false,
    debugContext: false,
    modelOverride: undefined,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--debug-stream") {
      parsed.debugStream = true;
      continue;
    }
    if (arg === "--all") {
      parsed.runAll = true;
      continue;
    }
    if (arg === "--debug-context") {
      parsed.debugContext = true;
      continue;
    }
    if (arg === "--trace" && args[i + 1]) {
      parsed.tracePathArg = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--model" && args[i + 1]) {
      parsed.modelOverride = resolveSdkModelId(args[i + 1]);
      i += 1;
      continue;
    }
    const modelEq = arg.match(/^--model=(.+)$/u);
    if (modelEq) {
      parsed.modelOverride = resolveSdkModelId(modelEq[1]);
      continue;
    }
    const traceEq = arg.match(/^--trace=(.+)$/u);
    if (traceEq) {
      parsed.tracePathArg = traceEq[1];
    }
  }
  return parsed;
}

const parsedArgs = parseArgs(process.argv.slice(2));
const repoRoot = resolveHarnessRepoRoot();
if (!ensureCursorSdkRipgrepConfigured(repoRoot)) {
  throw new Error(
    "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
  );
}

if (!fs.existsSync(BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing fd-trace baseline at ${BASELINE_PATH}. Run: node tests/compliance/context-usage/establish-fd-trace-baseline.mjs`,
  );
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

const { Agent } = await import("@cursor/sdk");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * @param {string} traceContextPath
 */
async function runSingleTrace(traceContextPath) {
  const context = readFdTraceContext(traceContextPath);
  const fixtureRootAbs = path.join(repoRoot, context.fixture_root);
  const stagePromptPath = path.join(fixtureRootAbs, context.stage_prompt.path);
  const stagePromptText = fs.readFileSync(stagePromptPath, "utf8");
  const prompt = buildFdTracePrompt(context, stagePromptText);
  const sdkModelId = parsedArgs.modelOverride ?? resolveSdkModelId(context.persona.model);
  const fixtureCwd = await copyFdFixtureToTemp(fixtureRootAbs);

  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: sdkModelId },
    local: { cwd: fixtureCwd, settingSources: ["project"] },
  });
  const metrics = createEmptyMetrics();
  const toolPaths = [];
  /** @type {{ event_index: number; raw_path: string }[]} */
  const readEvents = [];
  const streamOptions = { debugStream: parsedArgs.debugStream };
  const startMs = Date.now();
  let eventIndex = 0;
  /**
   * @param {unknown} update
   */
  function captureReadEvents(update) {
    eventIndex += 1;
    for (const rawPath of extractReadPathsFromToolEvent(update)) {
      readEvents.push({
        event_index: eventIndex,
        raw_path: rawPath,
      });
    }
  }
  try {
    const run = await agent.send(prompt, {
      model: { id: sdkModelId },
      onDelta: ({ update }) => {
        processStreamEvent(update, metrics, toolPaths, streamOptions);
        captureReadEvents(update);
      },
    });
    await drainRunStream(run, {
      metrics,
      toolPaths,
      wallStartMs: startMs,
      onEvent: captureReadEvents,
      ...streamOptions,
    });
    await run.wait();
    assertUsageCaptured(metrics);
  } finally {
    agent.close();
  }

  const normalizedReads = normalizeTraceToolPaths(toolPaths, fixtureCwd);
  const normalizedReadEvents = readEvents
    .map((event) => {
      const normalized = normalizeTraceToolPaths([event.raw_path], fixtureCwd)[0];
      return normalized ? { event_index: event.event_index, path: normalized } : null;
    })
    .filter(Boolean);
  const readErrors = validateTraceReadPaths(normalizedReads, context);
  for (const relArtifact of context.required_artifact_paths) {
    const artifactAbs = path.join(fixtureCwd, relArtifact);
    if (!fs.existsSync(artifactAbs)) {
      readErrors.push(`missing required artifact after run: ${relArtifact}`);
    }
  }
  const budget = baseline?.traces?.[context.trace_id];
  if (!budget) {
    throw new Error(
      `[context-usage] baseline has no trace entry for ${context.trace_id}. Rebuild fd-trace baseline.`,
    );
  }
  if (budget.model && resolveSdkModelId(String(budget.model)) !== sdkModelId) {
    throw new Error(
      `[context-usage] trace baseline model mismatch for ${context.trace_id}: budget.model=${budget.model} run.model=${sdkModelId}. Rebuild deterministic baseline for this model before live run.`,
    );
  }
  const budgetComparison = compareTraceToBudget(metrics, budget, { requireLiveEnvelope: true });
  const contextAnalysis = buildFdTraceDisparityAnalysis({
    context,
    budget,
    promptText: prompt,
    fixtureAbs: fixtureCwd,
    normalizedReads,
    readEvents: normalizedReadEvents,
    observedMetrics: metrics,
  });
  const readVerification = {
    ok: readErrors.length === 0,
    errors: readErrors,
  };
  if (parsedArgs.debugContext) {
    const summary = {
      trace_id: context.trace_id,
      prompt_tokens_est: contextAnalysis.prompt_tokens_est,
      required_read_tokens_est: contextAnalysis.expected_required_inputs.total_estimated_tokens,
      observed_read_tokens_est: contextAnalysis.observed_inputs.total_estimated_tokens,
      allowance_total_est: contextAnalysis.allowance_total_est,
      observed_input_tokens: contextAnalysis.observed_input_tokens,
      observed_estimate_with_allowances: contextAnalysis.observed_estimate_with_allowances,
      unexplained_input_tokens: contextAnalysis.unexplained_input_tokens,
      envelope_comparison: contextAnalysis.envelope_comparison,
    };
    console.error("[context-usage:debug] context-analysis", JSON.stringify(summary));
  }
  const ok = readVerification.ok && budgetComparison.ok;
  return {
    trace_id: context.trace_id,
    stage_id: context.stage_id,
    model: sdkModelId,
    trace_context: path.relative(repoRoot, traceContextPath).replace(/\\/g, "/"),
    metrics,
    normalized_reads: normalizedReads,
    read_events: normalizedReadEvents,
    read_verification: readVerification,
    budget_comparison: budgetComparison,
    context_analysis: contextAnalysis,
    ok,
  };
}

const traceContextPaths = parsedArgs.runAll
  ? listFdTraceContextFiles(TRACE_ROOT)
  : [
      path.isAbsolute(parsedArgs.tracePathArg)
        ? parsedArgs.tracePathArg
        : path.join(repoRoot, parsedArgs.tracePathArg),
    ];
if (traceContextPaths.length === 0) {
  throw new Error(`[context-usage] no trace context files found under ${TRACE_ROOT}`);
}

const traces = [];
for (const traceContextPath of traceContextPaths) {
  traces.push(await runSingleTrace(traceContextPath));
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (parsedArgs.runAll) {
  const summary = {
    total: traces.length,
    passed: traces.filter((entry) => entry.ok).length,
    failed: traces.filter((entry) => !entry.ok).length,
    ok: traces.every((entry) => entry.ok),
  };
  const outPath = path.join(OUTPUT_DIR, `${stamp}-fd-trace-suite.json`);
  const report = {
    timestamp: new Date().toISOString(),
    mode: "suite",
    runtime: buildRuntimeMetadata(),
    summary,
    traces,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  if (!summary.ok) {
    console.error(`[context-usage] fd trace suite failed (report: ${outPath})`);
    for (const trace of traces) {
      if (trace.ok) {
        continue;
      }
      for (const err of trace.read_verification.errors) {
        console.error(`  - [${trace.trace_id}] ${err}`);
      }
      for (const err of trace.budget_comparison.errors) {
        console.error(`  - [${trace.trace_id}] ${err}`);
      }
    }
    process.exit(1);
  }
  console.log(`[context-usage] fd trace suite OK — report: ${outPath}`);
} else {
  const [trace] = traces;
  const outPath = path.join(OUTPUT_DIR, `${stamp}-fd-trace-${trace.trace_id}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    trace_id: trace.trace_id,
    stage_id: trace.stage_id,
    model: trace.model,
    runtime: buildRuntimeMetadata(),
    trace_context: trace.trace_context,
    metrics: trace.metrics,
    normalized_reads: trace.normalized_reads,
    read_events: trace.read_events,
    read_verification: trace.read_verification,
    budget_comparison: trace.budget_comparison,
    context_analysis: trace.context_analysis,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  if (!trace.ok) {
    console.error(`[context-usage] fd trace comparison failed (report: ${outPath})`);
    for (const err of trace.read_verification.errors) {
      console.error(`  - ${err}`);
    }
    for (const err of trace.budget_comparison.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`[context-usage] fd trace run OK — report: ${outPath}`);
}
