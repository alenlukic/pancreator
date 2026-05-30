import { existsSync } from "node:fs";
import path from "node:path";

import { ensureCursorSdkRipgrepConfigured } from "./cursor-sdk-prereqs.js";
import { resolveSdkModelId } from "./sdk-model.js";
import type { RunnerPersonaInput } from "./types.js";

export interface CursorSdkInvokeParams {
  message: string;
  persona: RunnerPersonaInput;
  stagePromptPath?: string;
  stagePromptContent?: string;
  artifactPath?: string;
  requiredArtifactPaths?: readonly string[];
  cwd?: string;
  apiKey?: string;
}

export interface CursorSdkInvokeResult {
  status: "ok" | "error";
  resultText?: string;
  errorMessage?: string;
  missingArtifacts?: string[];
}

export type CursorSdkTransport = (params: CursorSdkInvokeParams) => Promise<CursorSdkInvokeResult>;

/** Builds the SDK user message with persona contract, inline prompt, and full artifact set. */
export function buildSdkPrompt(params: CursorSdkInvokeParams): string {
  const lines = [
    params.message,
    "",
    `Persona: ${params.persona.name}`,
    `Persona contract: ${params.persona.description}`,
    `Model: ${params.persona.model}`,
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
    const sdkModelId = resolveSdkModelId(params.persona.model);
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
