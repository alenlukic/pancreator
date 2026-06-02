import { randomBytes } from "node:crypto";

import {
  buildFallbackChain,
  isModelIssue,
  loadModelEscalationConfig,
  resolveEffectiveModel,
  type EscalationObservability,
  type LoadedModelEscalation,
} from "./model-escalation.js";
import {
  createDefaultCursorSdkTransport,
  type CursorSdkInvokeResult,
  type CursorSdkTransport,
} from "./sdk-transport.js";
import type {
  CursorRunnerOptions,
  Runner,
  RunnerInvokeInput,
  RunnerInvocationEnvelope,
  RunnerInvocationMode,
  RunnerRunLogFragment,
} from "./types.js";
import { RUNNER_INVOCATION_SCHEMA_VERSION } from "./types.js";

/**
 * In-process runner: `manual` returns an operator paste envelope; `sdk` invokes Cursor SDK transport.
 */
export class CursorRunner implements Runner {
  private readonly sdkTransport: CursorSdkTransport;
  private escalationCache: LoadedModelEscalation | undefined;

  constructor(private readonly options: CursorRunnerOptions = {}) {
    this.sdkTransport = options.sdkTransport ?? createDefaultCursorSdkTransport();
  }

  async invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope> {
    const { persona, message } = input;
    const requestId = input.requestId ?? newRequestId();
    const invocation: RunnerInvocationMode = this.options.invocation ?? "manual";
    const dryRun = invocation === "manual";
    const stageInvocationIndex = input.stageInvocationIndex ?? 0;
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
      const repoRoot = this.options.repoRoot ?? this.options.cwd ?? process.cwd();
      const loaded = this.loadEscalationConfig(repoRoot);
      const resolved = resolveEffectiveModel(loaded, persona.name, stageInvocationIndex);
      const effectiveModel = resolved.model;

      if (resolved.missingPersona) {
        await this.appendEscalationLog(
          input,
          { ...buildEscalationRecord(loaded, persona.name, stageInvocationIndex, effectiveModel) },
          "WARN",
        );
      }

      envelope.resolved.model = effectiveModel;
      envelope.resolved.escalation = {
        active_config: loaded.activeConfigName,
        persona_slug: persona.name,
        stage_invocation_index: stageInvocationIndex,
        resolved_model: effectiveModel,
        full_model_string: effectiveModel,
      };
      if (envelope.runLogFragment !== undefined) {
        envelope.runLogFragment.attributes["gen_ai.request.model"] = effectiveModel;
      }

      await this.appendEscalationLog(
        input,
        { ...buildEscalationRecord(loaded, persona.name, stageInvocationIndex, effectiveModel) },
        "INFO",
      );

      const sdkOutcome = await this.invokeWithFallback({
        input,
        persona,
        loaded,
        stageInvocationIndex,
        primaryModel: effectiveModel,
      });

      envelope.sdkResult = {
        status: sdkOutcome.status === "ok" ? "ok" : "error",
        artifactPath: input.artifactPath,
        errorMessage: sdkOutcome.errorMessage,
        resultText: sdkOutcome.resultText,
      };
      if (sdkOutcome.resolvedModel !== undefined) {
        envelope.resolved.model = sdkOutcome.resolvedModel;
        if (envelope.resolved.escalation !== undefined) {
          envelope.resolved.escalation.resolved_model = sdkOutcome.resolvedModel;
          envelope.resolved.escalation.full_model_string = sdkOutcome.resolvedModel;
        }
      }
    }

    return envelope;
  }

  private loadEscalationConfig(repoRoot: string): LoadedModelEscalation {
    if (this.escalationCache === undefined) {
      this.escalationCache = loadModelEscalationConfig(repoRoot);
    }
    return this.escalationCache;
  }

  private async invokeWithFallback(input: {
    input: RunnerInvokeInput;
    persona: RunnerInvokeInput["persona"];
    loaded: LoadedModelEscalation;
    stageInvocationIndex: number;
    primaryModel: string;
  }): Promise<CursorSdkInvokeResult & { resolvedModel?: string }> {
    const transportParams = {
      message: input.input.message,
      persona: input.persona,
      stagePromptPath: input.input.stagePromptPath,
      stagePromptContent: input.input.stagePromptContent,
      artifactPath: input.input.artifactPath,
      requiredArtifactPaths: input.input.requiredArtifactPaths,
      cwd: this.options.cwd,
      apiKey: this.options.apiKey,
    };

    const primary = await this.sdkTransport({
      ...transportParams,
      modelOverride: input.primaryModel,
    });
    if (primary.status === "ok" || !isModelIssue(primary)) {
      return primary;
    }

    const chain = buildFallbackChain(
      input.loaded,
      input.persona.name,
      input.stageInvocationIndex,
      input.primaryModel,
    );
    const attempted = [input.primaryModel];

    for (const fallbackModel of chain) {
      attempted.push(fallbackModel);
      const outcome = await this.sdkTransport({
        ...transportParams,
        modelOverride: fallbackModel,
      });
      if (outcome.status === "ok") {
        await this.appendEscalationLog(
          input.input,
          {
            ...buildEscalationRecord(
              input.loaded,
              input.persona.name,
              input.stageInvocationIndex,
              input.primaryModel,
            ),
            fallback_model: fallbackModel,
            fallback_reason: "model_issue",
            outcome: "success",
          },
          "INFO",
        );
        return { ...outcome, resolvedModel: fallbackModel };
      }
      if (!isModelIssue(outcome)) {
        return outcome;
      }
    }

    await this.appendEscalationLog(
      input.input,
      {
        ...buildEscalationRecord(
          input.loaded,
          input.persona.name,
          input.stageInvocationIndex,
          input.primaryModel,
        ),
        outcome: "chain_exhausted",
        attempted_models: attempted,
      },
      "ERROR",
    );

    return primary;
  }

  private async appendEscalationLog(
    input: RunnerInvokeInput,
    escalation: Record<string, unknown>,
    severity: "INFO" | "WARN" | "ERROR",
  ): Promise<void> {
    if (input.runLogPath === undefined || this.options.appendEscalationLog === undefined) {
      return;
    }
    await this.options.appendEscalationLog({
      runLogPath: input.runLogPath,
      severity,
      escalation,
      ledger: input.ledger,
      warnMessage:
        severity === "WARN"
          ? `Persona missing from escalation config: ${String(escalation.persona_slug)}`
          : undefined,
    });
  }
}

function buildEscalationRecord(
  loaded: LoadedModelEscalation,
  personaSlug: string,
  stageInvocationIndex: number,
  effectiveModel: string,
): EscalationObservability {
  return {
    active_config: loaded.activeConfigName,
    persona_slug: personaSlug,
    stage_invocation_index: stageInvocationIndex,
    resolved_model: effectiveModel,
    full_model_string: effectiveModel,
  };
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
      "pancreator.persona": personaName,
      "pancreator.stage_id": stageId,
      ...(input.stagePromptPath ? { "pancreator.stage_prompt_path": input.stagePromptPath } : {}),
    },
  };
}

function newRequestId(): string {
  return randomBytes(8).toString("hex");
}
