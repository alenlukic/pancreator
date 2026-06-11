import { asTaskId, resolveRepoPath } from "@pancreator/core";
import { stringifyCliJson } from "./canonical-json-io.js";
import {
  compilePipeline,
  executeStageSlice,
  type CompiledPipeline,
  type PipelineDefinition,
} from "@pancreator/pipeline";
import { CursorRunner } from "@pancreator/runner-cursor";
import type { CursorSdkTransport } from "@pancreator/runner-cursor";
import type { RunnerInvocationEnvelope, RunnerPersonaInput } from "@pancreator/runner-cursor";
import {
  appendRunLogRecord,
  newSpanId,
  newTraceId,
  rfc3339UtcMs,
  type RunLogRecord,
} from "@pancreator/run-logger";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { enrichRetryLimitHaltArtifact } from "./feature-delivery-failure-preservation.js";
import {
  parseSpotFixJustificationFromMarkdown,
  parseSpotFixJustificationFromRecord,
  validateSpotFixJustification,
} from "./feature-delivery-gate-validation.js";
import {
  type FeatureDeliverySdkProgressReporter,
  withFeatureDeliverySdkStageHeartbeat,
} from "./feature-delivery-sdk-progress.js";
import {
  DESIGN_ENGINEER_PERSONA,
  DESIGN_REVIEWER_PERSONA,
  PRODUCT_ENGINEER_PERSONA,
  designAcceptanceCriteriaRel,
  designPlanPromptRel,
  designPlanRel,
  designQaPromptRel,
  designQaReportRel,
  designStepsEnabled,
  productAcceptanceCriteriaRel,
  productPlanPromptRel,
  productPlanRel,
  uxSpecRel,
  type FeatureDeliveryDesignOptions,
} from "./design-steps.js";
import { readCursorInvocationMode, readSdkSamplingConfig, readStageRemediationEnabled } from "./pan-init.js";
import { shouldSampleSdkInvocation } from "./sdk-sampling.js";
import {
  type ArtifactContentWarning,
  defaultAdvanceEventForStage,
  mergedTestStageVerdict,
  parseComplianceVerdict,
  parseDesignQaVerdict,
  parseQaVerdict,
  parseReviewGateOutcome,
  parseReviewPassesVerdict,
  primaryArtifactForEnteringStage,
  requiredArtifactsAfterStageWork,
  stageArtifactContract,
  validateStageCompletionArtifacts,
} from "./feature-delivery-stage-artifacts.js";

export {
  parseComplianceVerdict,
  parseDesignQaVerdict,
  parseQaVerdict,
  parseReviewGateOutcome,
  parseReviewPassesVerdict,
};
import { listKnownPersonaIds, PersonaResolveError, resolvePersona } from "./persona-resolve.js";
import { configureCursorSdkTransportPrereqs, loadRepoEnv } from "./repo-env.js";

export { PersonaResolveError };

export class RunnerTransportError extends Error {
  override readonly name = "RunnerTransportError";

  constructor(message: string) {
    super(message);
  }
}

export interface FeatureDeliveryAutomationState {
  runnerInvocation: "manual" | "sdk";
  cumulativeRetryCount: number;
  /**
   * Index used for the current SDK call (mirrors the per-stage map entry at prepare time).
   * @deprecated Prefer `stageInvocationIndexByStage`; kept for persisted-state compatibility.
   */
  stageInvocationIndex?: number;
  /** Completed SDK entry count per stage id (next entry uses this value as its tier index). */
  stageInvocationIndexByStage?: Record<string, number>;
  reportApprovalPending?: boolean;
  stageRemediationCount?: number;
  lastRemediationStage?: string;
}

export const STAGE_REMEDIATION_PERSONA = "pancreator-engineer" as const;
export const MAX_STAGE_REMEDIATION_ATTEMPTS = 2;
/** Cumulative core rollback loopbacks allowed before SDK auto-advance halts. */
export const FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET = 5;

const WARNING_REMEDIATION_STAGES = new Set(["review", "test", "compliance", "ship"]);
const BLOCKING_WARNING_CODES_BY_STAGE: Record<string, Set<string>> = {
  compliance: new Set(["compliance_passes_unparseable", "compliance_final_gate_missing"]),
  ship: new Set([
    "ship_ratification_missing_key",
    "ship_ratification_invalid_json",
    "ship_ratification_not_ratified",
  ]),
};

function shouldRemediateWarnings(stageId: string, warnings: readonly ArtifactContentWarning[]): boolean {
  return warnings.length > 0 && WARNING_REMEDIATION_STAGES.has(stageId);
}

function hasBlockingWarnings(stageId: string, warnings: readonly ArtifactContentWarning[]): boolean {
  const blockingCodes = BLOCKING_WARNING_CODES_BY_STAGE[stageId];
  if (blockingCodes === undefined || warnings.length === 0) {
    return false;
  }
  return warnings.some((warning) => blockingCodes.has(warning.code));
}

/** Minimal ledger slice shared by runner orchestration without importing feature-delivery-run. */
export interface FeatureDeliveryRunnerLedger {
  nextCommand?: string;
  taskId: string;
  featureId: string;
  pipelineId: string;
  currentStage: string;
  status: string;
  nextHumanAction: string;
  artifacts: {
    runDir: string;
    stateFile: string;
    runLogFile: string;
    nextPromptFile?: string;
    handoffFile?: string;
  };
  advanceHistory?: ReadonlyArray<{
    kind: string;
    event?: string;
    to?: string;
    from?: string;
    atIso?: string;
    artifact?: string;
  }>;
  automation?: FeatureDeliveryAutomationState;
  options?: FeatureDeliveryDesignOptions;
}

export interface FeatureDeliveryTestHooks {
  sdkTransport?: CursorSdkTransport;
  progress?: FeatureDeliverySdkProgressReporter;
  /** Test-only: injectable transport/progress hooks for SDK runner tests. */
}

export function ensureAutomationState(
  state: FeatureDeliveryRunnerLedger,
  invocation: "manual" | "sdk",
): FeatureDeliveryAutomationState {
  if (state.automation === undefined) {
    state.automation = {
      runnerInvocation: invocation,
      cumulativeRetryCount: 0,
      stageInvocationIndex: 0,
      stageInvocationIndexByStage: {},
    };
  } else {
    state.automation.runnerInvocation = invocation;
    if (state.automation.stageInvocationIndexByStage === undefined) {
      state.automation.stageInvocationIndexByStage = {};
    }
    if (state.automation.stageInvocationIndex === undefined) {
      state.automation.stageInvocationIndex = 0;
    }
  }
  return state.automation;
}

/** Returns the tier index for this SDK entry and records the next visit for the stage. */
export function prepareStageInvocationIndexForSdkEntry(
  state: FeatureDeliveryRunnerLedger,
  enteringStageId: string,
  invocation: "manual" | "sdk",
): number {
  const automation = ensureAutomationState(state, invocation);
  const byStage = automation.stageInvocationIndexByStage ?? {};
  automation.stageInvocationIndexByStage = byStage;
  const index = byStage[enteringStageId] ?? 0;
  automation.stageInvocationIndex = index;
  byStage[enteringStageId] = index + 1;
  return index;
}

/** Clears per-stage escalation counters (retry-limit halt and similar terminal resets). */
export function resetStageInvocationIndex(state: FeatureDeliveryRunnerLedger): void {
  if (state.automation !== undefined) {
    state.automation.stageInvocationIndex = 0;
    state.automation.stageInvocationIndexByStage = {};
  }
}

export async function compileFeatureDeliveryPipeline(
  repoRoot: string,
  pipeline: PipelineDefinition,
): Promise<CompiledPipeline> {
  const knownPersonas = await listKnownPersonaIds(repoRoot);
  return compilePipeline(
    pipeline,
    knownPersonas.size > 0 ? { knownPersonas } : {},
  );
}

export function runLogRecordFromRunnerEnvelope(
  envelope: RunnerInvocationEnvelope,
  state: FeatureDeliveryRunnerLedger,
  now: Date,
): RunLogRecord {
  const fragment = envelope.runLogFragment;
  const sdkError = envelope.sdkResult?.status === "error";
  const usage = envelope.sdkResult?.usage;
  const sampled = envelope.sdkResult?.sampled === true;
  const stageId =
    envelope.resolved.ledger?.stageId ??
    (typeof fragment?.attributes["pancreator.stage_id"] === "string"
      ? fragment.attributes["pancreator.stage_id"]
      : "unknown");
  const attributes: Record<string, unknown> = {
    ...(fragment?.attributes ?? {}),
    "gen_ai.provider.name": "cursor",
    "pancreator.feature_id": state.featureId,
    "pancreator.state_file": state.artifacts.stateFile,
    "pancreator.runner.request_id": envelope.requestId,
  };
  const pancreatorExt: RunLogRecord["pancreator"] = {
    task_id: asTaskId(state.taskId),
    pipeline: state.pipelineId,
    stage_id: stageId,
    outcome: sdkError ? "failure" : "success",
    persona: envelope.personaName,
    checkpoint_seq: state.advanceHistory?.length ?? 0,
  };
  if (usage !== undefined && sampled) {
    attributes["gen_ai.usage.input_tokens"] = usage.input_tokens;
    attributes["gen_ai.usage.output_tokens"] = usage.output_tokens;
    attributes["pancreator.sampling.sampled"] = true;
    attributes["pancreator.sampling.trace_path"] = usage.trace_path;
  } else {
    pancreatorExt.token_usage_unavailable = true;
  }
  return {
    ts: rfc3339UtcMs(now),
    trace_id: fragment?.trace_id ?? envelope.requestId,
    span_id: fragment?.span_id ?? newSpanId(),
    name: fragment?.name ?? `cursor.runner.${envelope.invocation}`,
    kind: "event",
    status: {
      code: sdkError ? "ERROR" : "OK",
      ...(sdkError && envelope.sdkResult?.errorMessage
        ? { message: envelope.sdkResult.errorMessage }
        : {}),
    },
    attributes,
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: pancreatorExt,
  };
}

function createCursorRunner(
  repoRoot: string,
  invocation: "manual" | "sdk",
  testHooks?: FeatureDeliveryTestHooks,
): CursorRunner {
  loadRepoEnv(repoRoot);
  if (invocation === "sdk" && testHooks?.sdkTransport === undefined) {
    configureCursorSdkTransportPrereqs(repoRoot);
  }
  return new CursorRunner({
    invocation,
    repoRoot,
    cwd: repoRoot,
    apiKey: process.env.CURSOR_API_KEY,
    sdkTransport: testHooks?.sdkTransport,
    appendEscalationLog: async (record) => {
      await appendRunLogRecord(record.runLogPath, {
        ts: rfc3339UtcMs(new Date()),
        trace_id: newTraceId(),
        span_id: newSpanId(),
        name: "cursor.runner.escalation",
        kind: "event",
        status: {
          code: record.severity === "ERROR" ? "ERROR" : "OK",
          ...(record.warnMessage !== undefined ? { message: record.warnMessage } : {}),
        },
        attributes: { escalation: record.escalation, "pancreator.escalation.severity": record.severity },
        resource: { "service.name": "pancreator", "service.version": "0.0.0" },
        pancreator: {
          task_id: asTaskId(record.ledger?.taskId ?? "0_0000_unknown"),
          pipeline: record.ledger?.pipelineId ?? "unknown",
          stage_id: record.ledger?.stageId ?? "unknown",
          outcome: record.severity === "ERROR" ? "failure" : "success",
          token_usage_unavailable: true,
        },
      });
    },
  });
}

export function expectedArtifactForEnteringStage(
  state: FeatureDeliveryRunnerLedger,
  stageId: string,
): string {
  return primaryArtifactForEnteringStage(state, stageId);
}

export { validateStageCompletionArtifacts, requiredArtifactsAfterStageWork };

async function invokePersonaStageWork(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  stageId: string;
  personaId: string;
  stagePromptPath: string;
  artifactPath: string;
  requiredArtifactPaths: readonly string[];
  runner: CursorRunner;
  stageInvocationIndex: number;
  now: Date;
  progress?: FeatureDeliverySdkProgressReporter;
  companionLabel?: string;
}): Promise<RunnerInvocationEnvelope> {
  const persona = await resolvePersona(input.repoRoot, input.personaId);
  const stagePromptAbs = resolveRepoPath(input.repoRoot, input.stagePromptPath);
  const stagePromptContent = existsSync(stagePromptAbs)
    ? await readFile(stagePromptAbs, "utf8")
    : "";
  const samplingConfig = await readSdkSamplingConfig(input.repoRoot);
  const sampled = shouldSampleSdkInvocation({
    config: samplingConfig,
    taskId: input.state.taskId,
    stageId: input.stageId,
    persona: input.personaId,
    model: persona.model,
    invocationIndex: input.stageInvocationIndex,
  });
  const sdkTraceDirRel = path.posix.join(input.state.artifacts.runDir, "sdk-traces");
  const runLogPath = resolveRepoPath(input.repoRoot, input.state.artifacts.runLogFile);

  let envelope: RunnerInvocationEnvelope | undefined;

  await withFeatureDeliverySdkStageHeartbeat(
    input.progress,
    {
      taskId: input.state.taskId,
      featureId: input.state.featureId,
      stageId: input.stageId,
      persona: input.personaId,
      now: input.now,
    },
    async () => {
      envelope = await input.runner.invoke({
        persona,
        message:
          input.companionLabel ??
          `Execute feature-delivery stage ${input.stageId} for task ${input.state.taskId}.`,
        stagePromptPath: input.stagePromptPath,
        stagePromptContent,
        artifactPath: input.artifactPath,
        requiredArtifactPaths: input.requiredArtifactPaths,
        stageInvocationIndex: input.stageInvocationIndex,
        runLogPath,
        sampled,
        sdkTrace: sampled
          ? {
              traceDirRel: sdkTraceDirRel,
              stageId: input.stageId,
              invocationIndex: input.stageInvocationIndex,
              taskId: input.state.taskId,
            }
          : undefined,
        ledger: {
          taskId: input.state.taskId,
          pipelineId: input.state.pipelineId,
          stageId: input.stageId,
          featureId: input.state.featureId,
        },
        runLogFragment: buildStageRunLogFragment(
          persona,
          input.stageId,
          input.stagePromptPath,
          input.artifactPath,
          input.requiredArtifactPaths,
          input.stageInvocationIndex,
        ),
      });
    },
  );

  if (envelope === undefined) {
    throw new Error(`Persona ${input.personaId} did not invoke CursorRunner for stage ${input.stageId}.`);
  }

  if (envelope.sdkResult?.status === "error") {
    throw new RunnerTransportError(envelope.sdkResult.errorMessage ?? "Cursor SDK transport failed.");
  }

  await appendRunLogRecord(runLogPath, runLogRecordFromRunnerEnvelope(envelope, input.state, input.now));
  return envelope;
}

function validateCompanionArtifacts(repoRoot: string, label: string, rels: readonly string[]): void {
  const missing = rels.filter((rel) => !existsSync(resolveRepoPath(repoRoot, rel)));
  if (missing.length > 0) {
    throw new RunnerTransportError(`${label} companion incomplete: missing ${missing.join(", ")}.`);
  }
}

async function validateDesignQaCompanion(repoRoot: string, runDir: string): Promise<void> {
  const designReport = designQaReportRel(runDir);
  const abs = resolveRepoPath(repoRoot, designReport);
  if (!existsSync(abs)) {
    throw new RunnerTransportError(`Design-QA companion incomplete: missing ${designReport}.`);
  }
  const content = await readFile(abs, "utf8");
  if (parseDesignQaVerdict(content).passes === null) {
    throw new RunnerTransportError(
      `Design-QA companion incomplete: ${designReport} must contain design_qa_passes: true or false.`,
    );
  }
}

export async function invokeFeatureDeliveryEnteringStage(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  pipeline: PipelineDefinition;
  stageId: string;
  compiled?: CompiledPipeline;
  now?: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<RunnerInvocationEnvelope> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.now ?? new Date();
  const stage = input.pipeline.stages.find((candidate) => candidate.id === input.stageId);
  if (stage?.persona === undefined) {
    throw new Error(`Stage ${input.stageId} has no persona for runner invocation.`);
  }

  const persona = await resolvePersona(repoRoot, stage.persona);
  const knownPersonas = await listKnownPersonaIds(repoRoot);
  const stagePromptPath =
    input.state.artifacts.nextPromptFile ?? path.posix.join(input.state.artifacts.runDir, "next-prompt.md");
  const stagePromptAbs = resolveRepoPath(repoRoot, stagePromptPath);
  const stagePromptContent = existsSync(stagePromptAbs)
    ? await readFile(stagePromptAbs, "utf8")
    : "";
  const requiredArtifactPaths = requiredArtifactsAfterStageWork(input.state, input.stageId);
  const artifactPath = expectedArtifactForEnteringStage(input.state, input.stageId);
  const runner = createCursorRunner(repoRoot, "sdk", input.testHooks);
  const stageInvocationIndex = input.state.automation?.stageInvocationIndex ?? 0;
  const progress = input.progress ?? input.testHooks?.progress;
  const runDir = input.state.artifacts.runDir;

  if (input.stageId === "plan") {
    const productArtifacts = [productPlanRel(runDir), productAcceptanceCriteriaRel(runDir)];
    const designArtifacts = [designPlanRel(runDir), designAcceptanceCriteriaRel(runDir), uxSpecRel(input.state.featureId)];
    const companions: Promise<RunnerInvocationEnvelope>[] = [
      invokePersonaStageWork({
        repoRoot,
        state: input.state,
        stageId: input.stageId,
        personaId: PRODUCT_ENGINEER_PERSONA,
        stagePromptPath: productPlanPromptRel(runDir),
        artifactPath: productPlanRel(runDir),
        requiredArtifactPaths: productArtifacts,
        runner,
        stageInvocationIndex,
        now,
        progress,
        companionLabel: `Execute product-plan companion for task ${input.state.taskId}.`,
      }),
    ];
    if (designStepsEnabled(input.state.options)) {
      companions.push(
        invokePersonaStageWork({
          repoRoot,
          state: input.state,
          stageId: input.stageId,
          personaId: DESIGN_ENGINEER_PERSONA,
          stagePromptPath: designPlanPromptRel(runDir),
          artifactPath: uxSpecRel(input.state.featureId),
          requiredArtifactPaths: designArtifacts,
          runner,
          stageInvocationIndex,
          now,
          progress,
          companionLabel: `Execute design-plan companion for task ${input.state.taskId}.`,
        }),
      );
    }
    await Promise.all(companions);
    validateCompanionArtifacts(repoRoot, "Product-plan", productArtifacts);
    if (designStepsEnabled(input.state.options)) {
      validateCompanionArtifacts(repoRoot, "Design-plan", designArtifacts);
    }
  }

  if (designStepsEnabled(input.state.options) && input.stageId === "test") {
    const testReport = path.posix.join(runDir, "test-report.md");
    const designReport = designQaReportRel(runDir);
    const [qaEnvelope] = await Promise.all([
      invokePersonaStageWork({
        repoRoot,
        state: input.state,
        stageId: input.stageId,
        personaId: stage.persona,
        stagePromptPath,
        artifactPath: testReport,
        requiredArtifactPaths: [testReport],
        runner,
        stageInvocationIndex,
        now,
        progress,
      }),
      invokePersonaStageWork({
        repoRoot,
        state: input.state,
        stageId: input.stageId,
        personaId: DESIGN_REVIEWER_PERSONA,
        stagePromptPath: designQaPromptRel(runDir),
        artifactPath: designReport,
        requiredArtifactPaths: [designReport],
        runner,
        stageInvocationIndex,
        now,
        progress,
        companionLabel: `Execute design-QA companion for task ${input.state.taskId}.`,
      }),
    ]);
    await validateDesignQaCompanion(repoRoot, runDir);
    let validation = validateStageCompletionArtifacts(repoRoot, input.state, input.stageId);
    const remediationEnabled = await readStageRemediationEnabled(repoRoot, {
      ledgerInvocation: input.state.automation?.runnerInvocation,
    });
    if (
      (!validation.ok || shouldRemediateWarnings(input.stageId, validation.warnings)) &&
      remediationEnabled
    ) {
      validation = await remediateStageArtifacts({
        repoRoot,
        state: input.state,
        stageId: input.stageId,
        stagePersona: stage.persona,
        stagePromptPath,
        stagePromptContent,
        requiredArtifactPaths,
        primaryArtifactPath: artifactPath,
        missing: validation.missing,
        warnings: validation.warnings,
        runner,
        now,
      });
    }
    if (!validation.ok) {
      throw new RunnerTransportError(
        `Stage ${input.stageId} incomplete after remediation: ${validation.missing.join(", ")}`,
      );
    }
    if (hasBlockingWarnings(input.stageId, validation.warnings)) {
      const warningSummary = validation.warnings.map((warning) => `${warning.path} (${warning.code})`).join(", ");
      throw new RunnerTransportError(
        `Stage ${input.stageId} has blocking validation warnings: ${warningSummary}`,
      );
    }
    return qaEnvelope;
  }

  const samplingConfig = await readSdkSamplingConfig(repoRoot);
  const effectiveModel = persona.model;
  const sampled = shouldSampleSdkInvocation({
    config: samplingConfig,
    taskId: input.state.taskId,
    stageId: input.stageId,
    persona: stage.persona,
    model: effectiveModel,
    invocationIndex: stageInvocationIndex,
  });
  const sdkTraceDirRel = path.posix.join(input.state.artifacts.runDir, "sdk-traces");
  const runLogPath = resolveRepoPath(repoRoot, input.state.artifacts.runLogFile);
  const statePath = resolveRepoPath(repoRoot, input.state.artifacts.stateFile);
  if (existsSync(statePath)) {
    const existing = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    existing.automation = input.state.automation;
    await writeFile(statePath, `${stringifyCliJson(repoRoot, existing)}\n`, "utf8");
  }

  let envelope: RunnerInvocationEnvelope | undefined;
  let runnerInvoked = false;

  await withFeatureDeliverySdkStageHeartbeat(
    progress,
    {
      taskId: input.state.taskId,
      featureId: input.state.featureId,
      stageId: input.stageId,
      persona: stage.persona,
      now,
    },
    async () => {
      await executeStageSlice(
        input.pipeline,
        input.stageId,
        { state: input.state },
        async (sliceStage, ctx) => {
          if (runnerInvoked) {
            return ctx;
          }
          runnerInvoked = true;
          envelope = await runner.invoke({
            persona,
            message: `Execute feature-delivery stage ${sliceStage.id} for task ${input.state.taskId}.`,
            stagePromptPath,
            stagePromptContent,
            artifactPath,
            requiredArtifactPaths,
            stageInvocationIndex,
            runLogPath,
            sampled,
            sdkTrace: sampled
              ? {
                  traceDirRel: sdkTraceDirRel,
                  stageId: sliceStage.id,
                  invocationIndex: stageInvocationIndex,
                  taskId: input.state.taskId,
                }
              : undefined,
            ledger: {
              taskId: input.state.taskId,
              pipelineId: input.state.pipelineId,
              stageId: sliceStage.id,
              featureId: input.state.featureId,
            },
            runLogFragment: buildStageRunLogFragment(
              persona,
              sliceStage.id,
              stagePromptPath,
              artifactPath,
              requiredArtifactPaths,
              stageInvocationIndex,
            ),
          });
          return ctx;
        },
        knownPersonas.size > 0 ? { knownPersonas } : {},
      );
    },
  );

  if (envelope === undefined) {
    throw new Error(`Pipeline stage slice for ${input.stageId} did not invoke CursorRunner.`);
  }

  let validation = validateStageCompletionArtifacts(repoRoot, input.state, input.stageId);
  const remediationEnabled = await readStageRemediationEnabled(repoRoot, {
    ledgerInvocation: input.state.automation?.runnerInvocation,
  });
  if (
    (!validation.ok ||
      shouldRemediateWarnings(input.stageId, validation.warnings) ||
      envelope.sdkResult?.status === "error") &&
    remediationEnabled
  ) {
    validation = await remediateStageArtifacts({
      repoRoot,
      state: input.state,
      stageId: input.stageId,
      stagePersona: stage.persona,
      stagePromptPath,
      stagePromptContent,
      requiredArtifactPaths,
      primaryArtifactPath: artifactPath,
      missing: validation.missing,
      warnings: validation.warnings,
      runner,
      now,
    });
    if (validation.ok && !hasBlockingWarnings(input.stageId, validation.warnings)) {
      envelope = {
        ...envelope,
        sdkResult: {
          status: "ok",
          artifactPath,
          resultText: envelope.sdkResult?.resultText ?? "remediated",
        },
      };
    }
  }

  if (!validation.ok) {
    const message =
      envelope.sdkResult?.errorMessage ??
      `Stage ${input.stageId} incomplete after ${MAX_STAGE_REMEDIATION_ATTEMPTS} remediation attempt(s): ${validation.missing.join(", ")}`;
    throw new RunnerTransportError(message);
  }
  if (hasBlockingWarnings(input.stageId, validation.warnings)) {
    const warningSummary = validation.warnings.map((warning) => `${warning.path} (${warning.code})`).join(", ");
    throw new RunnerTransportError(
      `Stage ${input.stageId} has blocking validation warnings after remediation: ${warningSummary}`,
    );
  }

  if (envelope.sdkResult?.status === "error") {
    throw new RunnerTransportError(envelope.sdkResult.errorMessage ?? "Cursor SDK transport failed.");
  }

  await appendRunLogRecord(
    resolveRepoPath(repoRoot, input.state.artifacts.runLogFile),
    runLogRecordFromRunnerEnvelope(envelope, input.state, now),
  );

  return envelope;
}

function buildStageRunLogFragment(
  persona: RunnerPersonaInput,
  stageId: string,
  stagePromptPath: string,
  artifactPath: string,
  requiredArtifactPaths: readonly string[],
  stageInvocationIndex: number,
): NonNullable<RunnerInvocationEnvelope["runLogFragment"]> {
  return {
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: persona.name,
    attributes: {
      "openinference.span.kind": "AGENT",
      "gen_ai.request.model": persona.model,
      "pancreator.stage_invocation_index": stageInvocationIndex,
      "gen_ai.operation.name": `pancreator.pipeline.stage.${stageId}`,
      "gen_ai.provider.name": "cursor",
      "pancreator.persona": persona.name,
      "pancreator.stage_id": stageId,
      "pancreator.stage_prompt_path": stagePromptPath,
      "pancreator.artifact_path": artifactPath,
      "pancreator.required_artifact_paths": [...requiredArtifactPaths],
    },
  };
}

async function remediateStageArtifacts(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  stageId: string;
  stagePersona: string;
  stagePromptPath: string;
  stagePromptContent: string;
  requiredArtifactPaths: readonly string[];
  primaryArtifactPath: string;
  missing: string[];
  warnings: ArtifactContentWarning[];
  runner: CursorRunner;
  now: Date;
}): Promise<ReturnType<typeof validateStageCompletionArtifacts>> {
  let missing = input.missing;
  let warnings = input.warnings;
  if (missing.length === 0 && warnings.length === 0) {
    const validation = validateStageCompletionArtifacts(input.repoRoot, input.state, input.stageId);
    missing = validation.missing;
    warnings = validation.warnings;
  }
  if (missing.length === 0 && warnings.length === 0) {
    return {
      ok: true,
      missing: [],
      present: requiredArtifactsAfterStageWork(input.state, input.stageId) as string[],
      warnings: [],
      warningCount: 0,
    };
  }

  const engineer = await resolvePersona(input.repoRoot, STAGE_REMEDIATION_PERSONA);
  const automation = ensureAutomationState(input.state, input.state.automation?.runnerInvocation ?? "sdk");

  for (let attempt = 1; attempt <= MAX_STAGE_REMEDIATION_ATTEMPTS; attempt += 1) {
    automation.stageRemediationCount = (automation.stageRemediationCount ?? 0) + 1;
    automation.lastRemediationStage = input.stageId;
    input.state.status = "ready_for_stage_delegation";
    input.state.nextHumanAction =
      `${STAGE_REMEDIATION_PERSONA} remediating ${input.stageId} stage artifacts (attempt ${attempt}/${MAX_STAGE_REMEDIATION_ATTEMPTS}).`;

    const remediationPromptRel = path.posix.join(
      input.state.artifacts.runDir,
      `stage-remediation-${input.stageId}-${attempt}.md`,
    );
    const remediationBody = renderStageRemediationPrompt({
      taskId: input.state.taskId,
      featureId: input.state.featureId,
      stageId: input.stageId,
      stagePersona: input.stagePersona,
      missing,
      warnings,
      stagePromptPath: input.stagePromptPath,
      requiredArtifactPaths: input.requiredArtifactPaths,
    });
    const remediationAbs = path.join(input.repoRoot, remediationPromptRel);
    await mkdir(path.dirname(remediationAbs), { recursive: true });
    await writeFile(remediationAbs, remediationBody, "utf8");

    const envelope = await input.runner.invoke({
      persona: engineer,
      message: `Remediate incomplete feature-delivery stage artifacts for task ${input.state.taskId}.`,
      stagePromptPath: remediationPromptRel,
      stagePromptContent: remediationBody,
      artifactPath: input.primaryArtifactPath,
      requiredArtifactPaths: input.requiredArtifactPaths,
      ledger: {
        taskId: input.state.taskId,
        pipelineId: input.state.pipelineId,
        stageId: input.stageId,
        featureId: input.state.featureId,
      },
      runLogFragment: {
        trace_id: newTraceId(),
        span_id: newSpanId(),
        name: STAGE_REMEDIATION_PERSONA,
        attributes: {
          "openinference.span.kind": "AGENT",
          "gen_ai.request.model": engineer.model,
          "gen_ai.operation.name": `pancreator.pipeline.stage.${input.stageId}.remediation`,
          "gen_ai.provider.name": "cursor",
          "pancreator.persona": STAGE_REMEDIATION_PERSONA,
          "pancreator.stage_id": input.stageId,
          "pancreator.remediation_attempt": attempt,
          "pancreator.missing_artifacts": [...missing],
        },
      },
    });

    await appendRunLogRecord(
      path.join(input.repoRoot, input.state.artifacts.runLogFile),
      runLogRecordFromRunnerEnvelope(envelope, input.state, input.now),
    );

    const validation = validateStageCompletionArtifacts(input.repoRoot, input.state, input.stageId);
    if (validation.ok) {
      if (shouldRemediateWarnings(input.stageId, validation.warnings)) {
        warnings = validation.warnings;
        continue;
      }
      input.state.nextHumanAction =
        `${STAGE_REMEDIATION_PERSONA} restored ${input.stageId} artifacts; pipeline may advance when artifacts are ratified.`;
      return validation;
    }
    missing = validation.missing;
    warnings = validation.warnings;
  }

  return validateStageCompletionArtifacts(input.repoRoot, input.state, input.stageId);
}

function renderStageRemediationPrompt(input: {
  taskId: string;
  featureId: string;
  stageId: string;
  stagePersona: string;
  missing: string[];
  warnings: ArtifactContentWarning[];
  stagePromptPath: string;
  requiredArtifactPaths: readonly string[];
}): string {
  return [
    `# Stage artifact remediation — ${input.stageId}`,
    "",
    `Task: ${input.taskId}`,
    `Feature: ${input.featureId}`,
    `Owning stage persona: ${input.stagePersona}`,
    "",
    "## Missing artifacts",
    "",
    ...(input.missing.length === 0 ? ["- none"] : input.missing.map((artifact) => `- ${artifact}`)),
    "",
    "## Validation warnings",
    "",
    ...(input.warnings.length === 0
      ? ["- none"]
      : input.warnings.map((warning) => `- ${warning.path}: ${warning.code} (${warning.message})`)),
    "",
    "## Required stage outputs (all must exist)",
    "",
    ...input.requiredArtifactPaths.map((artifact) => `- ${artifact}`),
    "",
    "## Instructions",
    "",
    "1. Read the stage prompt at:",
    `   ${input.stagePromptPath}`,
    "2. Create or repair only missing artifacts and warning-causing issues listed above.",
    "3. Do not advance the pipeline, commit, or push.",
    "4. Preserve existing valid artifacts; do not delete completed work.",
    "",
  ].join("\n");
}

function makeDayDir(now: Date): string {
  const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const daysToFds = Math.floor((FDS_UTC_MS - dayStart) / 86400000);
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${daysToFds}_${mm}-${dd}-${yy}`;
}

function secondsToMidnightUtc(now: Date): number {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  return Math.max(0, Math.floor((dayStart + 86400000 - now.getTime()) / 1000));
}

function utcHhmm(now: Date): string {
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

export function makeOutboxBasename(now: Date, semanticSuffix: string): string {
  return `${secondsToMidnightUtc(now)}_${utcHhmm(now)}_${semanticSuffix}`;
}

export async function writeRetryLimitHaltArtifact(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  failingStage: string;
  retryCount: number;
  now: Date;
}): Promise<string> {
  const dayBucket = makeDayDir(input.now);
  const basename = makeOutboxBasename(input.now, "feature-delivery-retry-halt");
  const rel = path.posix.join("lib", "inbox", "out", dayBucket, `${basename}.md`);
  const abs = path.join(input.repoRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const body = [
    "---",
    `task_id: ${input.state.taskId}`,
    `feature_id: ${input.state.featureId}`,
    "gate: retry_limit_halt",
    `failing_stage: ${input.failingStage}`,
    `retry_count: ${input.retryCount}`,
    "---",
    "",
    "# Feature-delivery retry limit halt",
    "",
    `Task ${input.state.taskId} exceeded the cumulative automatic loopback budget (${input.retryCount} > ${FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET}).`,
    "",
  ].join("\n");
  await writeFile(abs, body, "utf8");
  await enrichRetryLimitHaltArtifact({
    repoRoot: input.repoRoot,
    runDir: input.state.artifacts.runDir,
    outboxRel: rel,
  });
  return rel;
}

export interface ReportApprovalDecision {
  decision: "approve" | "needs_changes";
  requiredChanges: string;
  targetStage?: "plan" | "implement";
}

/** Parses legacy SDK report-approval outbox artifacts (pre agent-ratification runs). */
export function parseReportApprovalArtifact(content: string): ReportApprovalDecision | null {
  const decisionMatch = content.match(/^decision:\s*(approve|needs_changes)\s*$/imu);
  if (decisionMatch === null) {
    return null;
  }
  const requiredMatch = content.match(/^required_changes:\s*(.*)\s*$/imu);
  const targetMatch = content.match(/^target_stage:\s*(plan|implement)\s*$/imu);
  return {
    decision: decisionMatch[1] as "approve" | "needs_changes",
    requiredChanges: requiredMatch?.[1]?.replace(/^["']|["']$/gu, "") ?? "",
    ...(targetMatch ? { targetStage: targetMatch[1] as "plan" | "implement" } : {}),
  };
}

export async function readCursorInvocationForState(
  repoRoot: string,
  state: FeatureDeliveryRunnerLedger,
): Promise<"manual" | "sdk"> {
  const configInvocation = await readCursorInvocationMode(repoRoot);
  if (state.automation?.runnerInvocation !== undefined) {
    if (state.automation.runnerInvocation === "manual" && configInvocation === "sdk") {
      state.automation.runnerInvocation = "sdk";
    }
    return state.automation.runnerInvocation;
  }
  return configInvocation;
}

export function incrementAutomationRetry(state: FeatureDeliveryRunnerLedger): number {
  const automation = ensureAutomationState(state, state.automation?.runnerInvocation ?? "manual");
  automation.cumulativeRetryCount += 1;
  return automation.cumulativeRetryCount;
}

export async function trySdkAutoChainAfterStageWork(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  pipeline: PipelineDefinition;
  completedStageId: string;
  compiled?: CompiledPipeline;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  advanceFn: (event: string, artifactRel: string) => Promise<unknown>;
}): Promise<boolean> {
  const invocation = await readCursorInvocationForState(input.repoRoot, input.state);
  if (invocation !== "sdk") {
    return false;
  }

  const runDir = input.state.artifacts.runDir;
  const attemptChain = async (event: string, artifactRel: string): Promise<boolean> => {
    try {
      await input.advanceFn(event, artifactRel);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No transition from ")) {
        return false;
      }
      if (error instanceof Error && error.message.startsWith("Feature-delivery retry limit halt:")) {
        throw error;
      }
      return false;
    }
  };
  if (input.completedStageId === "review") {
    const reviewRel = path.posix.join(runDir, "review.md");
    const reviewAbs = path.join(input.repoRoot, reviewRel);
    if (!existsSync(reviewAbs)) {
      return false;
    }
    const content = await readFile(reviewAbs, "utf8");
    const verdict = parseReviewGateOutcome(content);
    if (verdict.passes === true) {
      return attemptChain("review_passes", reviewRel);
    }
    if (verdict.passes === false) {
      const spotFix = parseSpotFixJustificationFromMarkdown(content);
      const spotFixValid =
        validateSpotFixJustification("review_spot_fix", spotFix) === null &&
        (verdict.spotFixable || verdict.excludedFromGate);
      if (spotFixValid) {
        return attemptChain("review_spot_fix", reviewRel);
      }
      return attemptChain("must_fix", reviewRel);
    }
    return false;
  }

  if (input.completedStageId === "test") {
    const testRel = path.posix.join(runDir, "test-report.md");
    const testAbs = path.join(input.repoRoot, testRel);
    if (!existsSync(testAbs)) {
      return false;
    }
    const content = await readFile(testAbs, "utf8");
    let designContent: string | undefined;
    if (designStepsEnabled(input.state.options)) {
      const designRel = designQaReportRel(runDir);
      const designAbs = path.join(input.repoRoot, designRel);
      if (!existsSync(designAbs)) {
        return false;
      }
      designContent = await readFile(designAbs, "utf8");
    }
    const verdict = mergedTestStageVerdict({
      qaMarkdown: content,
      designQaMarkdown: designContent,
      designSteps: designStepsEnabled(input.state.options),
    });
    if (verdict.passes === true) {
      return attemptChain("qa_passes", testRel);
    }
    if (verdict.passes === false) {
      const spotFix = parseSpotFixJustificationFromMarkdown(content);
      const spotFixValid =
        validateSpotFixJustification("qa_spot_fix", spotFix) === null &&
        (verdict.spotFixable || verdict.excludedFromGate);
      if (spotFixValid) {
        return attemptChain("qa_spot_fix", testRel);
      }
      const chainEvent = verdict.planInvalidating ? "qa_fails_plan_invalidating" : "qa_fails";
      return attemptChain(chainEvent, testRel);
    }
  }

  if (
    input.completedStageId === "compliance" &&
    input.pipeline.stages.some((stage) => stage.id === "compliance")
  ) {
    const complianceRel = path.posix.join(runDir, "compliance-result.json");
    const complianceAbs = path.join(input.repoRoot, complianceRel);
    if (!existsSync(complianceAbs)) {
      return false;
    }
    const content = await readFile(complianceAbs, "utf8");
    const verdict = parseComplianceVerdict(content);
    const finalGateFails = verdict.failingFinalGateCommands.length > 0;
    if (verdict.passes === true && !finalGateFails) {
      return attemptChain("compliance_passes", complianceRel);
    }
    if (verdict.planInvalidating) {
      return attemptChain("compliance_fails_plan_invalidating", complianceRel);
    }
    if (verdict.coreReentryRequired) {
      return attemptChain("compliance_fails", complianceRel);
    }
    if (verdict.passes === false || finalGateFails || verdict.spotFixable || verdict.excludedFromGate) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        return attemptChain("compliance_fails", complianceRel);
      }
      const spotFixValid =
        validateSpotFixJustification(
          "compliance_spot_fix",
          parseSpotFixJustificationFromRecord(parsed),
        ) === null;
      if (spotFixValid) {
        return attemptChain("compliance_spot_fix", complianceRel);
      }
      return attemptChain("compliance_fails", complianceRel);
    }
  }

  const agentRatifiedStages = ["plan", "implement", "report", "ship", "index"] as const;
  if (agentRatifiedStages.includes(input.completedStageId as (typeof agentRatifiedStages)[number])) {
    if (input.completedStageId === "implement") {
      const history = input.state.advanceHistory ?? [];
      const last = history[history.length - 1];
      if (last?.kind === "advance" && last.event === "must_fix" && last.from === "review") {
        return false;
      }
    }
    const validation = validateStageCompletionArtifacts(input.repoRoot, input.state, input.completedStageId);
    if (!validation.ok) {
      return false;
    }
    const event = defaultAdvanceEventForStage(input.completedStageId);
    const contract = stageArtifactContract(input.state, input.completedStageId, event);
    return attemptChain(event, contract.primaryArtifact);
  }

  return false;
}

export async function resolveTestStageAdvanceEvent(
  repoRoot: string,
  state: FeatureDeliveryRunnerLedger,
  event: string,
  artifactRel: string,
): Promise<string> {
  if (
    state.currentStage !== "test" ||
    (event !== "qa_fails" && event !== "qa_passes" && event !== "qa_spot_fix")
  ) {
    return event;
  }
  const testAbs = resolveRepoPath(repoRoot, artifactRel);
  if (!existsSync(testAbs)) {
    return event;
  }
  const content = await readFile(testAbs, "utf8");
  let designContent: string | undefined;
  if (designStepsEnabled(state.options)) {
    const designRel = designQaReportRel(state.artifacts.runDir);
    const designAbs = resolveRepoPath(repoRoot, designRel);
    if (existsSync(designAbs)) {
      designContent = await readFile(designAbs, "utf8");
    }
  }
  const verdict = mergedTestStageVerdict({
    qaMarkdown: content,
    designQaMarkdown: designContent,
    designSteps: designStepsEnabled(state.options),
  });
  if (verdict.passes === true) {
    return "qa_passes";
  }
  if (verdict.passes === false) {
    if (verdict.spotFixable || verdict.excludedFromGate) {
      return "qa_spot_fix";
    }
    return verdict.planInvalidating ? "qa_fails_plan_invalidating" : "qa_fails";
  }
  return event;
}

export async function resolveComplianceStageAdvanceEvent(
  repoRoot: string,
  state: FeatureDeliveryRunnerLedger,
  event: string,
  artifactRel: string,
): Promise<string> {
  if (
    state.currentStage !== "compliance" ||
    (event !== "compliance_passes" && event !== "compliance_fails" && event !== "compliance_spot_fix")
  ) {
    return event;
  }
  const complianceAbs = resolveRepoPath(repoRoot, artifactRel);
  if (!existsSync(complianceAbs)) {
    return event;
  }
  const content = await readFile(complianceAbs, "utf8");
  const verdict = parseComplianceVerdict(content);
  const finalGateFails = verdict.failingFinalGateCommands.length > 0;
  if (verdict.passes === true && !finalGateFails) {
    return "compliance_passes";
  }
  if (verdict.planInvalidating) {
    return "compliance_fails_plan_invalidating";
  }
  if (verdict.coreReentryRequired) {
    return "compliance_fails";
  }
  if (verdict.passes === false || finalGateFails || verdict.spotFixable || verdict.excludedFromGate) {
    return "compliance_spot_fix";
  }
  return event;
}

export async function applySdkRetrySideEffects(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  event: string;
  fromStage: string;
  now: Date;
}): Promise<string | null> {
  if (
    input.event !== "must_fix" &&
    input.event !== "qa_fails" &&
    input.event !== "qa_fails_plan_invalidating" &&
    input.event !== "compliance_fails" &&
    input.event !== "compliance_fails_plan_invalidating"
  ) {
    return null;
  }
  const retryCount = incrementAutomationRetry(input.state);
  if (retryCount <= FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET) {
    return null;
  }
  resetStageInvocationIndex(input.state);
  input.state.status = "halted";
  input.state.currentStage = input.fromStage;
  input.state.nextHumanAction =
    `Automatic loopback halted after ${retryCount} retries; inspect the outbox artifact and repair-state if needed.`;
  const outboxRel = await writeRetryLimitHaltArtifact({
    repoRoot: input.repoRoot,
    state: input.state,
    failingStage: input.fromStage,
    retryCount,
    now: input.now,
  });
  const summary = [
    `task_id=${input.state.taskId}`,
    `feature_id=${input.state.featureId}`,
    `failing_stage=${input.fromStage}`,
    `retry_count=${retryCount}`,
    `outbox_artifact=${outboxRel}`,
  ].join(" ");
  return summary;
}
