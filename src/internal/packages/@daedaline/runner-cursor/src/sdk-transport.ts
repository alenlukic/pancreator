import { ensureCursorSdkRipgrepConfigured } from "./cursor-sdk-prereqs.js";
import { resolveSdkModelId } from "./sdk-model.js";
import type { RunnerPersonaInput } from "./types.js";

export interface CursorSdkInvokeParams {
  message: string;
  persona: RunnerPersonaInput;
  stagePromptPath?: string;
  artifactPath?: string;
  cwd?: string;
  apiKey?: string;
}

export interface CursorSdkInvokeResult {
  status: "ok" | "error";
  resultText?: string;
  errorMessage?: string;
}

export type CursorSdkTransport = (params: CursorSdkInvokeParams) => Promise<CursorSdkInvokeResult>;

function buildSdkPrompt(params: CursorSdkInvokeParams): string {
  const lines = [
    params.message,
    "",
    `Persona: ${params.persona.name}`,
    `Model: ${params.persona.model}`,
    `Max turns: ${params.persona.maxTurns}`,
    `Allowed tools: ${params.persona.tools.join(", ") || "(none)"}`,
    `Disallowed tools: ${params.persona.disallowedTools.join(", ") || "(none)"}`,
  ];
  if (params.stagePromptPath) {
    lines.push(`Stage prompt path: ${params.stagePromptPath}`);
  }
  if (params.artifactPath) {
    lines.push(`Expected artifact path: ${params.artifactPath}`);
  }
  return lines.join("\n");
}

/** Default transport: Cursor SDK `Agent.prompt` with local runtime. */
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
