import { asTaskId, resolveProjectPath, resolveRepoPath, type TaskId } from "@pancreator/core";
import type { InterventionState } from "@pancreator/intervention";
import { loadPipelineYaml, type PipelineDefinition, type PipelineStage } from "@pancreator/pipeline";
import {
  appendRunLogRecord,
  newSpanId,
  newTraceId,
  rfc3339UtcMs,
  type RunLogRecord,
} from "@pancreator/run-logger";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";
import {
  applyActiveMemoryRefreshOnArtifactClosure,
  patchFeatureIndexArchivedInbox,
  SHIPPED_LEDGER_ROW_CAP,
} from "./active-memory-refresh.js";
import { readCursorInvocationMode } from "./pan-init.js";
import {
  applySdkRetrySideEffects,
  compileFeatureDeliveryPipeline,
  ensureAutomationState,
  invokeFeatureDeliveryEnteringStage,
  maybePauseForReportApproval,
  parseReportApprovalArtifact,
  prepareStageInvocationIndexForSdkEntry,
  readCursorInvocationForState,
  resetStageInvocationIndex,
  resolveTestStageAdvanceEvent,
  trySdkAutoChainAfterStageWork,
  type FeatureDeliveryAutomationState,
  type FeatureDeliveryTestHooks,
} from "./feature-delivery-runner.js";
import {
  emitFeatureDeliveryStageTransition,
  type FeatureDeliverySdkProgressReporter,
} from "./feature-delivery-sdk-progress.js";
import { assertDeliveryReportCitationFormat } from "./delivery-report-citation-lint.js";
import {
  assertAdvanceArtifacts,
  parseReviewPassesVerdict,
  stageArtifactContract,
  validateStageCompletionArtifacts,
  type ArtifactContentWarning,
} from "./feature-delivery-stage-artifacts.js";
import { decodeCountdownTimestamp, parseRunDirParts } from "./timestamp-decode.js";

export const FEATURE_DELIVERY_STATE_SCHEMA_VERSION = "1" as const;

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const FEATURE_DELIVERY_STAGES = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "ship",
  "index",
] as const;
const TERMINAL_STAGE = "complete" as const;
const TASK_ID_PATTERN = /^\d+_\d{4}_[a-z0-9][a-z0-9_-]*$/u;

function resolveFeatureDeliveryProgress(input: {
  progress?: FeatureDeliverySdkProgressReporter;
  testHooks?: FeatureDeliveryTestHooks;
}): FeatureDeliverySdkProgressReporter | undefined {
  return input.progress ?? input.testHooks?.progress;
}

type FeatureDeliveryStageId = (typeof FEATURE_DELIVERY_STAGES)[number];
type FeatureDeliveryCurrentStage =
  | FeatureDeliveryStageId
  | typeof TERMINAL_STAGE
  | "aborted"
  | "paused";

export type StageStatus = "ready" | "pending" | "complete" | "blocked" | "skipped";
export type PipelineStatus =
  | "ready_for_intake_delegation"
  | "ready_for_stage_delegation"
  | "waiting_for_human_gate"
  | "complete"
  | "closed"
  | "repaired"
  | "halted";

export interface FeatureDeliveryStageState {
  id: string;
  persona?: string;
  label?: string;
  status: StageStatus;
  humanGate?: string;
  humanAttention?: string;
}

export interface FeatureDeliveryTransition {
  from: string;
  on: string;
  to: string;
  humanAttention?: string;
}

export interface FeatureDeliveryAdvanceHistoryEntry {
  atIso: string;
  kind: "advance" | "repair" | "close";
  from: string;
  to: string;
  event: string;
  artifact: string;
  reason?: string;
}

export interface FeatureDeliveryState {
  schemaVersion: typeof FEATURE_DELIVERY_STATE_SCHEMA_VERSION;
  pipelineId: "feature-delivery";
  taskId: string;
  featureId: string;
  status: PipelineStatus;
  currentStage: FeatureDeliveryCurrentStage;
  createdAtIso: string;
  source: {
    inboxEntry: string;
    inboxPath: string;
  };
  artifacts: {
    runDir: string;
    stateFile: string;
    handoffFile: string;
    runLogFile: string;
    nextPromptFile?: string;
  };
  stages: FeatureDeliveryStageState[];
  transitions: FeatureDeliveryTransition[];
  nextHumanAction: string;
  advanceHistory?: FeatureDeliveryAdvanceHistoryEntry[];
  automation?: FeatureDeliveryAutomationState;
  /** Runtime-generated exact resume command (report approval gate, etc.). */
  nextCommand?: string;
}

export type NextStep = {
  event: string | null;
  artifact: string | null;
  nextCommand: string | null;
  source: "derived" | "persisted";
  reason?: string;
};

export interface FeatureDeliveryNextResult {
  command: "next";
  status: "ok";
  taskId: string;
  featureId: string;
  runDir: string;
  currentStage: string;
  pipelineStatus: string;
  nextHumanAction: string;
  event: string | null;
  artifact: string | null;
  nextCommand: string | null;
  source: "derived" | "persisted";
  reason?: string;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
}

export interface ValidateArtifactsResult {
  command: "artifacts validate";
  status: "ok" | "invalid";
  taskId: string;
  stage: string;
  warningCount: number;
  warnings: ArtifactContentWarning[];
  missing: string[];
  present: string[];
}

export type { FeatureDeliveryAutomationState, FeatureDeliveryTestHooks, FeatureDeliverySdkProgressReporter };

export interface StartFeatureDeliveryInput {
  repoRoot: string;
  inboxEntry: string;
  featureId?: string;
  taskId?: string;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}

export interface StartFeatureDeliveryResult {
  command: "run" | "feature new";
  status: "ok";
  pipelineId: "feature-delivery";
  taskId: string;
  featureId: string;
  runDir: string;
  stateFile: string;
  handoffFile: string;
  runLogFile: string;
  nextPromptFile: string;
  currentStage: "intake";
  nextHumanAction: string;
  nextCommand?: string | null;
  event?: string | null;
  artifact?: string | null;
  contentWarnings?: ArtifactContentWarning[];
  warningCount?: number;
}

export interface FeatureDeliveryStatusResult {
  command: "status";
  status: "ok";
  taskId: string;
  pipelineId: string;
  featureId: string;
  currentStage: string;
  pipelineStatus: string;
  interventionState: InterventionState;
  runDir: string;
  stateFile: string;
  nextPromptFile: string | null;
  nextHumanAction: string;
  nextCommand?: string | null;
  event?: string | null;
  artifact?: string | null;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
}

export interface AdvanceFeatureDeliveryInput {
  repoRoot: string;
  taskId: string;
  artifact: string;
  event?: string;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}

export interface AdvanceFeatureDeliveryResult {
  command: "advance";
  status: "ok";
  taskId: string;
  featureId: string;
  fromStage: string;
  event: string;
  currentStage: string;
  artifact: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
  /** True when implement-stage advance with review.md chained implementation_complete and review_passes, landing at test. */
  reviewReentry?: boolean;
  nextCommand?: string | null;
  contentWarnings?: ArtifactContentWarning[];
  warningCount?: number;
}

export interface RepairFeatureDeliveryStateInput {
  repoRoot: string;
  taskId: string;
  stage: string;
  artifact: string;
  reason: string;
  clock?: () => Date;
  progress?: FeatureDeliverySdkProgressReporter;
  testHooks?: FeatureDeliveryTestHooks;
}

export interface RepairFeatureDeliveryStateResult {
  command: "repair-state";
  status: "ok";
  taskId: string;
  featureId: string;
  previousStage: string;
  currentStage: string;
  artifact: string;
  reason: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
}

export interface RefreshFeatureDeliveryPromptInput {
  repoRoot: string;
  taskId: string;
}

export interface RefreshFeatureDeliveryPromptResult {
  command: "refresh-prompt";
  status: "ok";
  taskId: string;
  featureId: string;
  currentStage: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
}

export interface CloseFeatureDeliveryArtifactsInput {
  repoRoot: string;
  taskId: string;
  clock?: () => Date;
}

export interface CloseFeatureDeliveryArtifactsResult {
  command: "close-artifacts";
  status: "ok";
  taskId: string;
  featureId: string;
  currentStage: "complete";
  pipelineStatus: "closed";
  archivedRunDir: string;
  archivedInboxPath: string;
  activeMemoryPath: string;
  activeFeatureCleared: boolean;
  stateFile: string;
  runLogFile: string;
  nextPromptFile: string;
  nextHumanAction: string;
  /** True when the run was already under archive/work/ and closure finalized state only. */
  alreadyArchived?: boolean;
}

export async function startFeatureDelivery(
  input: StartFeatureDeliveryInput,
  command: "run" | "feature new" = "run",
): Promise<StartFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const inboxRel = assertInboxInRelativePath(input.inboxEntry, "inbox entry");
  const inboxPath = resolveProjectPath(repoRoot, "lib", "inbox", "in", ...inboxRel.split("/"));
  const directive = await readFile(inboxPath, "utf8");
  const pipelinePath = resolveProjectPath(repoRoot, "lib", "pipelines", "feature-delivery.yaml");
  const pipeline = loadPipelineYaml(pipelinePath);
  if (pipeline.id !== "feature-delivery") {
    throw new Error(`Expected feature-delivery pipeline at ${pipelinePath}; found ${pipeline.id}.`);
  }

  const featureId = sanitizeSlug(
    input.featureId ?? deriveFeatureId(path.posix.basename(inboxRel), directive),
  );
  const taskId = sanitizeTaskId(input.taskId ?? makeTaskId(now, featureId));
  const dayDir = makeDayDir(now);
  const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);

  const runDirRel = path.posix.join("work", dayDir, taskId);
  const runDir = resolveProjectPath(repoRoot, "work", dayDir, taskId);
  const stateFileRel = path.posix.join(runDirRel, "state.json");
  const handoffFileRel = path.posix.join(runDirRel, "handoff.md");
  const runLogFileRel = path.posix.join(runDirRel, "run.log.jsonl");
  const nextPromptFileRel = path.posix.join(runDirRel, "next-prompt.md");
  const stateFile = path.join(runDir, "state.json");
  const handoffFile = path.join(runDir, "handoff.md");
  const runLogFile = path.join(runDir, "run.log.jsonl");
  const nextPromptFile = path.join(runDir, "next-prompt.md");

  const state: FeatureDeliveryState = {
    schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
    pipelineId: "feature-delivery",
    taskId,
    featureId,
    status: "ready_for_intake_delegation",
    currentStage: "intake",
    createdAtIso: rfc3339UtcMs(now),
    source: {
      inboxEntry: inboxRel,
      inboxPath: path.posix.join("lib", "inbox", "in", inboxRel),
    },
    artifacts: {
      runDir: runDirRel,
      stateFile: stateFileRel,
      handoffFile: handoffFileRel,
      runLogFile: runLogFileRel,
      nextPromptFile: nextPromptFileRel,
    },
    stages: buildStageStates(pipeline),
    transitions: featureDeliveryTransitions(),
    nextHumanAction:
      "Delegate next-prompt.md to intake-analyst; ratify the emitted spec before advancing to plan.",
  };

  const invocation = await readCursorInvocationMode(repoRoot);
  ensureAutomationState(state, invocation);

  await mkdir(runDir, { recursive: true });
  await writeFile(handoffFile, renderHandoff(repoRoot, state, pipeline, directive), "utf8");
  await writeFile(nextPromptFile, renderNextPrompt(repoRoot, state, pipeline), "utf8");

  if (invocation === "sdk") {
    prepareStageInvocationIndexForSdkEntry(state, "intake", invocation);
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: "intake",
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }

  await writeFile(stateFile, stringifyCliJson(repoRoot, state), "utf8");
  await appendRunLogRecord(runLogFile, makeInvocationRecord(state, now));

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
    command,
    status: "ok",
    pipelineId: "feature-delivery",
    taskId,
    featureId,
    runDir: runDirRel,
    stateFile: stateFileRel,
    handoffFile: handoffFileRel,
    runLogFile: runLogFileRel,
    nextPromptFile: nextPromptFileRel,
    currentStage: "intake",
    nextHumanAction: state.nextHumanAction,
  }) as StartFeatureDeliveryResult;
}

/** Appends a run-log row for pan pause/resume/abort when a feature-delivery ledger exists. Returns false when no state file matches the task id. */
export async function appendFeatureDeliveryInterventionRunLog(input: {
  repoRoot: string;
  taskId: string;
  command: "pause" | "resume" | "abort";
  abortReason?: string;
  clock?: () => Date;
}): Promise<boolean> {
  try {
    const repoRoot = path.resolve(input.repoRoot);
    const taskId = sanitizeTaskId(input.taskId);
    const now = input.clock?.() ?? new Date();
    let stateFile: { abs: string };
    try {
      stateFile = await findStateFile(repoRoot, taskId);
    } catch {
      return false;
    }
    const state = await readFeatureDeliveryState(stateFile.abs);
    const runLogAbs = resolveRepoPath(repoRoot, state.artifacts.runLogFile);
    await appendRunLogRecord(
      runLogAbs,
      makeInterventionRecord(state, now, input.command, input.abortReason),
    );
    return true;
  } catch {
    return false;
  }
}

export async function readFeatureDeliveryStatusWithInterventions(
  repoRootInput: string,
  taskIdInput: string,
  loadState: (taskId: TaskId) => Promise<InterventionState>,
): Promise<FeatureDeliveryStatusResult> {
  const repoRoot = path.resolve(repoRootInput);
  const taskId = sanitizeTaskId(taskIdInput);
  const stateFile = await findStateFile(repoRoot, taskId);
  const raw = await readFile(stateFile.abs, "utf8");
  const parsed = JSON.parse(raw) as FeatureDeliveryState;
  const interventionState = await loadState(asTaskId(taskId));
  const statusBase = {
    command: "status" as const,
    status: "ok" as const,
    taskId,
    pipelineId: parsed.pipelineId,
    featureId: parsed.featureId,
    currentStage: parsed.currentStage,
    pipelineStatus: parsed.status,
    interventionState,
    runDir: parsed.artifacts.runDir,
    stateFile: stateFile.rel,
    nextPromptFile: parsed.artifacts.nextPromptFile ?? null,
    nextHumanAction: parsed.nextHumanAction,
    ...decodedTimestampFields(parsed.artifacts.runDir, taskId),
  };
  return enrichFeatureDeliveryEnvelope(repoRoot, parsed, statusBase);
}

export async function advanceFeatureDelivery(
  input: AdvanceFeatureDeliveryInput,
): Promise<AdvanceFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  let taskId: string;
  try {
    taskId = sanitizeTaskId(input.taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.")) {
      throw error;
    }
    const suggestion = await suggestTaskIdFromSlug(repoRoot, input.taskId);
    throw new Error(
      suggestion === null
        ? message
        : `${message} Did you mean ${suggestion}?`,
    );
  }
  const now = input.clock?.() ?? new Date();
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(repoRoot, input.artifact, "artifact");

  if (state.currentStage === TERMINAL_STAGE) {
    throw new Error(`Task ${taskId} is already complete; refusing to advance.`);
  }

  const reentry = await tryResolveReviewReentryAdvance(repoRoot, state, artifact.rel, input.event);
  if (reentry !== null) {
    return advanceReviewReentryFromImplement({
      repoRoot,
      taskId,
      state,
      pipeline,
      stateFileRel: stateFile.rel,
      reentry,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }

  const reportApproval = await tryAdvanceFromReportApproval({
    repoRoot,
    taskId,
    state,
    pipeline,
    stateFileRel: stateFile.rel,
    artifactRel: artifact.rel,
    now,
    testHooks: input.testHooks,
    progress: resolveFeatureDeliveryProgress(input),
  });
  if (reportApproval !== null) {
    return reportApproval;
  }

  const requestedEvent = input.event ?? defaultEventForStage(state.currentStage);
  const event = await resolveTestStageAdvanceEvent(repoRoot, state, requestedEvent, artifact.rel);
  const transition = state.transitions.find(
    (candidate) => candidate.from === state.currentStage && candidate.on === event,
  );
  if (transition === undefined) {
    throw new Error(`No transition from ${state.currentStage} on ${event}.`);
  }
  if (state.currentStage === "report" && event === "report_ready") {
    await assertDeliveryReportCitationFormat(repoRoot, artifact.rel);
  }
  assertStageArtifact(repoRoot, state, state.currentStage, artifact.rel, event);

  const contentWarnings = collectStageContentWarnings(repoRoot, state, state.currentStage);

  delete state.nextCommand;
  const applied = applyFeatureDeliveryTransition(state, transition, event, artifact.rel, now);
  const invocation = await readCursorInvocationForState(repoRoot, state);
  ensureAutomationState(state, invocation);

  if (invocation === "sdk") {
    const haltSummary = await applySdkRetrySideEffects({
      repoRoot,
      state,
      event: applied.event,
      fromStage: applied.fromStage,
      now,
    });
    if (haltSummary !== null) {
      await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
      await appendRunLogRecord(
        resolveRepoPath(repoRoot, state.artifacts.runLogFile),
        makeAdvanceRecord(
          state,
          now,
          applied.fromStage,
          applied.toStage,
          applied.event,
          applied.artifact,
          { contentWarnings },
        ),
      );
      const haltError = new Error(`Feature-delivery retry limit halt: ${haltSummary}`) as Error & {
        haltSummary: string;
      };
      haltError.haltSummary = haltSummary;
      throw haltError;
    }

    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    if (applied.toStage !== TERMINAL_STAGE) {
      prepareStageInvocationIndexForSdkEntry(state, applied.toStage, invocation);
      await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
      emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
        taskId,
        featureId: state.featureId,
        fromStage: applied.fromStage,
        toStage: applied.toStage,
        event: applied.event,
        persona: personaForStage(pipeline, applied.toStage) ?? undefined,
        now,
      });
      await invokeFeatureDeliveryEnteringStage({
        repoRoot,
        state,
        pipeline,
        stageId: applied.toStage,
        compiled,
        now,
        testHooks: input.testHooks,
        progress: resolveFeatureDeliveryProgress(input),
      });
      resetStageInvocationIndex(state);
    }

    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");

    const chained = await trySdkAutoChainAfterStageWork({
      repoRoot,
      state,
      pipeline,
      completedStageId: state.currentStage,
      compiled,
      now,
      testHooks: input.testHooks,
      advanceFn: async (chainEvent, chainArtifact) =>
        advanceFeatureDelivery({
          repoRoot,
          taskId,
          artifact: chainArtifact,
          event: chainEvent,
          clock: input.clock,
          testHooks: input.testHooks,
          progress: resolveFeatureDeliveryProgress(input),
        }),
    });

    if (!chained) {
      await maybePauseForReportApproval({ repoRoot, state, now });
    } else {
      const refreshed = await readFeatureDeliveryState(stateFile.abs);
      Object.assign(state, refreshed);
    }
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      applied.fromStage,
      applied.toStage,
      applied.event,
      applied.artifact,
      { contentWarnings },
    ),
  );

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
    command: "advance",
    status: "ok",
    taskId,
    featureId: state.featureId,
    fromStage: applied.fromStage,
    event: applied.event,
    currentStage: state.currentStage,
    artifact: applied.artifact,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
    contentWarnings,
    warningCount: contentWarnings.length,
  }) as AdvanceFeatureDeliveryResult;
}

export async function repairFeatureDeliveryState(
  input: RepairFeatureDeliveryStateInput,
): Promise<RepairFeatureDeliveryStateResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const targetStage = assertFeatureDeliveryStage(input.stage);
  const reason = input.reason.trim();
  if (reason.length < 12) {
    throw new Error("repair-state requires a concrete --reason with at least 12 characters.");
  }

  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(repoRoot, input.artifact, "artifact");
  const previousStage = state.currentStage;

  state.currentStage = targetStage;
  state.status = "repaired";
  state.nextHumanAction = nextHumanActionForStage(state, targetStage, `Manual state repair: ${reason}`);
  state.stages = repairStageStatuses(state.stages, targetStage);
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "repair",
      from: previousStage,
      to: targetStage,
      event: "manual_repair",
      artifact: artifact.rel,
      reason,
    },
  ];

  const invocation = await readCursorInvocationMode(repoRoot);
  ensureAutomationState(state, invocation);
  if (invocation === "sdk") {
    state.status = "ready_for_stage_delegation";
    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    prepareStageInvocationIndexForSdkEntry(state, targetStage, invocation);
    await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId,
      featureId: state.featureId,
      fromStage: previousStage,
      toStage: targetStage,
      event: "manual_repair",
      persona: personaForStage(pipeline, targetStage) ?? undefined,
      now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: targetStage,
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    resetStageInvocationIndex(state);
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeRepairRecord(state, now, previousStage, targetStage, artifact.rel, reason),
  );

  return {
    command: "repair-state",
    status: "ok",
    taskId,
    featureId: state.featureId,
    previousStage,
    currentStage: state.currentStage,
    artifact: artifact.rel,
    reason,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
  };
}

export async function refreshFeatureDeliveryPrompt(
  input: RefreshFeatureDeliveryPromptInput,
): Promise<RefreshFeatureDeliveryPromptResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);

  await persistStateAndPrompts(repoRoot, state, pipeline, "refresh-prompt");

  return {
    command: "refresh-prompt",
    status: "ok",
    taskId,
    featureId: state.featureId,
    currentStage: state.currentStage,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
  };
}

export async function closeFeatureDeliveryArtifacts(
  input: CloseFeatureDeliveryArtifactsInput,
): Promise<CloseFeatureDeliveryArtifactsResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);

  if (state.currentStage !== TERMINAL_STAGE || state.status !== "complete") {
    if (state.currentStage === TERMINAL_STAGE && state.status === "closed") {
      throw new Error(`Task ${taskId} is already closed.`);
    }
    throw new Error(`Task ${taskId} must be complete before artifact closure; got ${state.currentStage}/${state.status}.`);
  }

  const closure = finalClosurePaths(state);
  const activeRunDirAbs = resolveRepoPath(repoRoot, closure.runDirRel);
  const archiveRunDirAbs = resolveRepoPath(repoRoot, closure.workArchiveRel);
  const inboxSourceAbs = resolveRepoPath(repoRoot, closure.inboxSourceRel);
  const inboxArchiveAbs = resolveRepoPath(repoRoot, closure.inboxArchiveRel);
  const policyRelActive = path.posix.join(closure.runDirRel, "policy-compliance.json");
  const policyRelArchive = path.posix.join(closure.workArchiveRel, "policy-compliance.json");
  const indexRel = path.posix.join("lib", "memory", "features", state.featureId, "index.json");
  const activeMemoryRel = path.posix.join("lib", "memory", "active", "current.md");

  const activeRunExists = existsSync(activeRunDirAbs);
  const archiveRunExists = existsSync(archiveRunDirAbs);
  const inboxSourceExists = existsSync(inboxSourceAbs);
  const inboxArchiveExists = existsSync(inboxArchiveAbs);

  if (activeRunExists && archiveRunExists) {
    throw new Error(
      `Duplicate run directories for task ${taskId}: both ${closure.runDirRel} and ${closure.workArchiveRel} exist. Roll back the premature archive move before close-artifacts.`,
    );
  }

  const alreadyArchived = !activeRunExists && archiveRunExists;
  const runDirRel = alreadyArchived ? closure.workArchiveRel : closure.runDirRel;
  const policyRel = alreadyArchived ? policyRelArchive : policyRelActive;

  if (!alreadyArchived) {
    await assertExistingDirectory(activeRunDirAbs, closure.runDirRel);
    await assertPathMissing(archiveRunDirAbs, closure.workArchiveRel);
  } else {
    await assertExistingDirectory(archiveRunDirAbs, closure.workArchiveRel);
  }

  await assertExistingFile(resolveRepoPath(repoRoot, policyRel), policyRel);
  await assertExistingFile(resolveRepoPath(repoRoot, indexRel), indexRel);

  if (!alreadyArchived) {
    await assertExistingFile(inboxSourceAbs, closure.inboxSourceRel);
    await assertPathMissing(inboxArchiveAbs, closure.inboxArchiveRel);
  } else if (!inboxArchiveExists && inboxSourceExists) {
    await assertPathMissing(inboxArchiveAbs, closure.inboxArchiveRel);
  } else if (inboxArchiveExists && inboxSourceExists) {
    throw new Error(
      `Duplicate inbox paths for task ${taskId}: both ${closure.inboxSourceRel} and ${closure.inboxArchiveRel} exist.`,
    );
  }

  const stateSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "state.json")),
    "utf8",
  );
  const handoffSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "handoff.md")),
    "utf8",
  );
  const nextPromptSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "next-prompt.md")),
    "utf8",
  );
  const runLogSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "run.log.jsonl")),
    "utf8",
  );
  const indexSnapshot = await readFile(resolveRepoPath(repoRoot, indexRel), "utf8");
  const activeMemoryAbs = resolveRepoPath(repoRoot, activeMemoryRel);
  const activeMemorySnapshot = existsSync(activeMemoryAbs)
    ? await readFile(activeMemoryAbs, "utf8")
    : null;

  if (!alreadyArchived) {
    await mkdir(path.dirname(archiveRunDirAbs), { recursive: true });
    await mkdir(path.dirname(inboxArchiveAbs), { recursive: true });
  } else if (inboxSourceExists && !inboxArchiveExists) {
    await mkdir(path.dirname(inboxArchiveAbs), { recursive: true });
  }

  let inboxArchived = alreadyArchived && inboxArchiveExists;
  let runArchived = alreadyArchived;
  try {
    if (!alreadyArchived) {
      await rename(inboxSourceAbs, inboxArchiveAbs);
      inboxArchived = true;
      await rename(activeRunDirAbs, archiveRunDirAbs);
      runArchived = true;
      await assertExistingDirectory(archiveRunDirAbs, closure.workArchiveRel);
      await removeEmptyDirectoryIfPresent(path.dirname(activeRunDirAbs), path.posix.dirname(closure.runDirRel));
    } else if (inboxSourceExists && !inboxArchiveExists) {
      await rename(inboxSourceAbs, inboxArchiveAbs);
      inboxArchived = true;
    }

    const previousRunDir = state.artifacts.runDir;
    state.artifacts = {
      runDir: closure.workArchiveRel,
      stateFile: path.posix.join(closure.workArchiveRel, "state.json"),
      handoffFile: path.posix.join(closure.workArchiveRel, "handoff.md"),
      runLogFile: path.posix.join(closure.workArchiveRel, "run.log.jsonl"),
      nextPromptFile: path.posix.join(closure.workArchiveRel, "next-prompt.md"),
    };
    state.status = "closed";
    state.nextHumanAction =
      "Artifact closure complete; active work and source inbox directive are archived. No further feature-delivery action is required.";
    state.advanceHistory = [
      ...(state.advanceHistory ?? []),
      {
        atIso: rfc3339UtcMs(now),
        kind: "close",
        from: TERMINAL_STAGE,
        to: TERMINAL_STAGE,
        event: "artifacts_closed",
        artifact: closure.workArchiveRel,
        reason: alreadyArchived
          ? `Finalized closure for run already archived at ${closure.workArchiveRel}.`
          : `Archived active run from ${previousRunDir} and source inbox directive from ${closure.inboxSourceRel}.`,
      },
    ];

    const persistedRunDirRel = closure.workArchiveRel;
    await writeFile(
      resolveRepoPath(repoRoot, path.posix.join(persistedRunDirRel, "state.json")),
      stringifyCliJson(repoRoot, state),
      "utf8",
    );
    await writeFile(
      resolveRepoPath(repoRoot, path.posix.join(persistedRunDirRel, "handoff.md")),
      renderHandoff(repoRoot, state, pipeline),
      "utf8",
    );
    await writeFile(
      resolveRepoPath(repoRoot, path.posix.join(persistedRunDirRel, "next-prompt.md")),
      `# Generated by pan close-artifacts\n\n${renderNextPrompt(repoRoot, state, pipeline)}`,
      "utf8",
    );
    await appendRunLogRecord(
      resolveRepoPath(repoRoot, path.posix.join(persistedRunDirRel, "run.log.jsonl")),
      makeCloseRecord(state, now, previousRunDir, closure.workArchiveRel, closure.inboxSourceRel, closure.inboxArchiveRel),
    );

    await patchFeatureIndexArchivedInbox(
      repoRoot,
      state.featureId,
      closure.inboxArchiveRel,
      closure.inboxSourceRel,
    );

    const activeMemoryRefresh = await applyActiveMemoryRefreshOnArtifactClosure(repoRoot, {
      archivedInboxSourceRel: closure.inboxSourceRel,
      clock: input.clock,
    });

    return {
      command: "close-artifacts",
      status: "ok",
      taskId,
      featureId: state.featureId,
      currentStage: TERMINAL_STAGE,
      pipelineStatus: "closed",
      archivedRunDir: closure.workArchiveRel,
      archivedInboxPath: closure.inboxArchiveRel,
      activeMemoryPath: activeMemoryRefresh.path,
      activeFeatureCleared: activeMemoryRefresh.activeFeatureCleared,
      stateFile: state.artifacts.stateFile,
      runLogFile: state.artifacts.runLogFile,
      nextPromptFile: requireNextPromptFile(state),
      nextHumanAction: state.nextHumanAction,
      ...(alreadyArchived ? { alreadyArchived: true } : {}),
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    const activeRunStateAbs = resolveRepoPath(repoRoot, closure.runDirRel);
    const archiveRunStateAbs = resolveRepoPath(repoRoot, closure.workArchiveRel);
    const activeInboxStateAbs = resolveRepoPath(repoRoot, closure.inboxSourceRel);
    const archiveInboxStateAbs = resolveRepoPath(repoRoot, closure.inboxArchiveRel);

    if (runArchived && existsSync(archiveRunStateAbs) && !existsSync(activeRunStateAbs)) {
      try {
        await mkdir(path.dirname(activeRunStateAbs), { recursive: true });
        await rename(archiveRunStateAbs, activeRunStateAbs);
      } catch (rollbackError) {
        rollbackFailures.push(`restore run directory (${formatError(rollbackError)})`);
      }
    }
    if (inboxArchived && existsSync(archiveInboxStateAbs) && !existsSync(activeInboxStateAbs)) {
      try {
        await mkdir(path.dirname(activeInboxStateAbs), { recursive: true });
        await rename(archiveInboxStateAbs, activeInboxStateAbs);
      } catch (rollbackError) {
        rollbackFailures.push(`restore inbox directive (${formatError(rollbackError)})`);
      }
    }

    if (existsSync(activeRunStateAbs)) {
      try {
        await writeFile(path.join(activeRunStateAbs, "state.json"), stateSnapshot, "utf8");
        await writeFile(path.join(activeRunStateAbs, "handoff.md"), handoffSnapshot, "utf8");
        await writeFile(path.join(activeRunStateAbs, "next-prompt.md"), nextPromptSnapshot, "utf8");
        await writeFile(path.join(activeRunStateAbs, "run.log.jsonl"), runLogSnapshot, "utf8");
      } catch (rollbackError) {
        rollbackFailures.push(`restore active run files (${formatError(rollbackError)})`);
      }
    }

    try {
      await writeFile(resolveRepoPath(repoRoot, indexRel), indexSnapshot, "utf8");
    } catch (rollbackError) {
      rollbackFailures.push(`restore feature index (${formatError(rollbackError)})`);
    }
    if (activeMemorySnapshot !== null) {
      try {
        await writeFile(activeMemoryAbs, activeMemorySnapshot, "utf8");
      } catch (rollbackError) {
        rollbackFailures.push(`restore active memory (${formatError(rollbackError)})`);
      }
    }

    if (rollbackFailures.length > 0) {
      throw new Error(
        `close-artifacts failed (${formatError(error)}); rollback incomplete: ${rollbackFailures.join("; ")}.`,
      );
    }
    throw error;
  }
}

/**
 * Accepts nested `lib/inbox/in/`-relative POSIX paths after inbox convention migration.
 * @param {string} value
 * @param {string} label
 */
function assertInboxInRelativePath(value: string, label: string): string {
  let norm = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (norm === "" || norm.includes("\0")) {
    throw new Error(`${label} MUST be a non-empty relative path.`);
  }
  const inboxPrefix = "lib/inbox/in/";
  if (norm.startsWith(inboxPrefix)) {
    norm = norm.slice(inboxPrefix.length);
  }
  const segments = norm.split("/").filter(Boolean);
  for (const s of segments) {
    if (s === ".." || s === ".") {
      throw new Error(`${label} MUST NOT contain dot segments.`);
    }
  }
  if (segments.length === 0) {
    throw new Error(`${label} MUST resolve to a path under lib/inbox/in/.`);
  }
  return norm;
}

function sanitizeSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/^\d+_\d+_/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  if (slug.length === 0) {
    throw new Error("feature id MUST contain at least one alphanumeric character.");
  }
  return slug;
}

function sanitizeTaskId(raw: string): string {
  const taskId = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
  }
  return taskId;
}

async function suggestTaskIdFromSlug(repoRoot: string, rawTaskId: string): Promise<string | null> {
  const slug = taskIdSlugCandidate(rawTaskId);
  if (slug === null) {
    return null;
  }
  const roots = [
    resolveProjectPath(repoRoot, "work"),
    resolveProjectPath(repoRoot, "archive", "work"),
  ];
  const suffix = `_${slug}`;
  const matches: Array<{ taskId: string; mtimeMs: number }> = [];
  for (const root of roots) {
    const dayDirs = await safeReaddir(root);
    for (const dayDir of dayDirs) {
      const dayAbs = path.join(root, dayDir);
      let dayInfo;
      try {
        dayInfo = await stat(dayAbs);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          continue;
        }
        throw error;
      }
      if (!dayInfo.isDirectory()) {
        continue;
      }
      const taskDirs = await safeReaddir(dayAbs);
      for (const taskDir of taskDirs) {
        if (!TASK_ID_PATTERN.test(taskDir) || !taskDir.endsWith(suffix)) {
          continue;
        }
        const stateAbs = path.join(dayAbs, taskDir, "state.json");
        try {
          const stateInfo = await stat(stateAbs);
          if (!stateInfo.isFile()) {
            continue;
          }
          matches.push({ taskId: taskDir, mtimeMs: stateInfo.mtimeMs });
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT" || err.code === "ENOTDIR") {
            continue;
          }
          throw error;
        }
      }
    }
  }
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.taskId ?? null;
}

function taskIdSlugCandidate(rawTaskId: string): string | null {
  const normalized = rawTaskId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (normalized.length === 0) {
    return null;
  }
  const segments = normalized.split("_").filter((part) => part.length > 0);
  if (segments.length < 2) {
    return null;
  }
  const slug = segments.length >= 3 ? segments.slice(2).join("_") : segments.slice(1).join("_");
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(slug)) {
    return null;
  }
  return slug;
}

function deriveFeatureId(inboxEntry: string, directive: string): string {
  const title = directive.match(/^#\s+(.+)$/mu)?.[1];
  return title ?? inboxEntry;
}

function makeDayDir(now: Date): string {
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

function makeTaskId(now: Date, featureId: string): string {
  const dayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const nextDayStart = dayStart + 86400000;
  const secondsToMidnight = Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${secondsToMidnight}_${hh}${mm}_${featureId}`;
}

function buildStageStates(pipeline: PipelineDefinition): FeatureDeliveryStageState[] {
  return pipeline.stages.map((stage, index) => ({
    id: stage.id,
    ...(stage.persona !== undefined ? { persona: stage.persona } : {}),
    ...(stage.label !== undefined ? { label: stage.label } : {}),
    status: index === 0 ? "ready" : "pending",
    ...stageGate(stage),
  }));
}

function stageGate(stage: PipelineStage): Pick<FeatureDeliveryStageState, "humanGate" | "humanAttention"> {
  switch (stage.id) {
    case "intake":
      return {
        humanGate: "human_approval",
        humanAttention: "Answer intake clarifying questions and ratify the canonical spec before planning.",
      };
    case "plan":
      return {
        humanGate: "human_approval",
        humanAttention: "Ratify the plan, ADR draft, touch-set, and handoff before execution.",
      };
    case "implement":
      return {
        humanGate: "operator_intervention_available",
        humanAttention: "Use pan pause/resume/abort if implementation drifts, loops, or exceeds scope.",
      };
    case "review":
      return {
        humanGate: "review_passes_or_reenter_implement",
        humanAttention: "Inspect high findings; approve only clean review output or send the run back to implement.",
      };
    case "test":
      return {
        humanGate: "qa_passes_or_reenter_implement",
        humanAttention: "Inspect test-report.md; approve only when qa_passes is true or send the run back to implement.",
      };
    case "ship":
      return {
        humanGate: "local_stage_only",
        humanAttention: "Review the local diff and delivery report; no agent may push or open the PR unaudited.",
      };
    case "index":
      return {
        humanGate: "archive_and_index_audit",
        humanAttention: "Verify feature index artifacts; after index is accepted, the generated complete-stage prompt gives the human operator exact archival closure commands.",
      };
    default:
      return {};
  }
}

function featureDeliveryTransitions(): FeatureDeliveryTransition[] {
  return [
    {
      from: "created",
      on: "invoke",
      to: "intake",
      humanAttention: "Operator delegates the handoff card to intake-analyst.",
    },
    {
      from: "intake",
      on: "human_approval",
      to: "plan",
      humanAttention: "Canonical spec is ratified or clarified before plan starts.",
    },
    {
      from: "plan",
      on: "human_approval",
      to: "implement",
      humanAttention: "Plan and touch-set are ratified before coder starts.",
    },
    {
      from: "implement",
      on: "pause",
      to: "paused",
      humanAttention: "Use pan pause <task-id> to stop at the next safe boundary.",
    },
    {
      from: "paused",
      on: "resume",
      to: "implement",
      humanAttention: "Use pan resume <task-id> after resolving the blocker.",
    },
    {
      from: "implement",
      on: "abort",
      to: "aborted",
      humanAttention: "Use pan abort <task-id> --reason <text> for failed or superseded runs.",
    },
    {
      from: "implement",
      on: "implementation_complete",
      to: "review",
      humanAttention: "Reviewer receives only the handoff, touch-set, diff, and validation output.",
    },
    {
      from: "review",
      on: "must_fix",
      to: "implement",
      humanAttention: "Bounded re-entry; high findings block shipping.",
    },
    {
      from: "review",
      on: "review_passes",
      to: "test",
      humanAttention: "Human should still inspect review output before qa-tester runs.",
    },
    {
      from: "test",
      on: "qa_passes",
      to: "report",
      humanAttention: "Human should inspect test-report.md before report/ship.",
    },
    {
      from: "test",
      on: "qa_fails",
      to: "implement",
      humanAttention: "Bounded re-entry; qa failures block shipping.",
    },
    {
      from: "test",
      on: "qa_fails_plan_invalidating",
      to: "plan",
      humanAttention: "Plan-invalidating QA failure; re-plan before re-implementing.",
    },
    {
      from: "report",
      on: "report_ready",
      to: "ship",
      humanAttention: "Delivery report must be useful to the operator, not just a changelog.",
    },
    {
      from: "ship",
      on: "human_ratifies_local_diff",
      to: "index",
      humanAttention: "No push occurs before human review.",
    },
    {
      from: "index",
      on: "artifacts_indexed",
      to: "complete",
      humanAttention: "Confirm archive/index state and outbox report.",
    },
  ];
}

function renderHandoff(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
  directive?: string,
): string {
  const nextPersona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  const excerpt = directive?.trim().split(/\r?\n/u).slice(0, 20).join("\n");
  return `# Feature delivery handoff — ${state.featureId}

- Feature id: ${state.featureId}
- Task id: ${state.taskId}
- Pipeline: ${state.pipelineId}
- Current stage: ${stage}
- Executor persona: ${nextPersona}
- Source directive: ${state.source.inboxPath}
- State file: ${state.artifacts.stateFile}
- Run log: ${state.artifacts.runLogFile}
- Next prompt: ${requireNextPromptFile(state)}

## Stage contract

${stageContractMarkdown(repoRoot, state, stage)}

## In-scope paths

- ${state.source.inboxPath}
- lib/memory/features/${state.featureId}/spec.md
- ${state.artifacts.runDir}/plan.md
- ${state.artifacts.runDir}/adr-draft.md
- ${state.artifacts.runDir}/touch-set.json
- ${state.artifacts.runDir}/implementation-report.md
- ${state.artifacts.runDir}/review.md
- ${state.artifacts.runDir}/test-report.md
- lib/memory/features/${state.featureId}/delivery-report.md
- lib/inbox/out/<timestamp>-${state.featureId}-delivery-report.md

## Explicit non-goals

- Do not read or write lib/inbox/notes/.
- Do not continue past a human gate without explicit ratification.
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; use the stage prompt and named stage inputs.

## Validation commands

- node --test tests/*.test.mjs
- node lib/internal/tools/check-phase-0a-scaffold.mjs
- node lib/internal/tools/context-budget-report.mjs
- bash -n .cursor/hooks/enforce-policy-compliance.sh

## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.
${excerpt === undefined || excerpt.length === 0 ? "" : `
## Directive excerpt

\`\`\`markdown
${excerpt}
\`\`\`
`}`;
}

function renderNextPrompt(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
): string {
  if (state.currentStage === TERMINAL_STAGE && state.status === "closed") {
    return renderClosedPrompt(state);
  }
  const persona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  return `You are executing the ${stage} stage for feature-delivery task ${state.taskId}.

Use subagent/persona: ${persona}

Read first, in this order:
1. AGENTS.md
2. ${state.artifacts.handoffFile}
3. The stage input paths listed below

Do not read broad archives, full PRD/bootstrap docs, lib/inbox/notes/**, or unrelated work/** paths unless the handoff explicitly requires it.

${stageContractMarkdown(repoRoot, state, stage)}

After the stage artifact is accepted by the human operator, run exactly one matching state command from the handoff instructions. Do not continue to the next persona in the same agent loop.
`;
}

function stageContractMarkdown(repoRoot: string, state: FeatureDeliveryState, stage: string): string {
  const advanceLine = (forStage: string, event?: string): string => {
    if (forStage !== state.currentStage) {
      return staticAdvanceLineForStage(state, forStage, event);
    }
    const step = resolveNextStep(state, { stage: forStage, event, repoRoot });
    if (step.nextCommand !== null) {
      return step.nextCommand;
    }
    return step.reason ?? "No advance command is available for the current ledger state.";
  };

  switch (stage) {
    case "intake":
      return `Input: ${state.source.inboxPath}\nOutput: lib/memory/features/${state.featureId}/spec.md\nAdvance after human ratification: ${advanceLine("intake")}`;
    case "plan":
      return `Input: lib/memory/features/${state.featureId}/spec.md\nOutputs: ${state.artifacts.runDir}/plan.md, ${state.artifacts.runDir}/adr-draft.md, ${state.artifacts.runDir}/touch-set.json, ${state.artifacts.handoffFile}\nAdvance after human ratification: ${advanceLine("plan")}`;
    case "implement": {
      const base = `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json\nOutput: ${state.artifacts.runDir}/implementation-report.md\nAdvance after implementation is accepted: ${advanceLine("implement")}`;
      const reentry = resolveImplementMustFixReentry(state, repoRoot);
      if (reentry !== null) {
        return `${base}\nAfter must_fix fixes, when ${state.artifacts.runDir}/review.md already records review_passes: true, chain to test in one step: ${reentry.nextCommand}`;
      }
      return base;
    }
    case "review":
      return `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json, current local diff, validation output\nOutput: ${state.artifacts.runDir}/review.md\nAdvance on pass: ${advanceLine("review", "review_passes")}\nReturn to implement on must-fix: pnpm -w exec pan advance ${state.taskId} --event must_fix --artifact ${state.artifacts.runDir}/review.md`;
    case "test":
      return `Inputs: ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/touch-set.json, current local diff, validation output\nOutput: ${state.artifacts.runDir}/test-report.md\nAdvance on pass: ${advanceLine("test", "qa_passes")}\nReturn to implement on qa-fail: pnpm -w exec pan advance ${state.taskId} --event qa_fails --artifact ${state.artifacts.runDir}/test-report.md`;
    case "report":
      return `Inputs: ${state.artifacts.runDir}/implementation-report.md, ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/test-report.md\nOutput: lib/memory/features/${state.featureId}/delivery-report.md\nCitation rule: each claim MUST use fenced canonical JSON with double-quoted keys per lib/personas/tech-writer.md §Conformance gates; JS-literal {kind: lines, ...} form is forbidden.\nBefore advance, run: node --test tests/migrate-json-formatting.test.mjs\nAdvance after report is accepted: ${advanceLine("report")}`;
    case "ship":
      return `Inputs: local diff, validation output, lib/memory/features/${state.featureId}/delivery-report.md\nOutput: ${state.artifacts.runDir}/policy-compliance.json\nAdvance only after human ratifies local diff: ${advanceLine("ship")}`;
    case "index":
      return `Inputs: delivery report and accepted ship artifacts\nOutput: lib/memory/features/${state.featureId}/index.json\nIndex rule: link active ${state.artifacts.runDir}/ paths (not archive/work/).\nDo NOT mv work/ to archive/work/; pnpm -w exec pan close-artifacts performs archival at complete.\nAdvance after artifacts are indexed: ${advanceLine("index")}`;
    case "complete":
      return state.status === "closed" ? closedContractMarkdown(state) : finalClosureContractMarkdown(state);
    default:
      return `No stage contract is defined for ${stage}.`;
  }
}

function staticAdvanceLineForStage(
  state: FeatureDeliveryState,
  stage: string,
  event?: string,
): string {
  const resolvedEvent = event ?? defaultEventForStage(stage);
  const contract = stageArtifactContract(state, stage, resolvedEvent);
  const cmd = `pnpm -w exec pan advance ${state.taskId} --artifact ${contract.primaryArtifact}`;
  if (stage === "review" && resolvedEvent === "must_fix") {
    return `pnpm -w exec pan advance ${state.taskId} --event must_fix --artifact ${contract.primaryArtifact}`;
  }
  if (stage === "test" && resolvedEvent === "qa_fails") {
    return `pnpm -w exec pan advance ${state.taskId} --event qa_fails --artifact ${contract.primaryArtifact}`;
  }
  return cmd;
}

export function resolveNextStep(
  state: FeatureDeliveryState,
  options?: { stage?: string; event?: string; repoRoot?: string },
): NextStep {
  const stage = options?.stage ?? state.currentStage;

  if (state.nextCommand !== undefined && state.nextCommand.trim().length > 0) {
    const parsed = parsePersistedAdvanceCommand(state.nextCommand);
    return {
      event: parsed.event,
      artifact: parsed.artifact,
      nextCommand: state.nextCommand,
      source: "persisted",
    };
  }

  if (
    state.status === "halted" ||
    state.status === "closed" ||
    state.currentStage === "aborted" ||
    state.currentStage === TERMINAL_STAGE
  ) {
    return {
      event: null,
      artifact: null,
      nextCommand: null,
      source: "derived",
      reason: `pipeline is terminal (${state.status}, stage ${state.currentStage})`,
    };
  }

  const reentry = resolveImplementMustFixReentry(state, options?.repoRoot);
  if (reentry !== null && stage === "implement") {
    return reentry;
  }

  const event = options?.event ?? defaultEventForStage(stage);
  try {
    const contract = stageArtifactContract(state, stage, event);
    const nextCommand = buildAdvanceCommand(state.taskId, contract.primaryArtifact, stage, event);
    return {
      event,
      artifact: contract.primaryArtifact,
      nextCommand,
      source: "derived",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      event: null,
      artifact: null,
      nextCommand: null,
      source: "derived",
      reason: message,
    };
  }
}

function parsePersistedAdvanceCommand(nextCommand: string): {
  event: string | null;
  artifact: string | null;
} {
  const eventMatch = /--event\s+(\S+)/u.exec(nextCommand);
  const artifactMatch = /--artifact\s+(\S+)/u.exec(nextCommand);
  return {
    event: eventMatch?.[1] ?? null,
    artifact: artifactMatch?.[1] ?? null,
  };
}

function buildAdvanceCommand(taskId: string, artifact: string, stage: string, event: string): string {
  if (stage === "review" && event === "must_fix") {
    return `pnpm -w exec pan advance ${taskId} --event must_fix --artifact ${artifact}`;
  }
  if (stage === "test" && (event === "qa_fails" || event === "qa_fails_plan_invalidating")) {
    return `pnpm -w exec pan advance ${taskId} --event ${event} --artifact ${artifact}`;
  }
  return `pnpm -w exec pan advance ${taskId} --artifact ${artifact}`;
}

function resolveImplementMustFixReentry(
  state: FeatureDeliveryState,
  repoRoot?: string,
): NextStep | null {
  if (state.currentStage !== "implement") {
    return null;
  }
  const lastAdvance = lastAdvanceEntry(state);
  if (lastAdvance?.event !== "must_fix" || lastAdvance.from !== "review") {
    return null;
  }
  const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
  if (repoRoot === undefined) {
    return null;
  }
  const reviewPath = resolveRepoPath(repoRoot, reviewArtifact);
  if (!existsSync(reviewPath)) {
    return null;
  }
  const verdict = parseReviewPassesVerdict(readFileSync(reviewPath, "utf8"));
  if (verdict !== true) {
    return null;
  }
  return {
    event: "review_passes",
    artifact: reviewArtifact,
    nextCommand: buildAdvanceCommand(state.taskId, reviewArtifact, "review", "review_passes"),
    source: "derived",
  };
}

function isNonTerminalFeatureDeliveryState(state: FeatureDeliveryState): boolean {
  return (
    state.status !== "halted" &&
    state.status !== "closed" &&
    state.currentStage !== "aborted" &&
    state.currentStage !== TERMINAL_STAGE
  );
}

function enrichFeatureDeliveryEnvelope<T extends Record<string, unknown>>(
  repoRoot: string,
  state: FeatureDeliveryState,
  payload: T,
): T & { nextCommand?: string | null; event?: string | null; artifact?: string | null } {
  type Enriched = T & {
    nextCommand?: string | null;
    event?: string | null;
    artifact?: string | null;
  };
  if (!isNonTerminalFeatureDeliveryState(state)) {
    return { ...payload, nextCommand: null, event: null, artifact: null } as Enriched;
  }
  const step = resolveNextStep(state, { repoRoot });
  const enriched = {
    ...payload,
    nextCommand: step.nextCommand,
  };
  if ("event" in payload) {
    return enriched as Enriched;
  }
  return {
    ...enriched,
    event: step.event,
    artifact: step.artifact,
  } as Enriched;
}

function decodedTimestampFields(
  runDirRel: string,
  taskId: string,
): { decodedTimestamp?: string; decodedTimestampDiagnostic?: string } {
  const parsed = parseRunDirParts(runDirRel);
  if (parsed === null) {
    return {};
  }
  const decoded = decodeCountdownTimestamp(parsed.dayBucket, taskId);
  if (decoded.ok) {
    return { decodedTimestamp: decoded.utcLabel };
  }
  return { decodedTimestampDiagnostic: decoded.diagnostic };
}

export async function resolveFeatureDeliveryNext(
  repoRootInput: string,
  taskIdInput: string,
): Promise<FeatureDeliveryNextResult> {
  const repoRoot = path.resolve(repoRootInput);
  const taskId = sanitizeTaskId(taskIdInput);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const step = resolveNextStep(state, { repoRoot });
  const decoded = decodedTimestampFields(state.artifacts.runDir, taskId);
  return {
    command: "next",
    status: "ok",
    taskId,
    featureId: state.featureId,
    runDir: state.artifacts.runDir,
    currentStage: state.currentStage,
    pipelineStatus: state.status,
    nextHumanAction: state.nextHumanAction,
    event: step.event,
    artifact: step.artifact,
    nextCommand: step.nextCommand,
    source: step.source,
    ...(step.reason !== undefined ? { reason: step.reason } : {}),
    ...decoded,
  };
}

export async function validateArtifactsForTask(input: {
  repoRoot: string;
  taskId: string;
  stage: string;
}): Promise<ValidateArtifactsResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const stage = assertFeatureDeliveryStage(input.stage);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const validation = validateStageCompletionArtifacts(repoRoot, state, stage);
  const clean = validation.ok && validation.warningCount === 0;
  return {
    command: "artifacts validate",
    status: clean ? "ok" : "invalid",
    taskId,
    stage,
    warningCount: validation.warningCount,
    warnings: validation.warnings,
    missing: validation.missing,
    present: validation.present,
  };
}

function collectStageContentWarnings(
  repoRoot: string,
  state: FeatureDeliveryState,
  stage: string,
): ArtifactContentWarning[] {
  const validation = validateStageCompletionArtifacts(repoRoot, state, stage);
  return validation.warnings;
}

function finalClosureContractMarkdown(state: FeatureDeliveryState): string {
  const closure = finalClosurePaths(state);
  return `Final artifact closure is delegated to librarian after the human operator has already ratified validation and indexing.

Librarian task:

1. Confirm the run is complete and the active artifacts exist.
2. Execute the artifact closure command exactly once:

\`\`\`bash
pnpm -w exec pan close-artifacts ${state.taskId}
\`\`\`

3. Verify the command output reports:
   - archivedRunDir: ${closure.workArchiveRel}
   - archivedInboxPath: ${closure.inboxArchiveRel}
   - activeMemoryPath: lib/memory/active/current.md (refreshed automatically; Active Feature clears to \`(none)\` when it matched the archived inbox source)
4. Run \`pnpm -w exec pan status ${state.taskId}\` and confirm the status resolves from the archive.
5. Report the resulting \`git status --short\`.

Do not manually move files from work/ to archive/work/. When closure fails, report the error to the operator.`;
}

function renderClosedPrompt(state: FeatureDeliveryState): string {
  return `Feature-delivery task ${state.taskId} is closed.

Artifact closure has already completed.

Archived run directory: ${state.artifacts.runDir}
State file: ${state.artifacts.stateFile}
Run log: ${state.artifacts.runLogFile}

No further feature-delivery agent action is required.`;
}

function closedContractMarkdown(state: FeatureDeliveryState): string {
  return `Artifact closure completed.

Archived run directory: ${state.artifacts.runDir}
State file: ${state.artifacts.stateFile}
Run log: ${state.artifacts.runLogFile}

No further feature-delivery action is required.`;
}

function finalClosurePaths(state: FeatureDeliveryState): {
  runDirRel: string;
  workArchiveRel: string;
  inboxSourceRel: string;
  inboxArchiveRel: string;
} {
  const run = parseWorkRunDir(state.artifacts.runDir, state.taskId);
  const inboxSourceRel = state.source.inboxPath.replace(/\\/gu, "/").replace(/^\/+/, "");
  return {
    runDirRel: state.artifacts.runDir,
    workArchiveRel: path.posix.join("archive", "work", run.dayDir, run.taskId),
    inboxSourceRel,
    inboxArchiveRel: archiveInboxPathForSource(inboxSourceRel, run.dayDir, run.taskId),
  };
}

function parseWorkRunDir(runDirRel: string, expectedTaskId: string): { dayDir: string; taskId: string } {
  const parts = runDirRel.split("/");
  if (parts.length !== 3 || parts[0] !== "work") {
    throw new Error(`feature-delivery runDir must be work/<day>/<task-id>; got ${runDirRel}.`);
  }
  const [, dayDir, taskId] = parts;
  if (taskId !== expectedTaskId) {
    throw new Error(`feature-delivery runDir task id ${taskId} does not match state task id ${expectedTaskId}.`);
  }
  return { dayDir, taskId };
}

function archiveInboxPathForSource(sourceRel: string, dayDir: string, taskId: string): string {
  const prefix = "lib/inbox/in/";
  if (!sourceRel.startsWith(prefix)) {
    throw new Error(`feature-delivery source inbox path must be under ${prefix}; got ${sourceRel}.`);
  }
  const tail = sourceRel.slice(prefix.length);
  if (tail.length === 0 || tail.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`feature-delivery source inbox path has an invalid relative tail: ${sourceRel}.`);
  }
  const parts = tail.split("/");
  const alreadyNested = parts.length >= 3 && isWorkStyleDayDir(parts[0]) && parts[1] === taskId;
  const archiveTail = alreadyNested ? tail : path.posix.join(dayDir, taskId, path.posix.basename(tail));
  return path.posix.join("archive", "inbox", "in", archiveTail);
}

function isWorkStyleDayDir(value: string): boolean {
  return /^\d{6}_\d{2}-\d{2}-\d{2}$/u.test(value);
}

function makeInterventionRecord(
  state: FeatureDeliveryState,
  now: Date,
  command: "pause" | "resume" | "abort",
  abortReason?: string,
): RunLogRecord {
  const checkpointSeq = state.advanceHistory?.length ?? 0;
  const attrs: Record<string, unknown> = {
    "openinference.span.kind": "CHAIN",
    "gen_ai.operation.name": `pancreator.pipeline.intervention.${command}`,
    "gen_ai.provider.name": "local-cli",
    "gen_ai.request.model": "none",
    "pancreator.feature_id": state.featureId,
    "pancreator.state_file": state.artifacts.stateFile,
    "pancreator.intervention.command": command,
  };
  if (abortReason !== undefined) {
    attrs["pancreator.intervention.abort_reason"] = abortReason;
  }
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: `pancreator.pipeline.intervention.${command}`,
    kind: "event",
    status: { code: "OK" },
    attributes: attrs,
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: state.currentStage,
      outcome: command === "abort" ? "aborted" : "success",
      checkpoint_seq: checkpointSeq,
      token_usage_unavailable: true,
      intervention: { lever: command },
    },
  };
}

function makeInvocationRecord(state: FeatureDeliveryState, now: Date): RunLogRecord {
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: "pancreator.pipeline.invoke",
    kind: "event",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": "pipeline.invoke",
      "gen_ai.provider.name": "local-cli",
      "gen_ai.request.model": "none",
      "pancreator.feature_id": state.featureId,
      "pancreator.state_file": state.artifacts.stateFile,
    },
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: "invoke",
      outcome: "success",
      checkpoint_seq: 0,
      token_usage_unavailable: true,
    },
  };
}

function makeAdvanceRecord(
  state: FeatureDeliveryState,
  now: Date,
  fromStage: string,
  toStage: string,
  event: string,
  artifact: string,
  options?: { contentWarnings?: ArtifactContentWarning[] },
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.advance",
    fromStage,
    toStage,
    event,
    artifact,
  );
  const contentWarnings = options?.contentWarnings ?? [];
  if (contentWarnings.length === 0) {
    return record;
  }
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.content_warning_count": contentWarnings.length,
      "pancreator.content_warnings": contentWarnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
        message: warning.message,
      })),
    },
  };
}

function makeRepairRecord(
  state: FeatureDeliveryState,
  now: Date,
  fromStage: string,
  toStage: string,
  artifact: string,
  reason: string,
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.repair_state",
    fromStage,
    toStage,
    "manual_repair",
    artifact,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.repair.reason": reason,
    },
  };
}

function makeCloseRecord(
  state: FeatureDeliveryState,
  now: Date,
  previousRunDir: string,
  archivedRunDir: string,
  inboxSource: string,
  archivedInboxPath: string,
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.close_artifacts",
    TERMINAL_STAGE,
    TERMINAL_STAGE,
    "artifacts_closed",
    archivedRunDir,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.previous_run_dir": previousRunDir,
      "pancreator.archived_run_dir": archivedRunDir,
      "pancreator.inbox_source": inboxSource,
      "pancreator.archived_inbox_path": archivedInboxPath,
    },
  };
}

function makeStateRecord(
  state: FeatureDeliveryState,
  now: Date,
  name: string,
  fromStage: string,
  toStage: string,
  event: string,
  artifact: string,
): RunLogRecord {
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name,
    kind: "event",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": name,
      "gen_ai.provider.name": "local-cli",
      "gen_ai.request.model": "none",
      "pancreator.feature_id": state.featureId,
      "pancreator.state_file": state.artifacts.stateFile,
      "pancreator.from_stage": fromStage,
      "pancreator.to_stage": toStage,
      "pancreator.transition_event": event,
      "pancreator.artifact": artifact,
    },
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: fromStage,
      outcome: "success",
      checkpoint_seq: state.advanceHistory?.length ?? 0,
      token_usage_unavailable: true,
    },
  };
}

async function findStateFile(repoRoot: string, taskId: string): Promise<{ abs: string; rel: string }> {
  const roots = [
    { abs: resolveProjectPath(repoRoot, "work"), rel: path.posix.join("work") },
    { abs: resolveProjectPath(repoRoot, "archive", "work"), rel: path.posix.join("archive", "work") },
  ];

  const matches: Array<{ abs: string; rel: string; rootKind: "work" | "archive" }> = [];

  for (const root of roots) {
    const dayDirs = await safeReaddir(root.abs);
    for (const day of dayDirs) {
      const candidate = path.join(root.abs, day, taskId, "state.json");
      try {
        await readFile(candidate, "utf8");
        matches.push({
          abs: candidate,
          rel: path.posix.join(root.rel, day, taskId, "state.json"),
          rootKind: root.rel === "work" ? "work" : "archive",
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
          throw error;
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No feature-delivery state.json found for task ${taskId}.`);
  }

  const workMatch = matches.find((match) => match.rootKind === "work");
  const archiveMatch = matches.find((match) => match.rootKind === "archive");

  if (workMatch !== undefined && archiveMatch !== undefined) {
    const workState = await readFeatureDeliveryState(workMatch.abs);
    if (workState.status !== "closed") {
      return workMatch;
    }
    return archiveMatch;
  }

  return matches[0]!;
}

async function readFeatureDeliveryState(stateFile: string): Promise<FeatureDeliveryState> {
  const parsed = JSON.parse(await readFile(stateFile, "utf8")) as FeatureDeliveryState;
  if (parsed.pipelineId !== "feature-delivery") {
    throw new Error(`Expected feature-delivery state file; found ${parsed.pipelineId}.`);
  }
  if (parsed.artifacts.nextPromptFile === undefined) {
    parsed.artifacts.nextPromptFile = path.posix.join(parsed.artifacts.runDir, "next-prompt.md");
  }
  return parsed;
}

function loadFeatureDeliveryPipeline(repoRoot: string): PipelineDefinition {
  const pipeline = loadPipelineYaml(resolveProjectPath(repoRoot, "lib", "pipelines", "feature-delivery.yaml"));
  if (pipeline.id !== "feature-delivery") {
    throw new Error(`Expected feature-delivery pipeline; found ${pipeline.id}.`);
  }
  return pipeline;
}

async function persistStateAndPrompts(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
  mode: "advance" | "repair" | "refresh-prompt",
): Promise<void> {
  const statePath = resolveRepoPath(repoRoot, state.artifacts.stateFile);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const serialized = JSON.parse(stringifyCliJson(repoRoot, state)) as Record<string, unknown>;
  if (existing.schemaVersion !== undefined) {
    serialized.schemaVersion = existing.schemaVersion;
  }
  const merged = { ...existing, ...serialized };
  if (state.nextCommand === undefined || state.nextCommand.trim().length === 0) {
    delete merged.nextCommand;
  }
  await writeFile(statePath, stringifyCliJson(repoRoot, merged), "utf8");
  await writeFile(
    resolveRepoPath(repoRoot, state.artifacts.handoffFile),
    renderHandoff(repoRoot, state, pipeline),
    "utf8",
  );
  await writeFile(
    resolveRepoPath(repoRoot, requireNextPromptFile(state)),
    `# Generated by pan ${mode}\n\n${renderNextPrompt(repoRoot, state, pipeline)}`,
    "utf8",
  );
}

interface AppliedFeatureDeliveryTransition {
  fromStage: string;
  toStage: FeatureDeliveryCurrentStage;
  event: string;
  artifact: string;
}

interface ReviewReentryAdvancePlan {
  reviewArtifact: string;
  implementationReport: string;
}

function applyFeatureDeliveryTransition(
  state: FeatureDeliveryState,
  transition: FeatureDeliveryTransition,
  event: string,
  artifactRel: string,
  now: Date,
): AppliedFeatureDeliveryTransition {
  const fromStage = state.currentStage;
  const toStage = transition.to as FeatureDeliveryCurrentStage;
  state.currentStage = toStage;
  state.status = toStage === TERMINAL_STAGE ? "complete" : "ready_for_stage_delegation";
  state.nextHumanAction = nextHumanActionForStage(state, toStage, transition.humanAttention);
  state.stages = applyStageStatuses(state.stages, fromStage, toStage, event);
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "advance",
      from: fromStage,
      to: toStage,
      event,
      artifact: artifactRel,
    },
  ];
  return { fromStage, toStage, event, artifact: artifactRel };
}

function lastAdvanceEntry(
  state: FeatureDeliveryState,
): FeatureDeliveryAdvanceHistoryEntry | undefined {
  const history = state.advanceHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.kind === "advance") {
      return entry;
    }
  }
  return undefined;
}

async function tryResolveReviewReentryAdvance(
  repoRoot: string,
  state: FeatureDeliveryState,
  artifactRel: string,
  eventOverride?: string,
): Promise<ReviewReentryAdvancePlan | null> {
  if (state.currentStage !== "implement") {
    return null;
  }
  const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
  if (artifactRel !== reviewArtifact) {
    return null;
  }
  if (eventOverride !== undefined && eventOverride !== "review_passes") {
    return null;
  }

  const lastAdvance = lastAdvanceEntry(state);
  if (lastAdvance?.event !== "must_fix" || lastAdvance.from !== "review") {
    return null;
  }

  const reviewContent = await readFile(resolveRepoPath(repoRoot, reviewArtifact), "utf8");
  const verdict = parseReviewPassesVerdict(reviewContent);
  if (verdict !== true) {
    throw new Error(
      `Cannot advance ${state.taskId} with ${reviewArtifact} from implement after must_fix: ` +
        `review.md must contain review_passes: true. ` +
        `Advance with ${path.posix.join(state.artifacts.runDir, "implementation-report.md")} to return to review, ` +
        `or update review.md and retry. When review passes, the chain lands at test stage.`,
    );
  }

  const implementationReport = path.posix.join(state.artifacts.runDir, "implementation-report.md");
  if (!existsSync(resolveRepoPath(repoRoot, implementationReport))) {
    throw new Error(
      `Cannot advance ${state.taskId} with ${reviewArtifact} from implement after must_fix: ` +
        `required artifact is missing: ${implementationReport}.`,
    );
  }

  return { reviewArtifact, implementationReport };
}

async function tryAdvanceFromReportApproval(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  artifactRel: string;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult | null> {
  if (!input.artifactRel.startsWith("lib/inbox/out/")) {
    return null;
  }
  const content = await readFile(resolveRepoPath(input.repoRoot, input.artifactRel), "utf8");
  const decision = parseReportApprovalArtifact(content);
  if (decision === null) {
    return null;
  }
  if (input.state.automation?.reportApprovalPending !== true && input.state.status !== "waiting_for_human_gate") {
    throw new Error(
      `Artifact ${input.artifactRel} is a report-approval decision but task ${input.taskId} is not awaiting report approval.`,
    );
  }

  if (decision.decision === "approve") {
    const transition = input.state.transitions.find(
      (candidate) => candidate.from === "report" && candidate.on === "report_ready",
    );
    if (transition === undefined) {
      throw new Error("feature-delivery pipeline is missing report → ship transition.");
    }
    const applied = applyFeatureDeliveryTransition(
      input.state,
      transition,
      "report_ready",
      input.artifactRel,
      input.now,
    );
    input.state.automation = {
      ...(input.state.automation ?? { runnerInvocation: "sdk", cumulativeRetryCount: 0 }),
      reportApprovalPending: false,
    };
    return finishAdvanceAfterTransition({
      ...input,
      applied,
    });
  }

  if (decision.requiredChanges.trim().length === 0) {
    throw new Error("needs_changes report approval requires non-empty required_changes.");
  }
  const targetStage = decision.targetStage ?? "implement";
  assertFeatureDeliveryStage(targetStage);
  const fromStage = input.state.currentStage;
  input.state.currentStage = targetStage;
  input.state.status = "ready_for_stage_delegation";
  input.state.nextHumanAction = nextHumanActionForStage(
    input.state,
    targetStage,
    `Report approval needs_changes: ${decision.requiredChanges}`,
  );
  input.state.stages = repairStageStatuses(input.state.stages, targetStage);
  input.state.advanceHistory = [
    ...(input.state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(input.now),
      kind: "advance",
      from: fromStage,
      to: targetStage,
      event: "needs_changes",
      artifact: input.artifactRel,
    },
  ];
  const applied: AppliedFeatureDeliveryTransition = {
    fromStage,
    toStage: targetStage,
    event: "needs_changes",
    artifact: input.artifactRel,
  };
  input.state.automation = {
    ...(input.state.automation ?? { runnerInvocation: "sdk", cumulativeRetryCount: 0 }),
    reportApprovalPending: false,
  };
  return finishAdvanceAfterTransition({
    ...input,
    applied,
  });
}

async function finishAdvanceAfterTransition(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  applied: AppliedFeatureDeliveryTransition;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult> {
  delete input.state.nextCommand;
  const invocation = await readCursorInvocationForState(input.repoRoot, input.state);
  if (invocation === "sdk" && input.state.status !== "halted" && input.state.currentStage !== TERMINAL_STAGE) {
    const compiled = await compileFeatureDeliveryPipeline(input.repoRoot, input.pipeline);
    prepareStageInvocationIndexForSdkEntry(input.state, input.state.currentStage, invocation);
    await persistStateAndPrompts(input.repoRoot, input.state, input.pipeline, "advance");
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId: input.taskId,
      featureId: input.state.featureId,
      fromStage: input.applied.fromStage,
      toStage: input.applied.toStage,
      event: input.applied.event,
      persona: personaForStage(input.pipeline, input.state.currentStage) ?? undefined,
      now: input.now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot: input.repoRoot,
      state: input.state,
      pipeline: input.pipeline,
      stageId: input.state.currentStage,
      compiled,
      now: input.now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    resetStageInvocationIndex(input.state);
  }
  await persistStateAndPrompts(input.repoRoot, input.state, input.pipeline, "advance");
  await appendRunLogRecord(
    resolveRepoPath(input.repoRoot, input.state.artifacts.runLogFile),
    makeAdvanceRecord(
      input.state,
      input.now,
      input.applied.fromStage,
      input.applied.toStage,
      input.applied.event,
      input.applied.artifact,
    ),
  );
  return enrichFeatureDeliveryEnvelope(input.repoRoot, input.state, {
    command: "advance",
    status: "ok",
    taskId: input.taskId,
    featureId: input.state.featureId,
    fromStage: input.applied.fromStage,
    event: input.applied.event,
    currentStage: input.state.currentStage,
    artifact: input.applied.artifact,
    stateFile: input.stateFileRel,
    handoffFile: input.state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(input.state),
    nextPersona: personaForStage(input.pipeline, input.state.currentStage),
    nextHumanAction: input.state.nextHumanAction,
  }) as AdvanceFeatureDeliveryResult;
}

async function advanceReviewReentryFromImplement(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  reentry: ReviewReentryAdvancePlan;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult> {
  const { repoRoot, taskId, state, pipeline, stateFileRel, reentry, now } = input;
  delete state.nextCommand;
  const implementTransition = state.transitions.find(
    (candidate) => candidate.from === "implement" && candidate.on === "implementation_complete",
  );
  if (implementTransition === undefined) {
    throw new Error("feature-delivery pipeline is missing implement → review transition.");
  }
  assertStageArtifact(
    repoRoot,
    state,
    "implement",
    reentry.implementationReport,
    "implementation_complete",
  );

  const contentWarnings = collectStageContentWarnings(repoRoot, state, "implement");

  const first = applyFeatureDeliveryTransition(
    state,
    implementTransition,
    "implementation_complete",
    reentry.implementationReport,
    now,
  );
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      first.fromStage,
      first.toStage,
      first.event,
      first.artifact,
      { contentWarnings },
    ),
  );

  const reviewTransition = state.transitions.find(
    (candidate) => candidate.from === "review" && candidate.on === "review_passes",
  );
  if (reviewTransition === undefined) {
    throw new Error("feature-delivery pipeline is missing review → test transition.");
  }
  assertStageArtifact(repoRoot, state, "review", reentry.reviewArtifact, "review_passes");

  const second = applyFeatureDeliveryTransition(
    state,
    reviewTransition,
    "review_passes",
    reentry.reviewArtifact,
    now,
  );
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      second.fromStage,
      second.toStage,
      second.event,
      second.artifact,
      { contentWarnings },
    ),
  );

  const invocation = await readCursorInvocationForState(repoRoot, state);
  if (invocation === "sdk") {
    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    prepareStageInvocationIndexForSdkEntry(state, state.currentStage, invocation);
    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId,
      featureId: state.featureId,
      fromStage: second.fromStage,
      toStage: state.currentStage,
      event: second.event,
      persona: personaForStage(pipeline, state.currentStage) ?? undefined,
      now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: state.currentStage,
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    resetStageInvocationIndex(state);
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "advance");

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
    command: "advance",
    status: "ok",
    taskId,
    featureId: state.featureId,
    fromStage: first.fromStage,
    event: second.event,
    currentStage: state.currentStage,
    artifact: second.artifact,
    stateFile: stateFileRel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
    reviewReentry: true,
    contentWarnings,
    warningCount: contentWarnings.length,
  }) as AdvanceFeatureDeliveryResult;
}

function defaultEventForStage(stage: string): string {
  switch (stage) {
    case "intake":
    case "plan":
      return "human_approval";
    case "implement":
      return "implementation_complete";
    case "review":
      return "review_passes";
    case "test":
      return "qa_passes";
    case "report":
      return "report_ready";
    case "ship":
      return "human_ratifies_local_diff";
    case "index":
      return "artifacts_indexed";
    default:
      throw new Error(`No default advance event for stage ${stage}.`);
  }
}

function assertStageArtifact(
  repoRoot: string,
  state: FeatureDeliveryState,
  stage: string,
  artifact: string,
  event: string,
): void {
  try {
    assertAdvanceArtifacts(repoRoot, state, stage, artifact, event);
  } catch (error) {
    const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
    const lastAdvance = lastAdvanceEntry(state);
    const afterMustFix =
      stage === "implement" &&
      artifact === reviewArtifact &&
      lastAdvance?.event === "must_fix" &&
      lastAdvance.from === "review";
    if (
      afterMustFix &&
      error instanceof Error &&
      error.message.includes("is not valid for implement")
    ) {
      throw new Error(
        `${error.message} After must_fix re-entry, advance with review.md when it records review_passes: true to chain implement→review→test, or advance with ${path.posix.join(state.artifacts.runDir, "implementation-report.md")} first.`,
      );
    }
    throw error;
  }
}

function applyStageStatuses(
  stages: FeatureDeliveryStageState[],
  fromStage: string,
  toStage: string,
  event: string,
): FeatureDeliveryStageState[] {
  if (event === "must_fix") {
    return stages.map((stage) => {
      if (stage.id === "review") return { ...stage, status: "blocked" };
      if (stage.id === "implement") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "qa_fails") {
    return stages.map((stage) => {
      if (stage.id === "test") return { ...stage, status: "blocked" };
      if (stage.id === "implement") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "qa_fails_plan_invalidating") {
    const planIndex = FEATURE_DELIVERY_STAGES.indexOf("plan");
    return stages.map((stage) => {
      const index = FEATURE_DELIVERY_STAGES.indexOf(stage.id as FeatureDeliveryStageId);
      if (index < 0) return stage;
      if (stage.id === "test") return { ...stage, status: "blocked" };
      if (index < planIndex) return { ...stage, status: "complete" };
      if (stage.id === "plan") return { ...stage, status: "ready" };
      return { ...stage, status: "pending" };
    });
  }
  return stages.map((stage) => {
    if (stage.id === fromStage) return { ...stage, status: "complete" };
    if (stage.id === toStage) return { ...stage, status: "ready" };
    return stage;
  });
}

function repairStageStatuses(
  stages: FeatureDeliveryStageState[],
  targetStage: FeatureDeliveryStageId,
): FeatureDeliveryStageState[] {
  const targetIndex = FEATURE_DELIVERY_STAGES.indexOf(targetStage);
  return stages.map((stage) => {
    const index = FEATURE_DELIVERY_STAGES.indexOf(stage.id as FeatureDeliveryStageId);
    if (index < 0) return stage;
    if (index < targetIndex) return { ...stage, status: "complete" };
    if (index === targetIndex) return { ...stage, status: "ready" };
    return { ...stage, status: "pending" };
  });
}

function nextHumanActionForStage(
  state: FeatureDeliveryState,
  stage: string,
  extra?: string,
): string {
  const prefix = extra === undefined ? "" : `${extra} `;
  switch (stage) {
    case "intake":
      return `${prefix}Delegate next-prompt.md to intake-analyst; ratify the emitted spec before advancing.`;
    case "plan":
      return `${prefix}Delegate next-prompt.md to tech-lead; ratify plan.md, touch-set.json, and handoff.md before advancing.`;
    case "implement":
      return `${prefix}Delegate next-prompt.md to coder; monitor drift and require ${state.artifacts.runDir}/implementation-report.md before review.`;
    case "review":
      return `${prefix}Delegate next-prompt.md to reviewer; inspect ${state.artifacts.runDir}/review.md and choose pass or must-fix.`;
    case "test":
      return `${prefix}Delegate next-prompt.md to qa-tester; inspect ${state.artifacts.runDir}/test-report.md and choose pass or qa-fail.`;
    case "report":
      return `${prefix}Delegate next-prompt.md to tech-writer; ratify delivery-report.md before ship.`;
    case "ship":
      return `${prefix}Delegate next-prompt.md to supervisor; human must ratify the local diff before index.`;
    case "index":
      return `${prefix}Delegate next-prompt.md to librarian; verify feature index artifacts before complete. The generated complete-stage prompt delegates artifact closure to librarian.`;
    case "complete":
      return state.status === "closed"
        ? `${prefix}Artifact closure complete; no further feature-delivery action is required.`
        : `${prefix}Delegate next-prompt.md to librarian for final artifact closure with pan close-artifacts.`;
    default:
      return `${prefix}No human action defined for ${stage}.`;
  }
}

function personaForStage(pipeline: PipelineDefinition, stage: string): string | null {
  if (stage === TERMINAL_STAGE) return "librarian";
  return pipeline.stages.find((candidate) => candidate.id === stage)?.persona ?? null;
}

function assertFeatureDeliveryStage(value: string): FeatureDeliveryStageId {
  const stage = value as FeatureDeliveryStageId;
  if (!FEATURE_DELIVERY_STAGES.includes(stage)) {
    throw new Error(`stage MUST be one of: ${FEATURE_DELIVERY_STAGES.join(", ")}.`);
  }
  return stage;
}

async function assertRepoRelativeExistingFile(
  repoRoot: string,
  value: string,
  label: string,
): Promise<{ abs: string; rel: string }> {
  const rel = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (rel === "" || rel.includes("\0") || rel.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error(`${label} MUST be a safe repo-relative path.`);
  }
  const abs = resolveRepoPath(repoRoot, rel);
  const relativeBack = path.relative(repoRoot, abs);
  if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
    throw new Error(`${label} MUST stay inside the repository.`);
  }
  const info = await stat(abs);
  if (!info.isFile()) {
    throw new Error(`${label} MUST point to a file: ${rel}.`);
  }
  return { abs, rel };
}

async function removeEmptyDirectoryIfPresent(abs: string, rel: string): Promise<void> {
  try {
    await rmdir(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTEMPTY" || err.code === "EEXIST") {
      return;
    }
    if (err.code === "ENOTDIR") {
      throw new Error(`Expected directory while cleaning closure residue: ${rel}.`);
    }
    throw error;
  }
}

async function assertExistingFile(abs: string, rel: string): Promise<void> {
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      throw new Error(`Expected file but found non-file path: ${rel}.`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new Error(`Required file is missing: ${rel}.`);
    }
    throw error;
  }
}

async function assertExistingDirectory(abs: string, rel: string): Promise<void> {
  try {
    const info = await stat(abs);
    if (!info.isDirectory()) {
      throw new Error(`Expected directory but found non-directory path: ${rel}.`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new Error(`Required directory is missing: ${rel}.`);
    }
    throw error;
  }
}

async function assertPathMissing(abs: string, rel: string): Promise<void> {
  try {
    await stat(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return;
    }
    throw error;
  }
  throw new Error(`Closure target already exists: ${rel}.`);
}

function requireNextPromptFile(state: FeatureDeliveryState): string {
  const nextPromptFile = state.artifacts.nextPromptFile ?? path.posix.join(state.artifacts.runDir, "next-prompt.md");
  state.artifacts.nextPromptFile = nextPromptFile;
  return nextPromptFile;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export interface PanDoctorCheck {
  id: string;
  label: string;
  command: string;
  status: "pass" | "fail" | "skip";
  exitCode?: number;
  remediation?: string;
}

export interface PanDoctorResult {
  command: "doctor";
  status: "ok" | "fail";
  passCount: number;
  failCount: number;
  skipCount: number;
  checks: PanDoctorCheck[];
}

export const PAN_DOCTOR_REPO_CHECK_IDS = [
  "active-fd-artifacts",
  "shipped-ledger-cap",
  "cursorindexingignore",
] as const;

export function panDoctorCheckRegistry(): readonly string[] {
  return [...PAN_DOCTOR_SHELL_CHECKS.map((spec) => spec.id), ...PAN_DOCTOR_REPO_CHECK_IDS];
}

const PAN_DOCTOR_SHELL_CHECKS: ReadonlyArray<{ id: string; label: string; command: string }> = [
  { id: "build", label: "pnpm run build", command: "pnpm run build" },
  { id: "lint", label: "pnpm lint", command: "pnpm lint" },
  { id: "lint-deps", label: "pnpm run lint:deps", command: "pnpm run lint:deps" },
  { id: "typecheck", label: "pnpm typecheck", command: "pnpm typecheck" },
  { id: "attw", label: "pnpm run attw", command: "pnpm run attw" },
  { id: "publint", label: "pnpm run publint", command: "pnpm run publint" },
  { id: "test", label: "pnpm test", command: "pnpm test" },
  { id: "tests-mjs", label: "node --test tests/*.test.mjs", command: "node --test tests/*.test.mjs" },
  {
    id: "compliance",
    label: "node lib/internal/tools/run-compliance.mjs",
    command: "node lib/internal/tools/run-compliance.mjs",
  },
  {
    id: "phase-0a-scaffold",
    label: "node lib/internal/tools/check-phase-0a-scaffold.mjs",
    command: "node lib/internal/tools/check-phase-0a-scaffold.mjs",
  },
  {
    id: "context-budget-report",
    label: "node lib/internal/tools/context-budget-report.mjs",
    command: "node lib/internal/tools/context-budget-report.mjs",
  },
  {
    id: "policy-compliance-hook",
    label: "bash -n .cursor/hooks/enforce-policy-compliance.sh",
    command: "bash -n .cursor/hooks/enforce-policy-compliance.sh",
  },
  {
    id: "operator-output",
    label: "node lib/internal/tools/check-operator-output.mjs",
    command: "node lib/internal/tools/check-operator-output.mjs",
  },
];

function runShellDoctorCheck(
  repoRoot: string,
  spec: { id: string; label: string; command: string },
): PanDoctorCheck {
  const result = spawnSync(spec.command, {
    cwd: repoRoot,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = result.status ?? 1;
  if (exitCode === 0) {
    return { id: spec.id, label: spec.label, command: spec.command, status: "pass", exitCode: 0 };
  }
  return {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    status: "fail",
    exitCode,
    remediation: `cd ${repoRoot} && ${spec.command}`,
  };
}

function countShippedLedgerDataRows(currentMd: string): number {
  const header = "## Most recent shipped Features\n";
  const idx = currentMd.indexOf(header);
  if (idx === -1) {
    return 0;
  }
  const tail = currentMd.slice(idx + header.length);
  const relNext = tail.search(/\n## /u);
  const inner = relNext === -1 ? tail : tail.slice(0, relNext);
  return inner
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("|") &&
        !line.includes("---") &&
        !/^\|\s*Feature\s*\|/u.test(line) &&
        !/^\|\s*`—`\s*\|/u.test(line),
    ).length;
}

async function listActiveFeatureDeliveryStates(
  repoRoot: string,
): Promise<Array<{ taskId: string; stage: string; state: FeatureDeliveryState }>> {
  const workRoot = resolveProjectPath(repoRoot, "work");
  const active: Array<{ taskId: string; stage: string; state: FeatureDeliveryState }> = [];
  const dayDirs = await safeReaddir(workRoot);
  for (const dayDir of dayDirs) {
    const dayAbs = path.join(workRoot, dayDir);
    const taskDirs = await safeReaddir(dayAbs);
    for (const taskId of taskDirs) {
      const stateAbs = path.join(dayAbs, taskId, "state.json");
      if (!existsSync(stateAbs)) {
        continue;
      }
      const state = await readFeatureDeliveryState(stateAbs);
      if (state.pipelineId !== "feature-delivery") {
        continue;
      }
      if (state.status === "closed" || state.currentStage === TERMINAL_STAGE) {
        continue;
      }
      active.push({ taskId, stage: state.currentStage, state });
    }
  }
  return active;
}

export async function runPanDoctor(repoRootInput: string): Promise<PanDoctorResult> {
  const repoRoot = path.resolve(repoRootInput);
  const checks: PanDoctorCheck[] = PAN_DOCTOR_SHELL_CHECKS.map((spec) => runShellDoctorCheck(repoRoot, spec));

  const activeRuns = await listActiveFeatureDeliveryStates(repoRoot);
  if (activeRuns.length === 0) {
    checks.push({
      id: "active-fd-artifacts",
      label: "Active feature-delivery artifact content validation",
      command: "(no active runs)",
      status: "skip",
      remediation: "No active feature-delivery state under work/",
    });
  } else {
    const artifactIssues: string[] = [];
    for (const run of activeRuns) {
      const validation = validateStageCompletionArtifacts(repoRoot, run.state, run.stage);
      for (const missing of validation.missing) {
        artifactIssues.push(`${run.taskId}/${run.stage}: missing required artifact ${missing}`);
      }
      if (validation.warningCount > 0) {
        for (const warning of validation.warnings) {
          artifactIssues.push(`${run.taskId}/${run.stage}: ${warning.path} — ${warning.message}`);
        }
      }
    }
    if (artifactIssues.length === 0) {
      checks.push({
        id: "active-fd-artifacts",
        label: "Active feature-delivery artifact content validation",
        command: "pan artifacts validate (read-only aggregate)",
        status: "pass",
        exitCode: 0,
      });
    } else {
      checks.push({
        id: "active-fd-artifacts",
        label: "Active feature-delivery artifact content validation",
        command: "pan artifacts validate <taskId> --stage <stage>",
        status: "fail",
        exitCode: 1,
        remediation: artifactIssues.join("; "),
      });
    }
  }

  const currentPath = resolveProjectPath(repoRoot, "lib", "memory", "active", "current.md");
  if (!existsSync(currentPath)) {
    checks.push({
      id: "shipped-ledger-cap",
      label: "Shipped-ledger row cap on lib/memory/active/current.md",
      command: currentPath,
      status: "fail",
      exitCode: 1,
      remediation: `Restore ${currentPath} or run pnpm -w exec pan refresh-active-memory`,
    });
  } else {
    const currentMd = await readFile(currentPath, "utf8");
    const rowCount = countShippedLedgerDataRows(currentMd);
    if (rowCount > SHIPPED_LEDGER_ROW_CAP) {
      checks.push({
        id: "shipped-ledger-cap",
        label: "Shipped-ledger row cap on lib/memory/active/current.md",
        command: `count=${rowCount} cap=${SHIPPED_LEDGER_ROW_CAP}`,
        status: "fail",
        exitCode: 1,
        remediation: `pnpm -w exec pan refresh-active-memory --dry-run (cap is ${SHIPPED_LEDGER_ROW_CAP} data rows)`,
      });
    } else {
      checks.push({
        id: "shipped-ledger-cap",
        label: "Shipped-ledger row cap on lib/memory/active/current.md",
        command: `rows=${rowCount} cap=${SHIPPED_LEDGER_ROW_CAP}`,
        status: "pass",
        exitCode: 0,
      });
    }
  }

  const ignorePath = path.join(repoRoot, ".cursorindexingignore");
  if (!existsSync(ignorePath)) {
    checks.push({
      id: "cursorindexingignore",
      label: ".cursorindexingignore availability",
      command: ignorePath,
      status: "fail",
      exitCode: 1,
      remediation: `Restore ${ignorePath} at the repository root`,
    });
  } else {
    checks.push({
      id: "cursorindexingignore",
      label: ".cursorindexingignore availability",
      command: ignorePath,
      status: "pass",
      exitCode: 0,
    });
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const skipCount = checks.filter((c) => c.status === "skip").length;
  return {
    command: "doctor",
    status: failCount === 0 ? "ok" : "fail",
    passCount,
    failCount,
    skipCount,
    checks,
  };
}
