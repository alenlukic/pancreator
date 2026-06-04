import { existsSync } from "node:fs";
import path from "node:path";

import { ensureCursorSdkRipgrepConfigured } from "./cursor-sdk-prereqs.js";
import { resolveSdkModelId } from "./sdk-model.js";
import {
  assertUsageCaptured,
  createEmptyMetrics,
  createProductionTraceSink,
  drainRunStream,
  processStreamEvent,
  repoRelativePath,
} from "./sdk-trace-collector.js";
import type { RunnerPersonaInput, SdkTraceContext } from "./types.js";

export interface CursorSdkInvokeParams {
  message: string;
  persona: RunnerPersonaInput;
  /** One-shot model override; full string preserved for prompts and logs. */
  modelOverride?: string;
  stagePromptPath?: string;
  stagePromptContent?: string;
  artifactPath?: string;
  requiredArtifactPaths?: readonly string[];
  cwd?: string;
  apiKey?: string;
  /** Streamed capture path for sampled feature-delivery invocations. */
  sampled?: boolean;
  sdkTrace?: SdkTraceContext;
}

export interface CursorSdkUsageCapture {
  input_tokens: number;
  output_tokens: number;
  trace_path: string;
  summary_path: string;
}

export interface CursorSdkInvokeResult {
  status: "ok" | "error";
  resultText?: string;
  errorMessage?: string;
  missingArtifacts?: string[];
  sampled?: boolean;
  usage?: CursorSdkUsageCapture;
}

export type CursorSdkTransport = (params: CursorSdkInvokeParams) => Promise<CursorSdkInvokeResult>;

/** Builds the SDK user message with persona contract, inline prompt, and full artifact set. */
export function buildSdkPrompt(params: CursorSdkInvokeParams): string {
  const lines = [
    params.message,
    "",
    `Persona: ${params.persona.name}`,
    `Persona contract: ${params.persona.description}`,
    `Model: ${params.modelOverride ?? params.persona.model}`,
    `Max turns: ${params.persona.maxTurns}`,
    `Allowed tools: ${params.persona.tools.join(", ") || "(none)"}`,
    `Disallowed tools: ${params.persona.disallowedTools.join(", ") || "(none)"}`,
  ];
  if (params.requiredArtifactPaths !== undefined && params.requiredArtifactPaths.length > 0) {
    lines.push("Required output artifacts (all MUST exist on disk before finishing):");
    for (const artifact of params.requiredArtifactPaths) {
      lines.push(`- ${artifact}`);
    }
  } else if (params.artifactPath) {
    lines.push(`Required output artifact: ${params.artifactPath}`);
  }
  if (params.stagePromptContent !== undefined && params.stagePromptContent.trim().length > 0) {
    lines.push("", "## Stage prompt", "", params.stagePromptContent.trim());
  } else if (params.stagePromptPath) {
    lines.push(`Stage prompt path (read this file first): ${params.stagePromptPath}`);
  }
  return lines.join("\n");
}

export function findMissingArtifactPaths(
  repoRoot: string,
  requiredArtifactPaths: readonly string[] | undefined,
): string[] {
  if (requiredArtifactPaths === undefined || requiredArtifactPaths.length === 0) {
    return [];
  }
  const missing: string[] = [];
  for (const rel of requiredArtifactPaths) {
    if (!existsSync(path.join(repoRoot, rel))) {
      missing.push(rel);
    }
  }
  return missing;
}

/** Default transport: Cursor SDK `Agent.prompt` with local runtime and post-run artifact verification. */
export function createDefaultCursorSdkTransport(): CursorSdkTransport {
  return async (params) => {
    const apiKey = params.apiKey ?? process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return {
        status: "error",
        errorMessage: "CURSOR_API_KEY is required when runner.cursor.invocation is sdk",
      };
    }

    const cwd = params.cwd ?? process.cwd();
    if (!ensureCursorSdkRipgrepConfigured(cwd)) {
      return {
        status: "error",
        errorMessage:
          `Ripgrep binary not found for @cursor/sdk-${process.platform}-${process.arch}. Install @cursor/sdk optional platform binaries or set CURSOR_RIPGREP_PATH to an absolute rg path.`,
      };
    }

    const { Agent, CursorAgentError } = await import("@cursor/sdk");
    const prompt = buildSdkPrompt(params);
    const effectiveModel = params.modelOverride ?? params.persona.model;
    const sdkModelId = resolveSdkModelId(effectiveModel);
    try {
      const result = await Agent.prompt(prompt, {
        apiKey,
        model: { id: sdkModelId },
        local: { cwd },
      });
      if (result.status === "error") {
        return {
          status: "error",
          errorMessage: `Cursor SDK run failed (run id: ${result.id ?? "unknown"})`,
        };
      }
      const required =
        params.requiredArtifactPaths ??
        (params.artifactPath !== undefined ? [params.artifactPath] : []);
      const missingArtifacts = findMissingArtifactPaths(cwd, required);
      if (missingArtifacts.length > 0) {
        return {
          status: "error",
          errorMessage: `Cursor SDK run finished but required artifacts are missing: ${missingArtifacts.join(", ")}`,
          missingArtifacts,
        };
      }
      const resultText =
        typeof result.result === "string"
          ? result.result
          : result.result !== undefined
            ? JSON.stringify(result.result)
            : "";
      return { status: "ok", resultText };
    } catch (error) {
      if (error instanceof CursorAgentError) {
        return { status: "error", errorMessage: error.message };
      }
      throw error;
    }
  };
}

/** Streamed transport: Agent.send + onDelta capture for sampled feature-delivery invocations. */
export function createStreamedCursorSdkTransport(): CursorSdkTransport {
  return async (params) => {
    const apiKey = params.apiKey ?? process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return {
        status: "error",
        errorMessage: "CURSOR_API_KEY is required when runner.cursor.invocation is sdk",
      };
    }

    const cwd = params.cwd ?? process.cwd();
    if (!ensureCursorSdkRipgrepConfigured(cwd)) {
      return {
        status: "error",
        errorMessage:
          `Ripgrep binary not found for @cursor/sdk-${process.platform}-${process.arch}. Install @cursor/sdk optional platform binaries or set CURSOR_RIPGREP_PATH to an absolute rg path.`,
      };
    }

    const traceCtx = params.sdkTrace;
    if (traceCtx === undefined) {
      return {
        status: "error",
        errorMessage: "sdkTrace context is required for streamed SDK transport",
      };
    }

    const { Agent, CursorAgentError } = await import("@cursor/sdk");
    const prompt = buildSdkPrompt(params);
    const effectiveModel = params.modelOverride ?? params.persona.model;
    const sdkModelId = resolveSdkModelId(effectiveModel);
    const traceDirAbs = path.join(cwd, traceCtx.traceDirRel);
    const sink = createProductionTraceSink({
      traceDir: traceDirAbs,
      stageId: traceCtx.stageId,
      invocationIndex: traceCtx.invocationIndex,
      taskId: traceCtx.taskId,
      model: sdkModelId,
      repoRoot: cwd,
    });

    const metrics = createEmptyMetrics();
    const toolPaths: string[] = [];
    const wallStartMs = Date.now();

    try {
      const agent = await Agent.create({
        apiKey,
        model: { id: sdkModelId },
        local: { cwd, settingSources: ["project"] },
      });

      try {
        const run = await agent.send(prompt, {
          model: { id: sdkModelId },
          onDelta: ({ update }) => {
            processStreamEvent(update, metrics, toolPaths);
            sink.onEvent(update);
          },
        });
        await drainRunStream(run, {
          metrics,
          toolPaths,
          wallStartMs,
          onEvent: sink.onEvent.bind(sink),
        });
        await run.wait();
        assertUsageCaptured(metrics);

        sink.finish(metrics, toolPaths, params.persona.name);
        const required =
          params.requiredArtifactPaths ??
          (params.artifactPath !== undefined ? [params.artifactPath] : []);
        const missingArtifacts = findMissingArtifactPaths(cwd, required);
        if (missingArtifacts.length > 0) {
          return {
            status: "error",
            errorMessage: `Cursor SDK run finished but required artifacts are missing: ${missingArtifacts.join(", ")}`,
            missingArtifacts,
            sampled: true,
          };
        }

        return {
          status: "ok",
          resultText: "",
          sampled: true,
          usage: {
            input_tokens: metrics.input_tokens,
            output_tokens: metrics.output_tokens,
            trace_path: repoRelativePath(sink.tracePath, cwd),
            summary_path: repoRelativePath(sink.summaryPath, cwd),
          },
        };
      } finally {
        agent.close();
      }
    } catch (error) {
      if (error instanceof CursorAgentError) {
        return { status: "error", errorMessage: error.message, sampled: true };
      }
      throw error;
    }
  };
}
