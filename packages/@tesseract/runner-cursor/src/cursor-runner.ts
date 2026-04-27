import { randomBytes } from "node:crypto";
import type { Runner, RunnerInvokeInput, RunnerInvocationEnvelope } from "./types.js";
import { RUNNER_INVOCATION_SCHEMA_VERSION } from "./types.js";

/**
 * In-process runner that builds a {@link RunnerInvocationEnvelope} without calling a model.
 */
export class CursorRunner implements Runner {
  async invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope> {
    const { persona, message } = input;
    const requestId = input.requestId ?? newRequestId();
    return {
      schemaVersion: RUNNER_INVOCATION_SCHEMA_VERSION,
      runner: "cursor",
      dryRun: true,
      personaName: persona.name,
      requestId,
      userMessage: message,
      resolved: {
        model: persona.model,
        routingDescription: persona.description,
        toolAllowlist: [...persona.tools],
        toolDenylist: [...persona.disallowedTools],
        maxTurns: persona.maxTurns,
      },
    };
  }
}

function newRequestId(): string {
  return randomBytes(8).toString("hex");
}
