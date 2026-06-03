#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_MODEL,
  parseModelArg,
  resolveFdSessionBaselinePath,
  resolveModelBaselinePath,
  resolveSdkModelId,
} from "./lib/model.mjs";
import { buildSessionBaseline } from "./lib/session-trace.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const FD_TRACE_BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");
const modelId = parseModelArg(process.argv.slice(2), HARNESS_MODEL);
const MODEL_BASELINE_PATH = resolveModelBaselinePath(HARNESS_ROOT, modelId);
const SESSION_BASELINE_PATH = resolveFdSessionBaselinePath(HARNESS_ROOT, modelId);

const STAGE_ORDER = ["implement", "review", "test", "compliance"];

if (!fs.existsSync(FD_TRACE_BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing fd-trace baseline at ${FD_TRACE_BASELINE_PATH}. Run context:usage:fd-trace:baseline first.`,
  );
}
if (!fs.existsSync(MODEL_BASELINE_PATH)) {
  throw new Error(
    `[context-usage] missing model baseline at ${MODEL_BASELINE_PATH}. Run context:usage:baseline first.`,
  );
}

const fdTraceBaseline = JSON.parse(fs.readFileSync(FD_TRACE_BASELINE_PATH, "utf8"));
const modelBaseline = JSON.parse(fs.readFileSync(MODEL_BASELINE_PATH, "utf8"));
const liveEnvelope = modelBaseline?.live_envelope;
if (!liveEnvelope?.maxima) {
  throw new Error(
    `[context-usage] missing live envelope in ${MODEL_BASELINE_PATH}. Ratify a live report before building session baseline.`,
  );
}

const traceOrder = Object.values(fdTraceBaseline.traces ?? {})
  .sort((a, b) => {
    const aStage = STAGE_ORDER.indexOf(String(a.stage_id ?? ""));
    const bStage = STAGE_ORDER.indexOf(String(b.stage_id ?? ""));
    if (aStage !== bStage) {
      return (aStage === -1 ? Number.POSITIVE_INFINITY : aStage) -
        (bStage === -1 ? Number.POSITIVE_INFINITY : bStage);
    }
    return String(a.trace_id ?? "").localeCompare(String(b.trace_id ?? ""));
  })
  .map((entry) => String(entry.trace_id));

const sessionBaseline = buildSessionBaseline(fdTraceBaseline, liveEnvelope, {
  traceOrder,
  model: resolveSdkModelId(modelId),
  sourceTraceBaseline: "tests/compliance/context-usage/baselines/fd-skeleton.json",
  sourceModelBaseline: `tests/compliance/context-usage/baselines/${resolveSdkModelId(modelId)}.json`,
});

fs.mkdirSync(path.dirname(SESSION_BASELINE_PATH), { recursive: true });
fs.writeFileSync(SESSION_BASELINE_PATH, `${JSON.stringify(sessionBaseline, null, 2)}\n`);
console.log(`[context-usage] fd-session baseline written: ${SESSION_BASELINE_PATH}`);
