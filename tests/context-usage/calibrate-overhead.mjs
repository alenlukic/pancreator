#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertUsageCaptured,
  createEmptyMetrics,
  drainRunStream,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import { requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { HARNESS_MODEL, resolveSdkModelId } from "./lib/model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolveHarnessRepoRoot();
const RAW_DIR = path.join(HARNESS_ROOT, "calibration", "raw");

const NOOP_PROMPT = `
Overhead calibration probe.
Do not call tools.
Do not read files.
Do not load further context.
Reply with exactly:
OVERHEAD_CALIBRATION_OK
Then terminate immediately.
`.trim();

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   runs: number;
   *   models: string[];
   *   output?: string;
   *   debugStream: boolean;
   * }} */
  const out = {
    runs: 10,
    models: [HARNESS_MODEL],
    output: undefined,
    debugStream: false,
  };

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
      continue;
    }
    if (arg.startsWith("--models=")) {
      out.models = arg
        .slice("--models=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--output" && argv[i + 1]) {
      out.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      out.output = arg.slice("--output=".length);
      continue;
    }
  }

  if (!Number.isInteger(out.runs) || out.runs <= 0) {
    throw new Error("[context-usage] --runs must be a positive integer");
  }
  if (out.models.length === 0) {
    throw new Error("[context-usage] at least one model is required");
  }
  return out;
}

/**
 * @param {{
 *   sdkModelId: string;
 *   cwd: string;
 *   debugStream: boolean;
 * }} input
 */
async function runNoopProbe(input) {
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: input.sdkModelId },
    local: { cwd: input.cwd },
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
    return {
      metrics,
      tool_read_count: metrics.tool_read_count,
      tool_paths: toolPaths,
    };
  } finally {
    agent.close();
  }
}

requireLiveEnv();

if (!ensureCursorSdkRipgrepConfigured(REPO_ROOT)) {
  throw new Error(
    "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
  );
}

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = args.output
  ? path.resolve(process.cwd(), args.output)
  : path.join(RAW_DIR, `${stamp}-overhead-samples.json`);

/** @type {Array<{ model: string; sdk_model_id: string; samples: { repo_root: any[]; empty_dir: any[] } }>} */
const models = [];

for (const model of args.models) {
  const sdkModelId = resolveSdkModelId(model);
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-usage-empty-"));
  /** @type {{ repo_root: any[]; empty_dir: any[] }} */
  const samples = {
    repo_root: [],
    empty_dir: [],
  };
  try {
    for (const condition of ["repo_root", "empty_dir"]) {
      const cwd = condition === "repo_root" ? REPO_ROOT : emptyDir;
      for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
        try {
          const probe = await runNoopProbe({
            sdkModelId,
            cwd,
            debugStream: args.debugStream,
          });
          samples[condition].push({
            run_index: runIndex,
            condition,
            cwd,
            metrics: probe.metrics,
            tool_read_count: probe.tool_read_count,
            tool_paths: probe.tool_paths,
            ok: true,
          });
        } catch (error) {
          samples[condition].push({
            run_index: runIndex,
            condition,
            cwd,
            ok: false,
            error_message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
  models.push({
    model,
    sdk_model_id: sdkModelId,
    samples,
  });
}

const payload = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  prompt_id: "noop_terminate_v1",
  prompt_text: NOOP_PROMPT,
  runs_per_condition: args.runs,
  models,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[context-usage] calibration samples written: ${outputPath}`);
