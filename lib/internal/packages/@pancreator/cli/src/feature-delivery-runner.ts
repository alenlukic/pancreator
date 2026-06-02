import { asTaskId, resolveRepoPath } from "@pancreator/core";
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

import { readCursorInvocationMode, readStageRemediationEnabled } from "./pan-init.js";
import {
  parseQaVerdict,
  parseReviewPassesVerdict,
  primaryArtifactForEnteringStage,
  requiredArtifactsAfterStageWork,
  validateStageCompletionArtifacts,
} from "./feature-delivery-stage-artifacts.js";

export { parseQaVerdict, parseReviewPassesVerdict };
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
  /** Per-stage SDK invocation counter for model escalation tiers. */
  stageInvocationIndex?: number;
  reportApprovalPending?: boolean;
  stageRemediationCount?: number;
  lastRemediationStage?: string;
}

const SDK_STAGE_LOOPBACK_EVENTS = new Set([
  "must_fix",
  "qa_fails",
  "qa_fails_plan_invalidating",
  "needs_changes",
]);

export const STAGE_REMEDIATION_PERSONA = "pancreator-engineer" as const;
export const MAX_STAGE_REMEDIATION_ATTEMPTS = 2;
/** Cumulative `must_fix` / `qa_fails` loopbacks allowed before SDK auto-advance halts. */
export const FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET = 5;

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
}

export interface FeatureDeliveryTestHooks {
  sdkTransport?: CursorSdkTransport;
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
    };
  } else {
    state.automation.runnerInvocation = invocation;
    if (state.automation.stageInvocationIndex === undefined) {
      state.automation.stageInvocationIndex = 0;
    }
  }
  return state.automation;
}

function lastAdvanceEntry(
  state: FeatureDeliveryRunnerLedger,
): { event: string; to: string } | undefined {
  const history = state.advanceHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.kind === "advance" && typeof entry.event === "string" && typeof entry.to === "string") {
      return { event: entry.event, to: entry.to };
    }
  }
  return undefined;
}

/** Updates stageInvocationIndex before an SDK transport call and returns the effective value. */
export function prepareStageInvocationIndexForSdkEntry(
  state: FeatureDeliveryRunnerLedger,
  enteringStageId: string,
  invocation: "manual" | "sdk",
): number {
  const automation = ensureAutomationState(state, invocation);
  const current = automation.stageInvocationIndex ?? 0;
  const last = lastAdvanceEntry(state);
  if (last !== undefined && SDK_STAGE_LOOPBACK_EVENTS.has(last.event) && last.to === enteringStageId) {
    automation.stageInvocationIndex = current + 1;
  } else {
    automation.stageInvocationIndex = 0;
  }
  return automation.stageInvocationIndex;
}

export function resetStageInvocationIndex(state: FeatureDeliveryRunnerLedger): void {
  if (state.automation !== undefined) {
    state.automation.stageInvocationIndex = 0;
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
  const stageId =
    envelope.resolved.ledger?.stageId ??
    (typeof fragment?.attributes["pancreator.stage_id"] === "string"
      ? fragment.attributes["pancreator.stage_id"]
      : "unknown");
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
    attributes: {
      ...(fragment?.attributes ?? {}),
      "gen_ai.provider.name": "cursor",
      "pancreator.feature_id": state.featureId,
      "pancreator.state_file": state.artifacts.stateFile,
      "pancreator.runner.request_id": envelope.requestId,
    },
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: stageId,
      outcome: sdkError ? "failure" : "success",
      persona: envelope.personaName,
      checkpoint_seq: state.advanceHistory?.length ?? 0,
      token_usage_unavailable: true,
    },
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

export async function invokeFeatureDeliveryEnteringStage(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  pipeline: PipelineDefinition;
  stageId: string;
  compiled?: CompiledPipeline;
  now?: Date;
  testHooks?: FeatureDeliveryTestHooks;
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
  const runLogPath = resolveRepoPath(repoRoot, input.state.artifacts.runLogFile);
  const statePath = resolveRepoPath(repoRoot, input.state.artifacts.stateFile);
  if (existsSync(statePath)) {
    const existing = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    existing.automation = input.state.automation;
    await writeFile(statePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  }

  let envelope: RunnerInvocationEnvelope | undefined;
  let runnerInvoked = false;

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

  if (envelope === undefined) {
    throw new Error(`Pipeline stage slice for ${input.stageId} did not invoke CursorRunner.`);
  }

  let validation = validateStageCompletionArtifacts(repoRoot, input.state, input.stageId);
  const remediationEnabled = await readStageRemediationEnabled(repoRoot, {
    ledgerInvocation: input.state.automation?.runnerInvocation,
  });
  if ((!validation.ok || envelope.sdkResult?.status === "error") && remediationEnabled) {
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
      runner,
      now,
    });
    if (validation.ok) {
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
  runner: CursorRunner;
  now: Date;
}): Promise<ReturnType<typeof validateStageCompletionArtifacts>> {
  let missing = input.missing;
  if (missing.length === 0) {
    missing = validateStageCompletionArtifacts(input.repoRoot, input.state, input.stageId).missing;
  }
  if (missing.length === 0) {
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
      `${STAGE_REMEDIATION_PERSONA} remediating missing ${input.stageId} artifacts (attempt ${attempt}/${MAX_STAGE_REMEDIATION_ATTEMPTS}).`;

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
      input.state.nextHumanAction =
        `${STAGE_REMEDIATION_PERSONA} restored ${input.stageId} artifacts; pipeline may advance when artifacts are ratified.`;
      return validation;
    }
    missing = validation.missing;
  }

  return validateStageCompletionArtifacts(input.repoRoot, input.state, input.stageId);
}

function renderStageRemediationPrompt(input: {
  taskId: string;
  featureId: string;
  stageId: string;
  stagePersona: string;
  missing: string[];
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
    ...input.missing.map((artifact) => `- ${artifact}`),
    "",
    "## Required stage outputs (all must exist)",
    "",
    ...input.requiredArtifactPaths.map((artifact) => `- ${artifact}`),
    "",
    "## Instructions",
    "",
    "1. Read the stage prompt at:",
    `   ${input.stagePromptPath}`,
    "2. Create or repair ONLY the missing artifacts listed above.",
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
  return rel;
}

export async function writeReportApprovalArtifact(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  now: Date;
}): Promise<string> {
  const dayBucket = makeDayDir(input.now);
  const basename = makeOutboxBasename(input.now, `${input.state.featureId}-report-approval`);
  const rel = path.posix.join("lib", "inbox", "out", dayBucket, `${basename}.md`);
  const abs = path.join(input.repoRoot, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const body = [
    "---",
    `task_id: ${input.state.taskId}`,
    `feature_id: ${input.state.featureId}`,
    "gate: report_approval",
    "decision: approve",
    "required_changes: \"\"",
    "---",
    "",
    "# Report approval gate",
    "",
    "Set `decision` to `approve` or `needs_changes`. When `needs_changes`, set `required_changes`",
    "and add `target_stage: plan` or `target_stage: implement`.",
    "",
    "Resume with:",
    "",
    "```bash",
    `pnpm -w exec pan advance ${input.state.taskId} --artifact ${rel}`,
    "```",
    "",
  ].join("\n");
  await writeFile(abs, body, "utf8");
  return rel;
}

export interface ReportApprovalDecision {
  decision: "approve" | "needs_changes";
  requiredChanges: string;
  targetStage?: "plan" | "implement";
}

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
  if (state.automation?.runnerInvocation !== undefined) {
    return state.automation.runnerInvocation;
  }
  return readCursorInvocationMode(repoRoot);
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
  if (input.completedStageId === "review") {
    const reviewRel = path.posix.join(runDir, "review.md");
    const reviewAbs = path.join(input.repoRoot, reviewRel);
    if (!existsSync(reviewAbs)) {
      return false;
    }
    const content = await readFile(reviewAbs, "utf8");
    const verdict = parseReviewPassesVerdict(content);
    if (verdict === true) {
      await input.advanceFn("review_passes", reviewRel);
      return true;
    }
    if (verdict === false) {
      await input.advanceFn("must_fix", reviewRel);
      return true;
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
    const verdict = parseQaVerdict(content);
    if (verdict.passes === true) {
      await input.advanceFn("qa_passes", testRel);
      return true;
    }
    if (verdict.passes === false) {
      const chainEvent = verdict.planInvalidating ? "qa_fails_plan_invalidating" : "qa_fails";
      await input.advanceFn(chainEvent, testRel);
      return true;
    }
  }

  return false;
}

export async function resolveTestStageAdvanceEvent(
  repoRoot: string,
  state: FeatureDeliveryRunnerLedger,
  event: string,
  artifactRel: string,
): Promise<string> {
  if (state.currentStage !== "test" || event !== "qa_fails") {
    return event;
  }
  const testAbs = resolveRepoPath(repoRoot, artifactRel);
  if (!existsSync(testAbs)) {
    return event;
  }
  const content = await readFile(testAbs, "utf8");
  const verdict = parseQaVerdict(content);
  return verdict.planInvalidating ? "qa_fails_plan_invalidating" : event;
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
    input.event !== "qa_fails_plan_invalidating"
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

export async function maybePauseForReportApproval(input: {
  repoRoot: string;
  state: FeatureDeliveryRunnerLedger;
  now: Date;
}): Promise<string | null> {
  if (input.state.currentStage !== "report") {
    return null;
  }
  const reportRel = path.posix.join("lib", "memory", "features", input.state.featureId, "delivery-report.md");
  if (!existsSync(path.join(input.repoRoot, reportRel))) {
    return null;
  }
  const outboxRel = await writeReportApprovalArtifact({
    repoRoot: input.repoRoot,
    state: input.state,
    now: input.now,
  });
  input.state.status = "waiting_for_human_gate";
  ensureAutomationState(input.state, "sdk").reportApprovalPending = true;
  input.state.nextCommand = `pnpm -w exec pan advance ${input.state.taskId} --artifact ${outboxRel}`;
  input.state.nextHumanAction =
    `Report approval required; edit decision in ${outboxRel} and advance with that artifact path.`;
  return outboxRel;
}
