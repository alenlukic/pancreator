import { randomBytes } from "node:crypto";

import type {
  CursorRunnerOptions,
  Runner,
  RunnerInvokeInput,
  RunnerInvocationEnvelope,
  RunnerInvocationMode,
  RunnerRunLogFragment,
} from "./types.js";
import { RUNNER_INVOCATION_SCHEMA_VERSION } from "./types.js";
import {
  createDefaultCursorSdkTransport,
  type CursorSdkTransport,
} from "./sdk-transport.js";

/**
 * In-process runner: `manual` returns an operator paste envelope; `sdk` invokes Cursor SDK transport.
 */
export class CursorRunner implements Runner {
  private readonly sdkTransport: CursorSdkTransport;

  constructor(private readonly options: CursorRunnerOptions = {}) {
    this.sdkTransport = options.sdkTransport ?? createDefaultCursorSdkTransport();
  }

  async invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope> {
    const { persona, message } = input;
    const requestId = input.requestId ?? newRequestId();
    const invocation: RunnerInvocationMode = this.options.invocation ?? "manual";
    const dryRun = invocation === "manual";
    const runLogFragment =
      input.runLogFragment ??
      defaultRunLogFragment(input, requestId, persona.name, invocation);

    const envelope: RunnerInvocationEnvelope = {
      schemaVersion: RUNNER_INVOCATION_SCHEMA_VERSION,
      runner: "cursor",
      dryRun,
      invocation,
      personaName: persona.name,
      requestId,
      userMessage: message,
      resolved: {
        model: persona.model,
        routingDescription: persona.description,
        toolAllowlist: [...persona.tools],
        toolDenylist: [...persona.disallowedTools],
        maxTurns: persona.maxTurns,
        invocation,
        stagePromptPath: input.stagePromptPath,
        artifactPath: input.artifactPath,
        ledger: input.ledger,
      },
      runLogFragment,
    };

    if (invocation === "sdk") {
      const sdkOutcome = await this.sdkTransport({
        message,
        persona,
        stagePromptPath: input.stagePromptPath,
        artifactPath: input.artifactPath,
        cwd: this.options.cwd,
        apiKey: this.options.apiKey,
      });
      envelope.sdkResult = {
        status: sdkOutcome.status === "ok" ? "ok" : "error",
        artifactPath: input.artifactPath,
        errorMessage: sdkOutcome.errorMessage,
        resultText: sdkOutcome.resultText,
      };
    }

    return envelope;
  }
}

function defaultRunLogFragment(
  input: RunnerInvokeInput,
  requestId: string,
  personaName: string,
  invocation: RunnerInvocationMode,
): RunnerRunLogFragment {
  const stageId = input.ledger?.stageId ?? "unknown";
  return {
    trace_id: requestId,
    span_id: newRequestId(),
    name: `cursor.runner.${invocation}`,
    attributes: {
      "openinference.span.kind": "AGENT",
      "gen_ai.request.model": input.persona.model,
      "tesseract.persona": personaName,
      "tesseract.stage_id": stageId,
      ...(input.stagePromptPath ? { "tesseract.stage_prompt_path": input.stagePromptPath } : {}),
    },
  };
}

function newRequestId(): string {
  return randomBytes(8).toString("hex");
}
