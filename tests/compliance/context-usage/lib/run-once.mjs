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
import { HARNESS_MODEL, resolveModelBaselinePath, resolveSdkModelId } from "./model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./ripgrep.mjs";
import { readCursorSdkVersion } from "./runtime-meta.mjs";
import { verifySandboxRun } from "./verify-run.mjs";
import { buildBudgetBaseline, compareToBudget, computeFixtureHash, readPromptVersion } from "./stats.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = path.join(HARNESS_ROOT, "prompt.md");

/**
 * @param {{ debugStream?: boolean; skipBaseline?: boolean; modelId?: string; baselinePath?: string }} [options]
 */
export async function runContextUsageOnce(options = {}) {
  const repoRoot = path.resolve(HARNESS_ROOT, "..", "..", "..");
  if (!ensureCursorSdkRipgrepConfigured(repoRoot)) {
    throw new Error(
      "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
    );
  }

  const prompt = fs.readFileSync(PROMPT_PATH, "utf8");
  const sandboxCwd = await copySandboxToTemp();
  const sdkModelId = resolveSdkModelId(options.modelId ?? HARNESS_MODEL);
  const sdkVersion = readCursorSdkVersion();
  const baselinePath = options.baselinePath ?? resolveModelBaselinePath(HARNESS_ROOT, sdkModelId);

  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: sdkModelId },
    local: { cwd: sandboxCwd, settingSources: ["project"] },
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
    if (!options.skipBaseline && fs.existsSync(baselinePath)) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      budgetComparison = compareToBudget(metrics, baseline, {
        expectedModelId: sdkModelId,
        expectedRuntimeSdkVersion: sdkVersion,
      });
    } else if (!options.skipBaseline) {
      const baseline = buildBudgetBaseline({ modelId: sdkModelId });
      budgetComparison = compareToBudget(metrics, baseline, {
        expectedModelId: sdkModelId,
        expectedRuntimeSdkVersion: sdkVersion,
      });
    }

    return {
      model: sdkModelId,
      runtime: {
        sdk_version: sdkVersion,
      },
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
