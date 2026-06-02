import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findRepoRoot, resolveRepoPath } from "./repo-paths";

const execFileAsync = promisify(execFile);

export const FEATURE_DELIVERY_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "ship",
  "index",
  "complete",
] as const;

export type StageCellStatus = "pending" | "active" | "complete" | "failed";

export type StageCell = {
  name: string;
  ownerPersona: string;
  humanGate: string;
  nextHumanAction: string;
  nextCommand: string;
  status: StageCellStatus;
};

export type RunLogEvent = {
  timestamp: string;
  event: string;
  message: string;
};

export type TaskRunStateEnvelope = {
  taskId: string;
  stages: StageCell[];
  runEvents: RunLogEvent[];
  sourceWarning?: string;
};

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
};

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
): { nextHumanAction: string; nextCommand: string } {
  if (cellStatus === "pending") {
    return { nextHumanAction: "", nextCommand: "" };
  }
  if (cellStatus === "active") {
    return {
      nextHumanAction: statusEnvelope?.nextHumanAction ?? state.nextHumanAction,
      nextCommand: String(statusEnvelope?.nextCommand ?? ""),
    };
  }
  return {
    nextHumanAction: stage.humanAttention ?? "",
    nextCommand: "",
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

  const pancreator = record.pancreator as Record<string, unknown> | undefined;
  const event =
    typeof record.name === "string"
      ? record.name
      : typeof pancreator?.stage_id === "string"
        ? pancreator.stage_id
        : "event";

  const outcome =
    typeof pancreator?.outcome === "string"
      ? pancreator.outcome
      : typeof (record.status as { code?: string } | undefined)?.code === "string"
        ? (record.status as { code: string }).code
        : "logged";

  const persona =
    typeof pancreator?.persona === "string" ? pancreator.persona : undefined;
  const message = persona === undefined ? `${event}: ${outcome}` : `${persona} · ${event}: ${outcome}`;

  return { timestamp, event, message };
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
  const workRoot = path.join(repoRoot, "work");
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

  return {
    taskId: state.taskId,
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
