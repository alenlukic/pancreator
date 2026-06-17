import {
  classifyHangingTask,
  compareBySeverity,
  featureDisplayLabel,
  featureIdToDisplayLabel,
  hasRetryLimitFailure,
  humanGateSeverity,
  statusPillForActiveStage,
  statusPillForHumanGate,
  collectHumanGateQueue,
  filterNonTerminalTasks,
  findActiveStage,
  formatLastEventTime,
  missionControlHref,
  newestRunEventTimestamp,
  taskLevelNextCommand,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import type { ShippedOutcome } from "@/services/run-state";
import type { SeverityChipValue } from "../shared/SeverityChip";
import type { StatusPillValue } from "../shared/StatusPill";
import type {
  CommandCenterBuildInput,
  CommandCenterCardModel,
  CommandCenterRowModel,
  CommandCenterSeverity,
} from "./command-center-types";
import { COMMAND_CENTER_MAX_ROWS_PER_REGION as MAX_ROWS } from "./command-center-types";

function toSeverityChip(severity: CommandCenterSeverity): SeverityChipValue {
  return severity;
}

function toStatusPill(status: string): StatusPillValue {
  return status as StatusPillValue;
}

function truncateLabel(label: string, maxLength = 60): string {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 1)}…`;
}

function gateActionLabel(action: "approve" | "reject" | "revise", featureLabel: string): string {
  const object = truncateLabel(featureLabel, 40);
  if (action === "approve") {
    return `Approve ${object}`;
  }
  if (action === "reject") {
    return `Reject ${object}`;
  }
  return `Revise ${object}`;
}

function buildHumanGateRows(tasks: TaskRunStateEnvelope[], nowMs: number): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];

  for (const entry of collectHumanGateQueue(tasks)) {
    const task = tasks.find((candidate) => candidate.taskId === entry.taskId);
    const label = task ? featureDisplayLabel(task) : "Feature delivery run";
    const severity = humanGateSeverity(entry);
    const timestamp = task ? newestRunEventTimestamp(task) : null;
    rows.push({
      id: `gate:${entry.taskId}:${entry.stageName}`,
      label: truncateLabel(label),
      status: toStatusPill(statusPillForHumanGate(entry)),
      severity: toSeverityChip(severity),
      ageIso: timestamp ?? new Date(nowMs).toISOString(),
      ageLabel: formatLastEventTime(timestamp, nowMs),
      primaryCta: {
        label: gateActionLabel("approve", label),
        href: missionControlHref(entry.taskId),
      },
      overflow: {
        taskId: entry.taskId,
        runDir: entry.runDir,
        inboxSource: entry.inboxSource,
        runCommand: task ? taskLevelNextCommand(task) : undefined,
        stageName: entry.stageName,
        gateAction: "revise",
        secondaryLabel: gateActionLabel("reject", label),
        secondaryHref: missionControlHref(entry.taskId),
      },
    });
  }

  rows.sort((left, right) => compareBySeverity(left, right));
  return rows.slice(0, MAX_ROWS);
}

function buildAnomalyRows(
  tasks: TaskRunStateEnvelope[],
  complianceFindings: CommandCenterBuildInput["complianceFindings"],
  nowMs: number,
): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];

  for (const task of tasks) {
    if (!hasRetryLimitFailure(task)) {
      continue;
    }
    const activeStage = findActiveStage(task);
    const timestamp = newestRunEventTimestamp(task);
    rows.push({
      id: `retry:${task.taskId}`,
      label: truncateLabel(featureDisplayLabel(task)),
      status: "Failed",
      severity: "Critical",
      ageIso: timestamp ?? new Date(nowMs).toISOString(),
      ageLabel: formatLastEventTime(timestamp, nowMs),
      primaryCta: {
        label: "Open run detail",
        href: missionControlHref(task.taskId),
      },
      overflow: {
        taskId: task.taskId,
        runDir: task.runDir,
        inboxSource: task.inboxSource,
        runCommand: taskLevelNextCommand(task),
        stageName: activeStage?.name,
      },
    });
  }

  for (const task of tasks) {
    const classification = classifyHangingTask(task, nowMs);
    if (!classification) {
      continue;
    }
    const timestamp = newestRunEventTimestamp(task);
    const metaHint =
      classification.kind === "stale-heartbeat" ? "Stale heartbeat" : "Long-running stage";
    rows.push({
      id: `hanging:${task.taskId}`,
      label: truncateLabel(featureDisplayLabel(task)),
      status: "Blocked",
      severity: "Warning",
      ageIso: timestamp ?? new Date(nowMs).toISOString(),
      ageLabel: formatLastEventTime(timestamp, nowMs),
      metaHint,
      primaryCta: {
        label: "Open run detail",
        href: missionControlHref(task.taskId),
      },
      overflow: {
        taskId: task.taskId,
        runDir: task.runDir,
        inboxSource: task.inboxSource,
        runCommand: taskLevelNextCommand(task),
      },
    });
  }

  for (const finding of complianceFindings) {
    rows.push({
      id: `compliance:${finding.id}`,
      label: truncateLabel(finding.label),
      status: "Failed",
      severity: finding.blocks ? "Blocking" : toSeverityChip(finding.severity),
      ageIso: new Date(nowMs).toISOString(),
      ageLabel: truncateLabel(finding.excerpt, 40),
      metaHint: finding.missingArtifact ? "Missing artifact" : undefined,
      primaryCta: {
        label: finding.missingArtifact ? "Run recovery for finding" : "Re-run compliance audit",
        href: "/compliance",
      },
      overflow: {
        runCommand: finding.missingArtifact
          ? undefined
          : `node lib/internal/tools/run-compliance.mjs ${finding.id}`,
      },
    });
  }

  rows.sort((left, right) => compareBySeverity(left, right));
  return rows.slice(0, MAX_ROWS);
}

function buildRunningNowRows(tasks: TaskRunStateEnvelope[], nowMs: number): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];

  for (const task of filterNonTerminalTasks(tasks)) {
    const activeStage = findActiveStage(task);
    if (!activeStage || activeStage.status !== "active") {
      continue;
    }
    if (activeStage.humanGate === "human_approval") {
      continue;
    }
    const timestamp = newestRunEventTimestamp(task);
    rows.push({
      id: `running:${task.taskId}`,
      label: truncateLabel(featureDisplayLabel(task)),
      status: toStatusPill(statusPillForActiveStage(activeStage)),
      severity: "Info",
      ageIso: timestamp ?? new Date(nowMs).toISOString(),
      ageLabel: formatLastEventTime(timestamp, nowMs),
      primaryCta: {
        label: "Open run detail",
        href: missionControlHref(task.taskId),
      },
      overflow: {
        taskId: task.taskId,
        runDir: task.runDir,
        inboxSource: task.inboxSource,
        runCommand: taskLevelNextCommand(task),
        stageName: activeStage.name,
      },
    });
  }

  return rows.slice(0, MAX_ROWS);
}

function buildRecentOutcomeRows(shippedOutcomes: ShippedOutcome[], nowMs: number): CommandCenterRowModel[] {
  return shippedOutcomes.slice(0, MAX_ROWS).map((outcome) => ({
    id: `outcome:${outcome.taskId}`,
    label: truncateLabel(outcome.title || featureIdToDisplayLabel(outcome.featureId)),
    status: "Complete",
    severity: "Info",
    ageIso: outcome.indexedAt,
    ageLabel: formatLastEventTime(outcome.indexedAt, nowMs),
    primaryCta: {
      label: "Open shipped feature",
      href: `/mission-control?task=${encodeURIComponent(outcome.taskId)}`,
    },
    overflow: {
      taskId: outcome.taskId,
    },
  }));
}

function dataAgeForRegion(nowMs: number, fetchedAtMs?: number): number | undefined {
  if (fetchedAtMs === undefined) {
    return undefined;
  }
  return nowMs - fetchedAtMs;
}

export function buildCommandCenterRows(input: CommandCenterBuildInput): CommandCenterCardModel[] {
  const nowMs = input.nowMs ?? Date.now();
  const dataAgeMs = dataAgeForRegion(nowMs, input.dataFetchedAtMs);
  const runStateDegraded = input.failedSources?.includes("run-state");
  const complianceDegraded = input.failedSources?.includes("compliance");
  const outcomesDegraded = input.failedSources?.includes("feature-index");
  const archiveDegraded = input.failedSources?.includes("archive");
  const activeTasks = filterNonTerminalTasks(input.tasks);

  return [
    {
      region: "human-gates",
      testId: "command-center-human-gates",
      title: "Blocked on human",
      emptyCopy: "No human gates waiting for you",
      emptyNextStep: { label: "Open Feature Delivery", href: "/mission-control" },
      rows: buildHumanGateRows(activeTasks, nowMs),
      overflowHref: "/mission-control",
      dataAgeMs,
      ...(runStateDegraded || archiveDegraded
        ? { degradedSource: runStateDegraded ? "run-state" : "archive" }
        : {}),
    },
    {
      region: "anomalies",
      testId: "command-center-anomalies",
      title: "Anomalies",
      emptyCopy: "No anomalies detected",
      rows: buildAnomalyRows(activeTasks, input.complianceFindings, nowMs),
      overflowHref: "/compliance",
      dataAgeMs,
      ...(runStateDegraded || archiveDegraded || complianceDegraded
        ? {
            degradedSource: runStateDegraded
              ? "run-state"
              : archiveDegraded
                ? "archive"
                : "compliance",
          }
        : {}),
    },
    {
      region: "running-now",
      testId: "command-center-running-now",
      title: "Running work",
      emptyCopy: "No feature-delivery runs in progress",
      rows: buildRunningNowRows(activeTasks, nowMs),
      overflowHref: "/mission-control",
      dataAgeMs,
      ...(runStateDegraded || archiveDegraded
        ? { degradedSource: runStateDegraded ? "run-state" : "archive" }
        : {}),
    },
    {
      region: "recent-outcomes",
      testId: "command-center-recent-outcomes",
      title: "Recent Outcomes",
      emptyCopy: "No recently shipped features",
      rows: buildRecentOutcomeRows(input.shippedOutcomes, nowMs),
      overflowHref: "/mission-control",
      dataAgeMs,
      ...(outcomesDegraded ? { degradedSource: "feature-index" } : {}),
    },
  ];
}

export function mapComplianceResultsToFindings(
  results: Array<{
    id: string;
    pass: boolean;
    severity: string;
    blocks?: boolean;
    detail?: string | null;
  }>,
): CommandCenterBuildInput["complianceFindings"] {
  return results
    .filter((row) => !row.pass)
    .map((row) => {
      const detail = row.detail ?? "";
      const missingArtifact =
        detail.toLowerCase().includes("missing") && detail.toLowerCase().includes("artifact");
      const severity: CommandCenterSeverity =
        row.blocks || row.severity === "high"
          ? "Blocking"
          : row.severity === "medium"
            ? "Warning"
            : "Info";
      return {
        id: row.id,
        label: row.id.replace(/-/gu, " "),
        excerpt: detail.length > 0 ? detail.slice(0, 60) : "Compliance check failed",
        severity,
        blocks: row.blocks ?? false,
        detail: row.detail,
        missingArtifact,
      };
    });
}

export { inboxRunCommand } from "@/services/run-state-shared";
