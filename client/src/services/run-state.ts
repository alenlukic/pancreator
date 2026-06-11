import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findRepoRoot, resolveRepoPath } from "./repo-paths";
import {
  FEATURE_DELIVERY_STAGE_ORDER,
  type RunLogEvent,
  type StageCell,
  type StageCellStatus,
  type TaskRunStateEnvelope,
} from "./run-state-shared";
import { decodeCountdownTimestamp, parseRunDirParts } from "./timestamp-decode";

export {
  FEATURE_DELIVERY_STAGE_ORDER,
  activeStageElapsedMs,
  collectHumanGateQueue,
  countStageRetryTransitions,
  deriveRunDirFromTaskId,
  detectRetryLimitFailure,
  findActiveStage,
  formatElapsedDuration,
  isRetryTransitionEvent,
  missionControlHref,
  newestStageTelemetryChip,
  taskDisplayLabel,
  taskLevelNextCommand,
  type HumanGateQueueEntry,
  type RetryLimitFailureSummary,
  type RunLogEvent,
  type StageCell,
  type StageCellStatus,
  type StageTelemetryChip,
  type TaskRunStateEnvelope,
} from "./run-state-shared";

const execFileAsync = promisify(execFile);

type PersistedStage = {
  id: string;
  persona: string;
  label?: string;
  status: string;
  humanGate?: string;
  humanAttention?: string;
};

type PersistedState = {
  taskId: string;
  pipelineId?: string;
  featureId?: string;
  status: string;
  currentStage: string;
  nextHumanAction: string;
  source?: {
    inboxEntry?: string;
    inboxPath?: string;
  };
  artifacts: {
    runDir: string;
    runLogFile: string;
  };
  stages: PersistedStage[];
};

type PanStatusEnvelope = {
  taskId: string;
  currentStage: string;
  nextHumanAction?: string;
  nextCommand?: string | null;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
};

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

const TERMINAL_PIPELINE_STATUSES = new Set(["complete", "closed"]);

function isNonTerminalStatus(status: string): boolean {
  return !TERMINAL_PIPELINE_STATUSES.has(status);
}

function resolveEffectiveCurrentStage(
  state: PersistedState,
  statusEnvelope: PanStatusEnvelope | null,
): string {
  const fromPan = statusEnvelope?.currentStage?.trim();
  if (fromPan !== undefined && fromPan.length > 0) {
    return fromPan;
  }
  return state.currentStage;
}

function mapStageStatus(
  stage: PersistedStage,
  effectiveCurrentStage: string,
): StageCellStatus {
  if (stage.status === "blocked") {
    return "failed";
  }
  if (stage.id === effectiveCurrentStage) {
    return "active";
  }
  if (stage.status === "complete") {
    return "complete";
  }
  return "pending";
}

function stageActionFields(
  cellStatus: StageCellStatus,
  stage: PersistedStage,
  state: PersistedState,
  statusEnvelope: PanStatusEnvelope | null,
): { nextHumanAction: string; nextCommand: string; humanAttention: string } {
  if (cellStatus === "pending") {
    return { nextHumanAction: "", nextCommand: "", humanAttention: "" };
  }
  if (cellStatus === "active") {
    return {
      nextHumanAction: statusEnvelope?.nextHumanAction ?? state.nextHumanAction,
      nextCommand: String(statusEnvelope?.nextCommand ?? ""),
      humanAttention: stage.humanAttention ?? "",
    };
  }
  return {
    nextHumanAction: "",
    nextCommand: "",
    humanAttention: stage.humanAttention ?? "",
  };
}

export function synthesizeStageCells(
  state: PersistedState,
  statusEnvelope: PanStatusEnvelope | null,
): StageCell[] {
  const effectiveCurrentStage = resolveEffectiveCurrentStage(state, statusEnvelope);
  const stageById = new Map(state.stages.map((stage) => [stage.id, stage]));
  const cells: StageCell[] = [];

  for (const stageId of FEATURE_DELIVERY_STAGE_ORDER) {
    if (stageId === "complete") {
      const isComplete = effectiveCurrentStage === "complete";
      const cellStatus: StageCellStatus = isComplete ? "complete" : "pending";
      cells.push({
        name: "complete",
        ownerPersona: "librarian",
        humanGate: "",
        nextHumanAction: isComplete
          ? (statusEnvelope?.nextHumanAction ?? state.nextHumanAction)
          : "",
        nextCommand: isComplete ? String(statusEnvelope?.nextCommand ?? "") : "",
        humanAttention: "",
        status: cellStatus,
      });
      continue;
    }

    const stage = stageById.get(stageId);
    if (stage === undefined) {
      cells.push({
        name: stageId,
        ownerPersona: "",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      });
      continue;
    }

    const cellStatus = mapStageStatus(stage, effectiveCurrentStage);
    const actionFields = stageActionFields(cellStatus, stage, state, statusEnvelope);

    cells.push({
      name: stage.id,
      ownerPersona: stage.persona,
      humanGate: stage.humanGate ?? "",
      nextHumanAction: actionFields.nextHumanAction,
      nextCommand: actionFields.nextCommand,
      humanAttention: actionFields.humanAttention,
      status: cellStatus,
    });
  }

  return cells;
}

function runLogRecordToEvent(record: Record<string, unknown>): RunLogEvent | null {
  const timestamp =
    typeof record.ts === "string"
      ? record.ts
      : typeof record.timestamp === "string"
        ? record.timestamp
        : null;
  if (timestamp === null) {
    return null;
  }

  const rawName = typeof record.name === "string" ? record.name : undefined;
  const pancreator = record.pancreator as Record<string, unknown> | undefined;
  const attributes = record.attributes as Record<string, unknown> | undefined;
  const status = record.status as { code?: string; message?: string } | undefined;

  const event =
    rawName ??
    (typeof pancreator?.stage_id === "string" ? pancreator.stage_id : "event");

  const outcome =
    typeof pancreator?.outcome === "string"
      ? pancreator.outcome
      : typeof status?.code === "string"
        ? status.code
        : "logged";

  const persona =
    typeof pancreator?.persona === "string" ? pancreator.persona : undefined;
  const message = persona === undefined ? `${event}: ${outcome}` : `${persona} · ${event}: ${outcome}`;

  const stageId =
    typeof pancreator?.stage_id === "string"
      ? pancreator.stage_id
      : typeof attributes?.["pancreator.from_stage"] === "string"
        ? attributes["pancreator.from_stage"]
        : undefined;

  let escalationLabel: string | undefined;
  if (rawName === "cursor.runner.escalation") {
    escalationLabel =
      typeof attributes?.escalation === "string" ? attributes.escalation : "Escalation";
  }

  let retryBadge = false;
  if (rawName === "pancreator.pipeline.advance") {
    const transitionEvent =
      typeof attributes?.["pancreator.transition_event"] === "string"
        ? attributes["pancreator.transition_event"]
        : "";
    retryBadge =
      transitionEvent === "must_fix" ||
      transitionEvent === "qa_fails" ||
      transitionEvent === "qa_fails_plan_invalidating" ||
      transitionEvent === "compliance_fails" ||
      transitionEvent === "compliance_fails_plan_invalidating";
  }

  let deferralBadge = false;
  const statusMessage = status?.message ?? "";
  if (
    statusMessage.toLowerCase().includes("deferred") ||
    typeof attributes?.["pancreator.deferral_code"] === "string" ||
    typeof attributes?.deferral_code === "string"
  ) {
    deferralBadge = true;
  }

  return {
    timestamp,
    event,
    message,
    ...(rawName !== undefined ? { name: rawName } : {}),
    ...(stageId !== undefined ? { stageId } : {}),
    ...(escalationLabel !== undefined ? { escalationLabel } : {}),
    ...(retryBadge ? { retryBadge: true } : {}),
    ...(deferralBadge ? { deferralBadge: true } : {}),
  };
}

export async function parseRunLogFile(runLogAbs: string): Promise<RunLogEvent[]> {
  if (!fs.existsSync(runLogAbs)) {
    return [];
  }

  const raw = await fsp.readFile(runLogAbs, "utf8");
  const events: RunLogEvent[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const event = runLogRecordToEvent(record);
      if (event !== null) {
        events.push(event);
      }
    } catch {
      // skip malformed lines
    }
  }

  return events.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

async function invokePanStatus(
  repoRoot: string,
  taskId: string,
): Promise<{ envelope: PanStatusEnvelope | null; warning?: string }> {
  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["-w", "exec", "pan", "status", taskId, "--format", "json"],
      { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 },
    );
    const envelope = JSON.parse(stdout.trim()) as PanStatusEnvelope;
    return { envelope };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      envelope: null,
      warning: `pan status unavailable for ${taskId}: ${message}`,
    };
  }
}

async function readPersistedState(stateAbs: string): Promise<PersistedState> {
  const raw = await fsp.readFile(stateAbs, "utf8");
  return JSON.parse(raw) as PersistedState;
}

async function discoverActiveStateFiles(repoRoot: string): Promise<string[]> {
  const workRoot = path.join(repoRoot, ".pan/work");
  if (!fs.existsSync(workRoot)) {
    return [];
  }

  const matches: string[] = [];
  const dayBuckets = await fsp.readdir(workRoot, { withFileTypes: true });

  for (const dayEntry of dayBuckets) {
    if (!dayEntry.isDirectory()) {
      continue;
    }
    const dayPath = path.join(workRoot, dayEntry.name);
    const taskDirs = await fsp.readdir(dayPath, { withFileTypes: true });
    for (const taskEntry of taskDirs) {
      if (!taskEntry.isDirectory()) {
        continue;
      }
      const stateFile = path.join(dayPath, taskEntry.name, "state.json");
      if (!fs.existsSync(stateFile)) {
        continue;
      }
      try {
        const state = await readPersistedState(stateFile);
        if (state.pipelineId !== undefined && state.pipelineId !== "feature-delivery") {
          continue;
        }
        if (isNonTerminalStatus(state.status)) {
          matches.push(stateFile);
        }
      } catch {
        // skip unreadable state files
      }
    }
  }

  return matches;
}

async function buildTaskEnvelope(
  repoRoot: string,
  stateAbs: string,
): Promise<TaskRunStateEnvelope> {
  const state = await readPersistedState(stateAbs);
  const panResult = await invokePanStatus(repoRoot, state.taskId);
  const stages = synthesizeStageCells(state, panResult.envelope);

  const runLogRel = state.artifacts.runLogFile;
  const runLogAbs = resolveRepoPath(runLogRel, repoRoot);
  let runEvents = await parseRunLogFile(runLogAbs);

  if (runEvents.length === 0) {
    runEvents = [
      {
        timestamp: new Date(0).toISOString(),
        event: "empty",
        message: `No run.log.jsonl entries for ${state.taskId}`,
      },
    ];
  }

  const localDecoded = decodedTimestampFields(state.artifacts.runDir, state.taskId);

  return {
    taskId: state.taskId,
    ...(state.featureId !== undefined ? { featureId: state.featureId } : {}),
    decodedTimestamp: panResult.envelope?.decodedTimestamp ?? localDecoded.decodedTimestamp,
    decodedTimestampDiagnostic:
      panResult.envelope?.decodedTimestampDiagnostic ?? localDecoded.decodedTimestampDiagnostic,
    runDir: state.artifacts.runDir,
    ...(state.source?.inboxPath !== undefined ? { inboxSource: state.source.inboxPath } : {}),
    stages,
    runEvents,
    ...(panResult.warning !== undefined ? { sourceWarning: panResult.warning } : {}),
  };
}

export async function getActiveRunState(
  repoRoot: string = findRepoRoot(),
): Promise<TaskRunStateEnvelope[]> {
  const stateFiles = await discoverActiveStateFiles(repoRoot);
  const envelopes: TaskRunStateEnvelope[] = [];

  for (const stateFile of stateFiles) {
    envelopes.push(await buildTaskEnvelope(repoRoot, stateFile));
  }

  return envelopes.sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export type ShippedOutcome = {
  featureId: string;
  title: string;
  taskId: string;
  indexedAt: string;
};

type FeatureIndexRecord = {
  feature_id?: string;
  title?: string;
  task_id?: string;
  status?: string;
  indexed_at?: string;
  index?: { completed_at?: string };
};

export async function loadArchivedTaskIds(repoRoot: string = findRepoRoot()): Promise<Set<string>> {
  const archiveRoot = path.join(repoRoot, ".pan", "archive", "work");
  const archived = new Set<string>();
  if (!fs.existsSync(archiveRoot)) {
    return archived;
  }

  const dayBuckets = await fsp.readdir(archiveRoot, { withFileTypes: true });
  for (const dayEntry of dayBuckets) {
    if (!dayEntry.isDirectory()) {
      continue;
    }
    const taskDirs = await fsp.readdir(path.join(archiveRoot, dayEntry.name), { withFileTypes: true });
    for (const taskEntry of taskDirs) {
      if (taskEntry.isDirectory()) {
        archived.add(taskEntry.name);
      }
    }
  }
  return archived;
}

export async function loadShippedOutcomes(
  repoRoot: string = findRepoRoot(),
  limit = 5,
): Promise<ShippedOutcome[]> {
  const featuresRoot = path.join(repoRoot, "lib", "memory", "features");
  if (!fs.existsSync(featuresRoot)) {
    return [];
  }

  const outcomes: ShippedOutcome[] = [];
  const featureDirs = await fsp.readdir(featuresRoot, { withFileTypes: true });

  for (const featureDir of featureDirs) {
    if (!featureDir.isDirectory()) {
      continue;
    }
    const indexPath = path.join(featuresRoot, featureDir.name, "index.json");
    if (!fs.existsSync(indexPath)) {
      continue;
    }
    try {
      const raw = await fsp.readFile(indexPath, "utf8");
      const record = JSON.parse(raw) as FeatureIndexRecord;
      if (record.status !== "indexed" || record.task_id === undefined) {
        continue;
      }
      outcomes.push({
        featureId: record.feature_id ?? featureDir.name,
        title: record.title ?? featureDir.name,
        taskId: record.task_id,
        indexedAt: record.indexed_at ?? record.index?.completed_at ?? new Date(0).toISOString(),
      });
    } catch {
      // skip unreadable indexes
    }
  }

  return outcomes
    .sort((left, right) => Date.parse(right.indexedAt) - Date.parse(left.indexedAt))
    .slice(0, limit);
}

export function excludeReconciledAttentionTasks(
  tasks: TaskRunStateEnvelope[],
  archivedTaskIds: Set<string>,
  shippedTaskIds: Set<string>,
): TaskRunStateEnvelope[] {
  return tasks.filter((task) => {
    if (archivedTaskIds.has(task.taskId)) {
      return false;
    }
    if (shippedTaskIds.has(task.taskId)) {
      return false;
    }
    const completeStage = task.stages.find((stage) => stage.name === "complete");
    if (completeStage?.status === "complete") {
      return false;
    }
    return true;
  });
}
