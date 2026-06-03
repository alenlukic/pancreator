import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copySandboxToTemp } from "./copy-sandbox.mjs";
import {
  assertUsageCaptured,
  createEmptyMetrics,
  drainRunStream,
  processStreamEvent,
} from "./collect-usage.mjs";
import { HARNESS_MODEL, resolveSdkModelId } from "./model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./ripgrep.mjs";
import { verifySandboxRun } from "./verify-run.mjs";
import { buildBudgetBaseline, compareToBudget, computeFixtureHash, readPromptVersion } from "./stats.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = path.join(HARNESS_ROOT, "prompt.md");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "composer-2.5.json");

/**
 * @param {{ debugStream?: boolean; skipBaseline?: boolean }} [options]
 */
export async function runContextUsageOnce(options = {}) {
  const repoRoot = path.resolve(HARNESS_ROOT, "..", "..");
  if (!ensureCursorSdkRipgrepConfigured(repoRoot)) {
    throw new Error(
      "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
    );
  }

  const prompt = fs.readFileSync(PROMPT_PATH, "utf8");
  const sandboxCwd = await copySandboxToTemp();
  const sdkModelId = resolveSdkModelId(HARNESS_MODEL);

  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: sdkModelId },
    local: { cwd: sandboxCwd },
  });

  try {
    const metrics = createEmptyMetrics();
    const toolPaths = [];
    const start = Date.now();
    const streamOptions = { debugStream: options.debugStream };

    const run = await agent.send(prompt, {
      model: { id: sdkModelId },
      onDelta: ({ update }) => {
        processStreamEvent(update, metrics, toolPaths, streamOptions);
      },
    });
    await drainRunStream(run, { metrics, toolPaths, wallStartMs: start, ...streamOptions });
    await run.wait();
    assertUsageCaptured(metrics);

    const verify = verifySandboxRun(sandboxCwd, toolPaths, prompt, undefined, metrics);
    if (!verify.ok) {
      throw new Error(`[context-usage] verification failed:\n${verify.errors.join("\n")}`);
    }

    let budgetComparison = { ok: true, errors: [] };
    if (!options.skipBaseline && fs.existsSync(BASELINE_PATH)) {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
      budgetComparison = compareToBudget(metrics, baseline);
    } else if (!options.skipBaseline) {
      const baseline = buildBudgetBaseline({ modelId: sdkModelId });
      budgetComparison = compareToBudget(metrics, baseline);
    }

    return {
      sandboxCwd,
      metrics,
      toolPaths,
      verify,
      budgetComparison,
      fixture_hash: computeFixtureHash(),
      prompt_version: readPromptVersion(PROMPT_PATH),
    };
  } finally {
    agent.close();
  }
}
