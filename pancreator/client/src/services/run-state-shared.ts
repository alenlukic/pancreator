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
  pipelineStatus?: string;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
  runDir: string;
  inboxSource?: string;
  stages: StageCell[];
  runEvents: RunLogEvent[];
  sourceWarning?: string;
  workflowHealth?: WorkflowHealthSummary;
  workflowHealthLoadError?: string;
};

export type PointerResolutionStatus =
  | "Live"
  | "Archived"
  | "Missing"
  | "Needs reconciliation";

export type PointerResolution = {
  label: string;
  referencedPath: string;
  status: PointerResolutionStatus;
  resolvedPath?: string;
  action?: string;
  reason?: string;
};

export type WorkflowHealthFinding = {
  code: string;
  severity: "info" | "warning" | "blocking";
  summary: string;
  detail?: string;
  artifact?: string;
  pointer?: PointerResolution;
};

export type WorkflowHealthSummary = {
  task_id: string;
  feature_id: string;
  run_dir: string;
  status: "healthy" | "needs_attention" | "blocked" | "reconciled";
  repair_count: number;
  auto_chain_reversal_count: number;
  last_oversight_check_at?: string;
  companion_artifacts?: Array<{
    name: string;
    present: boolean;
    blockingReason?: string;
  }>;
  pointers?: PointerResolution[];
  gate_block_reasons?: string[];
  findings: WorkflowHealthFinding[];
  updated_at: string;
};

export function taskDisplayLabel(
  task: Pick<
    TaskRunStateEnvelope,
    "taskId" | "featureId" | "decodedTimestamp" | "decodedTimestampDiagnostic"
  >,
): string {
  return featureDisplayLabel(task);
}

const TERMINAL_PIPELINE_STATUSES = new Set([
  "complete",
  "closed",
  "canceled",
  "cancelled",
  "shipped",
  "superseded",
  "archived",
]);

export function isTerminalPipelineStatus(status: string): boolean {
  return TERMINAL_PIPELINE_STATUSES.has(status);
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

export function countStageRetryTransitions(runEvents: RunLogEvent[], stageName: string): number {
  let count = 0;
  for (const event of runEvents) {
    if (event.stageId !== stageName) {
      continue;
    }
    const eventName = event.name ?? event.event;
    if (event.retryBadge || isRetryTransitionEvent(eventName)) {
      count += 1;
    }
  }
  return count;
}

export type RetryLimitFailureSummary = {
  failingStage: string;
  retryCount: number;
  loopHistoryText: string;
};

function parseRetryLimitFields(
  message: string,
  stageId?: string,
): { failingStage: string; retryCount: number } | null {
  const stageMatch =
    message.match(/failing[_ ]stage[:\s]+([a-z_]+)/i) ??
    message.match(/stage[:\s]+([a-z_]+)\s+exceeded/i);
  const countMatch =
    message.match(/retry[_ ]count[:\s]+(\d+)/i) ??
    message.match(/loopback budget \((\d+)/i);

  const failingStage = stageMatch?.[1] ?? stageId;
  const retryCount = countMatch?.[1] !== undefined ? Number.parseInt(countMatch[1], 10) : NaN;

  if (failingStage === undefined || Number.isNaN(retryCount)) {
    return null;
  }
  return { failingStage, retryCount };
}

export function detectRetryLimitFailure(runEvents: RunLogEvent[]): RetryLimitFailureSummary | null {
  for (const event of runEvents) {
    const haystack = `${event.event} ${event.message} ${event.name ?? ""}`;
    if (
      !haystack.includes("retry_limit_halt") &&
      !haystack.includes("gate: retry_limit_halt")
    ) {
      continue;
    }

    const parsed = parseRetryLimitFields(event.message, event.stageId);
    const failingStage = parsed?.failingStage ?? event.stageId ?? "unknown";
    const retryCount = parsed?.retryCount ?? countStageRetryTransitions(runEvents, failingStage);

    return {
      failingStage,
      retryCount,
      loopHistoryText: `${failingStage} exceeded retry budget (${retryCount} transitions)`,
    };
  }
  return null;
}

export function missionControlHref(taskId: string): string {
  return `/mission-control?task=${encodeURIComponent(taskId)}`;
}

export function missionControlShippedOutcomeHref(input: {
  taskId: string;
  title?: string;
  featureId?: string;
}): string {
  const label = input.title || input.featureId || input.taskId;
  return `/mission-control?outcome=${encodeURIComponent(input.taskId)}&label=${encodeURIComponent(label)}`;
}

/** Stale heartbeat threshold for Command Center hanging-task classification. */
export const COMMAND_CENTER_STALE_HEARTBEAT_MS = 5 * 60 * 1000;

/** Long-running active stage threshold for Command Center hanging-task classification. */
export const COMMAND_CENTER_LONG_RUNNING_STAGE_MS = 30 * 60 * 1000;

export type CommandCenterSeverity =
  | "Info"
  | "Warning"
  | "Needs attention"
  | "Blocking"
  | "Critical";

const SEVERITY_URGENCY_ORDER: Record<CommandCenterSeverity, number> = {
  Critical: 0,
  Blocking: 1,
  "Needs attention": 2,
  Warning: 3,
  Info: 4,
};

export type CommandCenterStatusPill =
  | "Draft"
  | "Ready"
  | "Running"
  | "Waiting for human"
  | "Blocked"
  | "Failed"
  | "Retrying"
  | "Complete"
  | "Cancelled"
  | "Archived";

export function featureIdToDisplayLabel(featureId: string): string {
  return featureId
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function featureDisplayLabel(
  task: Pick<
    TaskRunStateEnvelope,
    "taskId" | "featureId" | "decodedTimestamp" | "decodedTimestampDiagnostic"
  >,
): string {
  if (task.featureId) {
    return featureIdToDisplayLabel(task.featureId);
  }
  const suffix = task.decodedTimestamp ?? task.decodedTimestampDiagnostic;
  if (suffix) {
    return `Feature delivery (${suffix})`;
  }
  return "Feature delivery run";
}

export function hasRetryLimitFailure(task: TaskRunStateEnvelope): boolean {
  const hasFailedStage = task.stages.some((stage) => stage.status === "failed");
  if (!hasFailedStage || !isNonTerminalTask(task)) {
    return false;
  }
  return task.runEvents.some((event) => event.retryBadge);
}

export type HangingTaskKind = "stale-heartbeat" | "long-running-stage";

export type HangingTaskClassification = {
  taskId: string;
  kind: HangingTaskKind;
  activeStageName: string;
  elapsedMs: number;
};

export function classifyHangingTask(
  task: TaskRunStateEnvelope,
  nowMs: number = Date.now(),
): HangingTaskClassification | null {
  if (!isNonTerminalTask(task)) {
    return null;
  }
  const activeStage = findActiveStage(task);
  if (!activeStage) {
    return null;
  }

  const lastEventMs = newestRunEventMs(task);
  if (lastEventMs > 0) {
    const timeSinceLastEvent = nowMs - lastEventMs;
    if (timeSinceLastEvent >= COMMAND_CENTER_STALE_HEARTBEAT_MS) {
      return {
        taskId: task.taskId,
        kind: "stale-heartbeat",
        activeStageName: activeStage.name,
        elapsedMs: timeSinceLastEvent,
      };
    }
  }

  const stageEvents = task.runEvents.filter((event) => event.stageId === activeStage.name);
  if (stageEvents.length > 0) {
    const startedAt = stageEvents.reduce((earliest, event) =>
      Date.parse(event.timestamp) < Date.parse(earliest.timestamp) ? event : earliest,
    );
    const stageStartedMs = Date.parse(startedAt.timestamp);
    if (!Number.isNaN(stageStartedMs)) {
      const stageElapsed = Math.max(0, nowMs - stageStartedMs);
      if (stageElapsed >= COMMAND_CENTER_LONG_RUNNING_STAGE_MS) {
        return {
          taskId: task.taskId,
          kind: "long-running-stage",
          activeStageName: activeStage.name,
          elapsedMs: stageElapsed,
        };
      }
    }
  }

  return null;
}

const RUN_EVENT_NAME_LABELS: Record<string, string> = {
  "cursor.runner": "Agent stage run",
  "cursor.runner.escalation": "Model escalation",
  "pancreator.pipeline.advance": "Stage transition",
  heartbeat: "Heartbeat",
  must_fix: "Review must-fix",
};

const RUN_EVENT_OUTCOME_LABELS: Record<string, string> = {
  success: "completed",
  running: "started",
  logged: "logged",
  failed: "failed",
  deferred: "deferred",
};

function slugSegmentToTitle(segment: string): string {
  if (segment.length === 0) {
    return segment;
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function slugToReadableWords(slug: string): string {
  return slug
    .split(/[._-]/u)
    .filter(Boolean)
    .map(slugSegmentToTitle)
    .join(" ");
}

function parseRunEventMessage(
  message: string,
): { persona: string; stageOrEvent: string; outcome: string } | null {
  const match = message.match(/^([^·]+)\s*·\s*([^:]+):\s*(.+)$/u);
  if (!match) {
    return null;
  }
  return {
    persona: match[1].trim(),
    stageOrEvent: match[2].trim(),
    outcome: match[3].trim(),
  };
}

function stageDisplayName(stageId: string): string {
  return featureIdToDisplayLabel(stageId);
}

function readableStageOrEventLabel(stageOrEvent: string, fallbackStageId?: string): string {
  if (stageOrEvent.includes(".")) {
    return RUN_EVENT_NAME_LABELS[stageOrEvent] ?? slugToReadableWords(stageOrEvent);
  }
  if (FEATURE_DELIVERY_STAGE_ORDER.includes(stageOrEvent as (typeof FEATURE_DELIVERY_STAGE_ORDER)[number])) {
    return `${stageDisplayName(stageOrEvent)} stage`;
  }
  if (fallbackStageId !== undefined) {
    return `${stageDisplayName(fallbackStageId)} stage`;
  }
  return stageDisplayName(stageOrEvent);
}

/** Operator-facing event label; never exposes dot-separated internal slugs. */
export function runEventDisplayLabel(event: RunLogEvent): string {
  const parsed = parseRunEventMessage(event.message);
  if (parsed !== null) {
    const subjectLabel = readableStageOrEventLabel(parsed.stageOrEvent, event.stageId);
    const outcome = RUN_EVENT_OUTCOME_LABELS[parsed.outcome] ?? parsed.outcome;
    if (parsed.outcome === "success") {
      return `${subjectLabel} completed`;
    }
    if (parsed.outcome === "running") {
      return `${subjectLabel} started`;
    }
    if (parsed.outcome === "failed") {
      return `${subjectLabel} failed`;
    }
    return `${subjectLabel} ${outcome}`;
  }

  const rawName = event.name ?? event.event;
  const mapped = RUN_EVENT_NAME_LABELS[rawName];
  if (mapped !== undefined) {
    return mapped;
  }

  if (event.escalationLabel !== undefined) {
    return "Model escalation";
  }
  if (event.retryBadge) {
    return "Stage retry required";
  }
  if (event.deferralBadge) {
    return "Stage deferred";
  }

  if (!rawName.includes(".") && !rawName.includes(":")) {
    if (event.stageId !== undefined) {
      return `${stageDisplayName(event.stageId)} stage update`;
    }
    return `${slugToReadableWords(rawName)} activity`;
  }

  return slugToReadableWords(rawName);
}

/** Persona or runner label for activity meta strip; keeps internal slugs out of primary lines. */
export function runEventActorLabel(event: RunLogEvent): string {
  const parsed = parseRunEventMessage(event.message);
  if (parsed !== null) {
    return slugToReadableWords(parsed.persona);
  }
  if (event.escalationLabel !== undefined) {
    return "Cursor runner";
  }
  const rawName = event.name ?? event.event;
  const firstSegment = rawName.split(".")[0] ?? rawName;
  return slugToReadableWords(firstSegment);
}

export function activityStatusForEvent(event: RunLogEvent): CommandCenterStatusPill {
  if (event.retryBadge || /: failed$/u.test(event.message) || event.message.includes("failed")) {
    return "Failed";
  }
  if (event.deferralBadge) {
    return "Blocked";
  }
  if (event.message.includes(": running") || event.event === "heartbeat") {
    return "Running";
  }
  return "Complete";
}

export function activitySeverityForEvent(event: RunLogEvent): CommandCenterSeverity {
  if (event.retryBadge || activityStatusForEvent(event) === "Failed") {
    return "Critical";
  }
  if (event.deferralBadge) {
    return "Blocking";
  }
  if (event.escalationLabel !== undefined) {
    return "Warning";
  }
  return "Info";
}

export type ActivityPreviewEvent = {
  id: string;
  taskId: string;
  featureLabel: string;
  label: string;
  actor: string;
  stageName?: string;
  timestamp: string;
  status: CommandCenterStatusPill;
  severity: CommandCenterSeverity;
};

export function buildRecentActivityPreview(
  tasks: TaskRunStateEnvelope[],
  limit: number = 10,
): ActivityPreviewEvent[] {
  const flattened: ActivityPreviewEvent[] = [];
  for (const task of tasks) {
    const featureLabel = featureDisplayLabel(task);
    for (const event of task.runEvents) {
      flattened.push({
        id: `${task.taskId}:${event.timestamp}:${event.event}`,
        taskId: task.taskId,
        featureLabel,
        label: runEventDisplayLabel(event),
        actor: runEventActorLabel(event),
        ...(event.stageId !== undefined ? { stageName: event.stageId } : {}),
        timestamp: event.timestamp,
        status: activityStatusForEvent(event),
        severity: activitySeverityForEvent(event),
      });
    }
  }
  flattened.sort((left, right) => {
    const severityOrder = compareBySeverity(left, right);
    if (severityOrder !== 0) {
      return severityOrder;
    }
    return Date.parse(right.timestamp) - Date.parse(left.timestamp);
  });
  return flattened.slice(0, limit);
}

export function humanGateSeverity(entry: HumanGateQueueEntry): CommandCenterSeverity {
  if (entry.status === "failed") {
    return "Critical";
  }
  if (entry.humanAttention.trim().length > 0) {
    return "Blocking";
  }
  return "Needs attention";
}

export function compareBySeverity(
  left: { severity: CommandCenterSeverity },
  right: { severity: CommandCenterSeverity },
): number {
  return SEVERITY_URGENCY_ORDER[left.severity] - SEVERITY_URGENCY_ORDER[right.severity];
}

export function statusPillForHumanGate(_entry: HumanGateQueueEntry): CommandCenterStatusPill {
  return "Waiting for human";
}

export function statusPillForActiveStage(stage: StageCell): CommandCenterStatusPill {
  if (stage.status === "failed") {
    return "Failed";
  }
  if (stage.status === "active") {
    return "Running";
  }
  return "Ready";
}

export function isNonTerminalTask(task: TaskRunStateEnvelope): boolean {
  if (task.pipelineStatus && isTerminalPipelineStatus(task.pipelineStatus)) {
    return false;
  }
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

function formatHumanDate(eventMs: number): string {
  return new Date(eventMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatLastEventTime(timestamp: string | null, nowMs: number = Date.now()): string {
  if (timestamp === null) {
    return "—";
  }
  const eventMs = Date.parse(timestamp);
  if (Number.isNaN(eventMs)) {
    if (/^\d{4}-\d{2}-\d{2}/u.test(timestamp)) {
      const parsed = Date.parse(timestamp.slice(0, 10));
      if (!Number.isNaN(parsed)) {
        return formatHumanDate(parsed);
      }
    }
    return timestamp;
  }
  const elapsedMs = Math.max(0, nowMs - eventMs);
  if (elapsedMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(elapsedMs / (60 * 1000)));
    return `${minutes}m ago`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    return `${hours}h ago`;
  }
  const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatHumanDate(eventMs);
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
  activeFeatureLabel: string | null;
  activeFeatureSlug: string | null;
  blockersSummary: string;
  blockerChips: string[];
  refreshTimestamp: string | null;
};

const ACTIVE_MEMORY_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function formatActiveMemoryRefreshTime(
  timestamp: string | null,
  nowMs: number = Date.now(),
): string {
  if (timestamp === null) {
    return "Refresh timestamp unavailable";
  }
  const eventMs = Date.parse(timestamp);
  if (Number.isNaN(eventMs)) {
    return "Refresh timestamp unavailable";
  }
  const elapsedMs = Math.max(0, nowMs - eventMs);
  if (elapsedMs < 60 * 1000) {
    return "Refreshed just now";
  }
  if (elapsedMs < 60 * 60 * 1000) {
    const minutes = Math.floor(elapsedMs / (60 * 1000));
    return `Refreshed ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    return `Refreshed ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsedMs < 2 * 24 * 60 * 60 * 1000) {
    return "Refreshed yesterday";
  }
  if (elapsedMs < ACTIVE_MEMORY_REFRESH_MAX_AGE_MS) {
    const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    return `Refreshed ${days} days ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(eventMs);
}

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
