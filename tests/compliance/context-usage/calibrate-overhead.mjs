#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeMetric } from "./lib/calibration-stats.mjs";
import {
  assertUsageCaptured,
  createEmptyMetrics,
  drainRunStream,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { PROTOTYPE_MODELS } from "./lib/tasks.mjs";
import { assertPrototypeModel, resolveOverheadBaselinePath, resolveSdkModelId } from "./lib/model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";
import { stringifyRepoJson } from "../../../lib/internal/tools/canonical-json-format.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolveHarnessRepoRoot();

const NOOP_PROMPT = `
Overhead calibration probe.
Do not call tools.
Do not read files.
Reply with exactly: OVERHEAD_CALIBRATION_OK
Then stop.
`.trim();

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ runs: number; models: string[]; debugStream: boolean }} */
  const out = { runs: 10, models: [...PROTOTYPE_MODELS], debugStream: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug-stream") {
      out.debugStream = true;
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
    if (arg === "--models" && argv[i + 1]) {
      out.models = argv[i + 1].split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    }
  }
  if (!Number.isInteger(out.runs) || out.runs <= 0) {
    throw new Error("[context-usage] --runs must be a positive integer");
  }
  for (const model of out.models) {
    assertPrototypeModel(model);
  }
  return out;
}

/**
 * @param {{ sdkModelId: string; debugStream: boolean }} input
 */
async function runNoopProbe(input) {
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: input.sdkModelId },
    local: { cwd: REPO_ROOT, settingSources: ["project"] },
  });
  try {
    const metrics = createEmptyMetrics();
    const toolPaths = [];
    const start = Date.now();
    const run = await agent.send(NOOP_PROMPT, {
      model: { id: input.sdkModelId },
      onDelta: ({ update }) => {
        processStreamEvent(update, metrics, toolPaths, { debugStream: input.debugStream });
      },
    });
    await drainRunStream(run, {
      metrics,
      toolPaths,
      wallStartMs: start,
      debugStream: input.debugStream,
    });
    await run.wait();
    assertUsageCaptured(metrics);
    return metrics;
  } finally {
    agent.close();
  }
}

/**
 * @param {string[]} argv
 */
export async function calibrateOverhead(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  /** @type {Record<string, number[]>} */
  const totalsByModel = {};

  for (const model of args.models) {
    const sdkModelId = resolveSdkModelId(model);
    totalsByModel[sdkModelId] = [];
    for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
      const metrics = await runNoopProbe({ sdkModelId, debugStream: args.debugStream });
      totalsByModel[sdkModelId].push(metrics.total_tokens);
      console.log(
        `[context-usage] overhead probe ${sdkModelId} run ${runIndex}/${args.runs}: total=${metrics.total_tokens}`,
      );
    }
    const summary = summarizeMetric(totalsByModel[sdkModelId]);
    const baseline = {
      schema_version: 1,
      kind: "overhead",
      model: sdkModelId,
      prompt_id: "noop_terminate_v1",
      sample_count: summary.n,
      total_tokens: summary,
      generated_at: new Date().toISOString(),
    };
    const outPath = resolveOverheadBaselinePath(HARNESS_ROOT, sdkModelId);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, stringifyRepoJson(baseline, REPO_ROOT));
    console.log(`[context-usage] overhead baseline written: ${outPath}`);
  }

  return totalsByModel;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  requireLiveEnv();
  if (!ensureCursorSdkRipgrepConfigured(REPO_ROOT)) {
    throw new Error("[context-usage] ripgrep binary not found.");
  }
  await calibrateOverhead();
}
