#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFdTraceBudget,
  buildFdTracePrompt,
  listFdTraceContextFiles,
  readFdTraceContext,
} from "./lib/fd-trace.mjs";
import { resolveModelBaselinePath, resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TRACE_DIR = path.join(HARNESS_ROOT, "traces");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");
const REPO_ROOT = path.resolve(HARNESS_ROOT, "..", "..", "..");

const traceContextFiles = listFdTraceContextFiles(TRACE_DIR);
if (traceContextFiles.length === 0) {
  throw new Error(
    `[context-usage] no fd-trace context files found under ${TRACE_DIR}. Expected *.context.json files.`,
  );
}

/** @type {Record<string, unknown>} */
const traces = {};
/** @type {Map<string, any>} */
const modelBaselineCache = new Map();
for (const contextPath of traceContextFiles) {
  const context = readFdTraceContext(contextPath);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const stagePromptAbs = path.join(fixtureAbs, context.stage_prompt.path);
  const stagePromptText = fs.readFileSync(stagePromptAbs, "utf8");
  const promptText = buildFdTracePrompt(context, stagePromptText);
  const modelId = resolveSdkModelId(context.persona.model);
  if (!modelBaselineCache.has(modelId)) {
    const modelBaselinePath = resolveModelBaselinePath(HARNESS_ROOT, modelId);
    const baseline = fs.existsSync(modelBaselinePath)
      ? JSON.parse(fs.readFileSync(modelBaselinePath, "utf8"))
      : null;
    modelBaselineCache.set(modelId, baseline);
  }
  const modelBaseline = modelBaselineCache.get(modelId);
  const traceBudget = buildFdTraceBudget(context, promptText, fixtureAbs);
  if (!modelBaseline?.live_envelope?.maxima) {
    throw new Error(
      `[context-usage] missing live_envelope maxima in model baseline for ${modelId}. Ratify ${modelId} first, then rerun context:usage:fd-trace:baseline.`,
    );
  }
  traceBudget.live_envelope = {
    source_model_baseline: `tests/compliance/context-usage/baselines/${modelId}.json`,
    ...modelBaseline.live_envelope,
  };
  traces[context.trace_id] = {
    context_file: path.relative(REPO_ROOT, contextPath).replace(/\\/g, "/"),
    ...traceBudget,
  };
}

const baseline = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  traces,
};

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
console.log(`[context-usage] fd-trace baseline written: ${BASELINE_PATH}`);
