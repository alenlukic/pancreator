export const FEATURE_DELIVERY_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
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
  humanAttention: string;
  status: StageCellStatus;
};

export type RunLogEvent = {
  timestamp: string;
  event: string;
  message: string;
  name?: string;
  stageId?: string;
  escalationLabel?: string;
  retryBadge?: boolean;
  deferralBadge?: boolean;
};

export type StageTelemetryChip = {
  kind: "escalation" | "retry" | "deferral";
  label: string;
};

export type TaskRunStateEnvelope = {
  taskId: string;
  featureId?: string;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
  runDir: string;
  inboxSource?: string;
  stages: StageCell[];
  runEvents: RunLogEvent[];
  sourceWarning?: string;
};

export function taskDisplayLabel(
  task: Pick<TaskRunStateEnvelope, "taskId" | "decodedTimestamp" | "decodedTimestampDiagnostic">,
): string {
  const suffix = task.decodedTimestamp ?? task.decodedTimestampDiagnostic;
  return suffix ? `${task.taskId} (${suffix})` : task.taskId;
}

export type HumanGateQueueEntry = {
  taskId: string;
  runDir: string;
  inboxSource?: string;
  stageName: string;
  ownerPersona: string;
  humanGate: string;
  status: StageCellStatus;
  humanAttention: string;
  nextHumanAction: string;
};

export function deriveRunDirFromTaskId(
  taskId: string,
  envelopes: Pick<TaskRunStateEnvelope, "taskId" | "runDir">[],
): string | null {
  const match = envelopes.find((entry) => entry.taskId === taskId);
  return match?.runDir ?? null;
}

export function collectHumanGateQueue(tasks: TaskRunStateEnvelope[]): HumanGateQueueEntry[] {
  const entries: HumanGateQueueEntry[] = [];

  for (const task of tasks) {
    for (const stage of task.stages) {
      if (stage.humanGate !== "human_approval") {
        continue;
      }
      if (stage.status !== "active") {
        continue;
      }
      entries.push({
        taskId: task.taskId,
        runDir: task.runDir,
        inboxSource: task.inboxSource,
        stageName: stage.name,
        ownerPersona: stage.ownerPersona,
        humanGate: stage.humanGate,
        status: stage.status,
        humanAttention: stage.humanAttention,
        nextHumanAction: stage.nextHumanAction,
      });
    }
  }

  return entries.sort((left, right) => {
    const byTask = left.taskId.localeCompare(right.taskId);
    if (byTask !== 0) {
      return byTask;
    }
    return left.stageName.localeCompare(right.stageName);
  });
}

export function findActiveStage(task: TaskRunStateEnvelope): StageCell | undefined {
  return task.stages.find((stage) => stage.status === "active");
}

export function taskLevelNextCommand(task: TaskRunStateEnvelope): string {
  const activeStage = findActiveStage(task);
  return activeStage?.nextCommand ?? "";
}

const RETRY_TRANSITION_EVENTS = new Set([
  "must_fix",
  "qa_fails",
  "qa_fails_plan_invalidating",
  "compliance_fails",
  "compliance_fails_plan_invalidating",
]);

export function formatElapsedDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function activeStageElapsedMs(
  runEvents: RunLogEvent[],
  stageName: string,
  nowMs: number = Date.now(),
): number | null {
  const matching = runEvents.filter((event) => event.stageId === stageName);
  if (matching.length === 0) {
    return null;
  }
  const newest = matching.reduce((latest, event) =>
    Date.parse(event.timestamp) > Date.parse(latest.timestamp) ? event : latest,
  );
  const startedAt = Date.parse(newest.timestamp);
  if (Number.isNaN(startedAt)) {
    return null;
  }
  return Math.max(0, nowMs - startedAt);
}

export function newestStageTelemetryChip(
  runEvents: RunLogEvent[],
  stageName: string,
): StageTelemetryChip | null {
  const matching = runEvents.filter((event) => event.stageId === stageName);
  let newest: { at: number; chip: StageTelemetryChip } | null = null;

  for (const event of matching) {
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) {
      continue;
    }
    if (event.escalationLabel !== undefined) {
      const chip: StageTelemetryChip = {
        kind: "escalation",
        label: event.escalationLabel || "Escalation",
      };
      if (newest === null || at > newest.at) {
        newest = { at, chip };
      }
      continue;
    }
    if (event.retryBadge) {
      const chip: StageTelemetryChip = { kind: "retry", label: "Retry" };
      if (newest === null || at > newest.at) {
        newest = { at, chip };
      }
      continue;
    }
    if (event.deferralBadge) {
      const chip: StageTelemetryChip = { kind: "deferral", label: "Deferral" };
      if (newest === null || at > newest.at) {
        newest = { at, chip };
      }
    }
  }

  return newest?.chip ?? null;
}

export function isRetryTransitionEvent(event: string): boolean {
  return RETRY_TRANSITION_EVENTS.has(event);
}

export function isNonTerminalTask(task: TaskRunStateEnvelope): boolean {
  const completeStage = task.stages.find((stage) => stage.name === "complete");
  return completeStage?.status !== "complete";
}

export function filterNonTerminalTasks(tasks: TaskRunStateEnvelope[]): TaskRunStateEnvelope[] {
  return tasks.filter(isNonTerminalTask);
}

export function hasActiveHumanApprovalGate(task: TaskRunStateEnvelope): boolean {
  return task.stages.some(
    (stage) => stage.humanGate === "human_approval" && stage.status === "active",
  );
}

export function newestRunEventTimestamp(task: TaskRunStateEnvelope): string | null {
  if (task.runEvents.length === 0) {
    return null;
  }
  return task.runEvents.reduce((newest, event) =>
    Date.parse(event.timestamp) > Date.parse(newest.timestamp) ? event : newest,
  ).timestamp;
}

export function newestRunEventMs(task: TaskRunStateEnvelope): number {
  const timestamp = newestRunEventTimestamp(task);
  if (timestamp === null) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export type MultiRunSortMode = "last-event" | "human-gate";

export function sortTasksForMultiRunTable(
  tasks: TaskRunStateEnvelope[],
  sortMode: MultiRunSortMode,
): TaskRunStateEnvelope[] {
  const sorted = [...tasks];
  sorted.sort((left, right) => {
    if (sortMode === "human-gate") {
      const leftGate = hasActiveHumanApprovalGate(left) ? 1 : 0;
      const rightGate = hasActiveHumanApprovalGate(right) ? 1 : 0;
      if (leftGate !== rightGate) {
        return rightGate - leftGate;
      }
    }
    return newestRunEventMs(right) - newestRunEventMs(left);
  });
  return sorted;
}

export function formatLastEventTime(timestamp: string | null, nowMs: number = Date.now()): string {
  if (timestamp === null) {
    return "—";
  }
  const eventMs = Date.parse(timestamp);
  if (Number.isNaN(eventMs)) {
    return timestamp;
  }
  const elapsedMs = Math.max(0, nowMs - eventMs);
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    if (hours < 1) {
      const minutes = Math.floor(elapsedMs / (60 * 1000));
      return `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  return timestamp.slice(0, 10);
}

export type PanExecuteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  deferred?: boolean;
  deferralMessage?: string;
};

const PAN_CLI_PREFIX = "pnpm -w exec pan ";

export function normalizePanCommand(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  if (trimmed.startsWith(PAN_CLI_PREFIX)) {
    return trimmed.slice(PAN_CLI_PREFIX.length).trim();
  }
  return trimmed;
}

export function panArgsFromNextCommand(nextCommand: string): string {
  return normalizePanCommand(nextCommand);
}

export type ActiveMemorySnapshot = {
  activeFeaturePath: string | null;
  blockersSummary: string;
  refreshTimestamp: string | null;
};

export type InboxEntrySnapshot = {
  path: string;
  title: string;
  slug: string;
  ageHours: number;
};

export function inboxRunCommand(repoRelativePath: string): string {
  const inboxRootPrefix = "lib/inbox/in/";
  const inboxRelative = repoRelativePath.startsWith(inboxRootPrefix)
    ? repoRelativePath.slice(inboxRootPrefix.length)
    : repoRelativePath;
  return `pnpm -w exec pan run feature-delivery ${inboxRelative}`;
}
