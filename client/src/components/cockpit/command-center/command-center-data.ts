import {
  buildRecentActivityPreview,
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
  inboxRunCommand,
  missionControlHref,
  newestRunEventTimestamp,
  taskLevelNextCommand,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import type { SeverityChipValue } from "../shared/SeverityChip";
import type { StatusPillValue } from "../shared/StatusPill";
import type {
  CommandCenterBuildInput,
  CommandCenterCardModel,
  CommandCenterRowModel,
  CommandCenterSeverity,
} from "./command-center-types";

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

function buildNeedsYouRows(tasks: TaskRunStateEnvelope[], nowMs: number): CommandCenterRowModel[] {
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
      metaHint: entry.stageName,
      primaryCta: {
        label: "Open mission control",
        href: missionControlHref(entry.taskId),
      },
      overflow: {
        taskId: entry.taskId,
        runDir: entry.runDir,
        inboxSource: entry.inboxSource,
        runCommand: task ? taskLevelNextCommand(task) : undefined,
      },
    });
  }

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
      metaHint: activeStage?.name,
      primaryCta: {
        label: "Open mission control",
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

  rows.sort((left, right) => compareBySeverity(left, right));
  return rows;
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
      metaHint: activeStage.name,
      primaryCta: {
        label: "Open mission control",
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

  return rows;
}

function buildComplianceRows(
  findings: CommandCenterBuildInput["complianceFindings"],
  nowMs: number,
): CommandCenterRowModel[] {
  return findings.map((finding) => ({
    id: `compliance:${finding.id}`,
    label: truncateLabel(finding.label),
    status: "Failed",
    severity: finding.blocks ? "Blocking" : toSeverityChip(finding.severity),
    ageIso: new Date(nowMs).toISOString(),
    ageLabel: truncateLabel(finding.excerpt, 40),
    metaHint: finding.missingArtifact ? "Missing artifact" : undefined,
    primaryCta: {
      label: finding.missingArtifact ? "Run quick fix" : "Re-run compliance check",
      href: "/compliance",
    },
    overflow: {
      runCommand: finding.missingArtifact
        ? undefined
        : `node lib/internal/tools/run-compliance.mjs ${finding.id}`,
    },
  }));
}

function buildHangingTaskRows(tasks: TaskRunStateEnvelope[], nowMs: number): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];

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
        label: "Open mission control",
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

  rows.sort((left, right) => compareBySeverity(left, right));
  return rows;
}

function buildAutomationRows(
  automationRows: CommandCenterBuildInput["automationRows"],
  nowMs: number,
): CommandCenterRowModel[] {
  const sorted = [...automationRows].sort((left, right) => {
    if (left.status === "failed" && right.status !== "failed") {
      return -1;
    }
    if (right.status === "failed" && left.status !== "failed") {
      return 1;
    }
    return 0;
  });

  return sorted.map((automation) => {
    const failed = automation.status === "failed";
    return {
      id: `automation:${automation.automationId}`,
      label: truncateLabel(automation.name),
      status: failed ? "Failed" : automation.status === "paused" ? "Blocked" : "Running",
      severity: failed ? "Critical" : "Info",
      ageIso: automation.lastRunAt ?? new Date(nowMs).toISOString(),
      ageLabel: automation.lastRunAt
        ? formatLastEventTime(automation.lastRunAt, nowMs)
        : automation.scheduleLabel,
      metaHint: automation.scheduleLabel,
      primaryCta: {
        label: failed && automation.canRetry ? "Retry automation run" : "Open automations",
        href: "/automations",
      },
      overflow: {
        runCommand: failed ? `automation run ${automation.automationId}` : undefined,
      },
    };
  });
}

function buildActivityRows(
  events: CommandCenterBuildInput["activityEvents"],
  nowMs: number,
): CommandCenterRowModel[] {
  const sorted = [...events].sort((left, right) => {
    const severityOrder = compareBySeverity(left, right);
    if (severityOrder !== 0) {
      return severityOrder;
    }
    return Date.parse(right.timestamp) - Date.parse(left.timestamp);
  });

  return sorted.map((event) => {
    const metaParts = [
      event.stageName !== undefined ? featureIdToDisplayLabel(event.stageName) : undefined,
      event.actor,
    ].filter((part): part is string => part !== undefined && part.length > 0);

    return {
      id: `activity:${event.id}`,
      label: truncateLabel(`${event.label} · ${event.featureLabel}`),
      status: toStatusPill(event.status),
      severity: toSeverityChip(event.severity),
      ageIso: event.timestamp,
      ageLabel: formatLastEventTime(event.timestamp, nowMs),
      metaHint: metaParts.join(" · "),
      primaryCta: {
        label: "Open activity log",
        href: "/activity-log",
      },
      overflow: {
        taskId: event.taskId,
      },
    };
  });
}


export function buildCommandCenterRows(input: CommandCenterBuildInput): CommandCenterCardModel[] {
  const nowMs = input.nowMs ?? Date.now();
  const activityEvents =
    input.activityEvents.length > 0
      ? input.activityEvents
      : buildRecentActivityPreview(input.tasks, 10);

  return [
    {
      region: "needs-you",
      testId: "command-center-needs-you",
      title: "Needs you",
      emptyCopy: "No items need your attention",
      rows: buildNeedsYouRows(input.tasks, nowMs),
    },
    {
      region: "running-now",
      testId: "command-center-running-now",
      title: "Running now",
      emptyCopy: "No feature-delivery runs in progress",
      rows: buildRunningNowRows(input.tasks, nowMs),
    },
    {
      region: "compliance-issues",
      testId: "command-center-compliance-issues",
      title: "Compliance issues",
      emptyCopy: "No open compliance findings",
      rows: buildComplianceRows(input.complianceFindings, nowMs),
    },
    {
      region: "hanging-tasks",
      testId: "command-center-hanging-tasks",
      title: "Hanging tasks",
      emptyCopy: "No hanging tasks detected",
      rows: buildHangingTaskRows(input.tasks, nowMs),
    },
    {
      region: "recent-automations",
      testId: "command-center-recent-automations",
      title: "Recent automations",
      emptyCopy: "No recent automation runs",
      rows: buildAutomationRows(input.automationRows, nowMs),
    },
    {
      region: "recent-activity",
      testId: "command-center-recent-activity",
      title: "Recent activity",
      emptyCopy: "No recent activity events",
      rows: buildActivityRows(activityEvents, nowMs),
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

export { inboxRunCommand };
