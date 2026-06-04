import fs from "node:fs";

import { copyTaskFixtureToTemp } from "./copy-sandbox.mjs";
import {
  assertUsageCaptured,
  createEmptyMetrics,
  createTraceSink,
  drainRunStream,
  processStreamEvent,
} from "./collect-usage.mjs";
import { resolveSdkModelId } from "./model.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./ripgrep.mjs";
import { readCursorSdkVersion } from "./runtime-meta.mjs";
import { buildTaskPrompt, comboKey } from "./tasks.mjs";

/**
 * @param {{
 *   repoRoot: string;
 *   harnessRoot: string;
 *   traceDir: string;
 *   taskId: string;
 *   modelId: string;
 *   runIndex: number;
 *   debugStream?: boolean;
 * }} input
 */
export async function runPrototypeTask(input) {
  if (!ensureCursorSdkRipgrepConfigured(input.repoRoot)) {
    throw new Error(
      "[context-usage] ripgrep binary not found. Install @cursor/sdk platform optional deps or set CURSOR_RIPGREP_PATH.",
    );
  }

  const sdkModelId = resolveSdkModelId(input.modelId);
  const prompt = buildTaskPrompt(input.taskId);
  const sandboxCwd = await copyTaskFixtureToTemp(input.taskId);
  const combo = comboKey(input.taskId, sdkModelId);
  const trace = createTraceSink({
    traceDir: input.traceDir,
    combo,
    runIndex: input.runIndex,
    taskId: input.taskId,
    model: sdkModelId,
  });

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
    const streamOptions = { debugStream: input.debugStream };

    const run = await agent.send(prompt, {
      model: { id: sdkModelId },
      onDelta: ({ update }) => {
        processStreamEvent(update, metrics, toolPaths, streamOptions);
        trace.onEvent(update);
      },
    });
    await drainRunStream(run, {
      metrics,
      toolPaths,
      wallStartMs: start,
      onEvent: trace.onEvent.bind(trace),
      ...streamOptions,
    });
    await run.wait();
    assertUsageCaptured(metrics);

    const summary = trace.finish(metrics, toolPaths);
    return {
      ok: true,
      model: sdkModelId,
      task_id: input.taskId,
      combo,
      sandboxCwd,
      metrics,
      tool_paths: toolPaths,
      summary,
      summary_path: trace.summaryPath,
      trace_path: trace.tracePath,
      runtime: { sdk_version: readCursorSdkVersion() },
    };
  } catch (error) {
    return {
      ok: false,
      model: sdkModelId,
      task_id: input.taskId,
      combo,
      error_message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    agent.close();
    if (fs.existsSync(sandboxCwd)) {
      fs.rmSync(sandboxCwd, { recursive: true, force: true });
    }
  }
}
