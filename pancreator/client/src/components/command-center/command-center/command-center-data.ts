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
  missionControlShippedOutcomeHref,
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
  CommandCenterCardRegion,
  CommandCenterRegionIconKey,
  CommandCenterRowModel,
  CommandCenterSeverity,
} from "./command-center-types";
import {
  COMMAND_CENTER_MAX_ROWS_PER_REGION as MAX_ROWS,
  COMMAND_CENTER_STALE_DATA_MS,
} from "./command-center-types";

const REGION_METADATA: Record<
  CommandCenterCardRegion,
  {
    title: string;
    summaryLabel: string;
    emptyCopy: string;
    emptyGuidance: string;
    overflowLabel: string;
    overflowHref: string;
    iconKey: CommandCenterRegionIconKey;
    defaultRowActionLabel: string;
  }
> = {
  "human-gates": {
    title: "Blocked on human",
    summaryLabel: "Blocked on human",
    emptyCopy: "No approval requests yet.",
    emptyGuidance:
      "Approval requests appear after a Feature Delivery run reaches a human gate.",
    overflowLabel: "Open all approval requests",
    overflowHref: "/mission-control",
    iconKey: "Hand",
    defaultRowActionLabel: "Open approval request",
  },
  anomalies: {
    title: "Anomalies",
    summaryLabel: "Anomalies",
    emptyCopy: "No delivery anomalies.",
    emptyGuidance: "Failed or hanging runs appear here when delivery health degrades.",
    overflowLabel: "Open all anomalies",
    overflowHref: "/compliance",
    iconKey: "TriangleAlert",
    defaultRowActionLabel: "Open failed run",
  },
  "running-now": {
    title: "Running work",
    summaryLabel: "Running work",
    emptyCopy: "No active delivery runs.",
    emptyGuidance: "Active Feature Delivery runs appear here while work is in flight.",
    overflowLabel: "Open all active runs",
    overflowHref: "/mission-control",
    iconKey: "LoaderCircle",
    defaultRowActionLabel: "Open active run",
  },
  "recent-outcomes": {
    title: "Recent outcomes",
    summaryLabel: "Recent outcomes",
    emptyCopy: "No recent shipped work.",
    emptyGuidance: "Shipped work appears here after completion.",
    overflowLabel: "Open all shipped outcomes",
    overflowHref: "/mission-control",
    iconKey: "CheckCircle2",
    defaultRowActionLabel: "Open shipped outcome",
  },
};

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

function capRows(rows: CommandCenterRowModel[]): {
  rows: CommandCenterRowModel[];
  totalCount: number;
} {
  return {
    rows: rows.slice(0, MAX_ROWS),
    totalCount: rows.length,
  };
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
  return rows;
}

function buildAnomalyRows(
  tasks: TaskRunStateEnvelope[],
  complianceFindings: CommandCenterBuildInput["complianceFindings"],
  nowMs: number,
): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];
  const defaultLabel = REGION_METADATA.anomalies.defaultRowActionLabel;

  for (const task of tasks) {
    if (task.workflowHealthLoadError !== undefined) {
      rows.push({
        id: `workflow-health-load:${task.taskId}`,
        label: truncateLabel(featureDisplayLabel(task)),
        status: "Blocked",
        severity: "Warning",
        ageIso: new Date(nowMs).toISOString(),
        ageLabel: "Degraded data",
        metaHint: "Workflow health unavailable",
        primaryCta: {
          label: "Review run health",
          href: missionControlHref(task.taskId),
        },
        overflow: { taskId: task.taskId, runDir: task.runDir },
      });
    }
    const health = task.workflowHealth;
    if (health !== undefined && health.status !== "healthy") {
      const topFinding = health.findings[0];
      rows.push({
        id: `workflow-health:${task.taskId}`,
        label: truncateLabel(topFinding?.summary ?? "Workflow health needs attention"),
        status: health.status === "blocked" ? "Blocked" : "Failed",
        severity: health.status === "blocked" ? "Blocking" : "Warning",
        ageIso: health.updated_at,
        ageLabel: formatLastEventTime(health.updated_at, nowMs),
        metaHint: `Repairs ${health.repair_count} · Reversals ${health.auto_chain_reversal_count}`,
        primaryCta: {
          label: "Open workflow health",
          href: missionControlHref(task.taskId),
        },
        overflow: {
          taskId: task.taskId,
          runDir: task.runDir,
          inboxSource: task.inboxSource,
        },
      });
    }
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
      primaryCta: {
        label: defaultLabel,
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
        label: defaultLabel,
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
          : `node lib/internal/tools/compliance/run-compliance.mjs ${finding.id}`,
      },
    });
  }

  rows.sort((left, right) => compareBySeverity(left, right));
  return rows;
}

function buildRunningNowRows(tasks: TaskRunStateEnvelope[], nowMs: number): CommandCenterRowModel[] {
  const rows: CommandCenterRowModel[] = [];
  const defaultLabel = REGION_METADATA["running-now"].defaultRowActionLabel;

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
        label: defaultLabel,
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

  return rows;
}

function buildRecentOutcomeRows(shippedOutcomes: ShippedOutcome[], nowMs: number): CommandCenterRowModel[] {
  const defaultLabel = REGION_METADATA["recent-outcomes"].defaultRowActionLabel;

  return shippedOutcomes.map((outcome) => ({
    id: `outcome:${outcome.taskId}`,
    label: truncateLabel(outcome.title || featureIdToDisplayLabel(outcome.featureId)),
    status: "Complete",
    severity: "Info",
    ageIso: outcome.indexedAt,
    ageLabel: formatLastEventTime(outcome.indexedAt, nowMs),
    primaryCta: {
      label: defaultLabel,
      href: missionControlShippedOutcomeHref(outcome),
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

export function formatSectionFreshness(dataAgeMs: number): string {
  if (dataAgeMs <= COMMAND_CENTER_STALE_DATA_MS) {
    return "";
  }
  const seconds = Math.floor(dataAgeMs / 1000);
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.floor(seconds / 60));
    return `Updated ${minutes}m ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `Updated ${hours}h ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `Updated ${days}d ago`;
}

const FAILED_SOURCE_LABELS: Record<string, string> = {
  "run-state": "run state",
  archive: "archive",
  compliance: "compliance audit",
  "feature-index": "shipped outcomes index",
};

export function formatFailedSourceLabel(sources: string[]): string {
  const labels = sources.map((source) => FAILED_SOURCE_LABELS[source] ?? source);
  if (labels.length === 0) {
    return "attention data";
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildCard(
  region: CommandCenterCardRegion,
  rows: CommandCenterRowModel[],
  dataAgeMs?: number,
): CommandCenterCardModel {
  const meta = REGION_METADATA[region];
  const capped = capRows(rows);

  return {
    region,
    testId: `command-center-${region}`,
    title: meta.title,
    summaryLabel: meta.summaryLabel,
    emptyCopy: meta.emptyCopy,
    emptyGuidance: meta.emptyGuidance,
    overflowLabel: meta.overflowLabel,
    iconKey: meta.iconKey,
    totalCount: capped.totalCount,
    rows: capped.rows,
    overflowHref: meta.overflowHref,
    dataAgeMs,
  };
}

export function buildCommandCenterRows(input: CommandCenterBuildInput): CommandCenterCardModel[] {
  const nowMs = input.nowMs ?? Date.now();
  const dataAgeMs = dataAgeForRegion(nowMs, input.dataFetchedAtMs);
  const activeTasks = filterNonTerminalTasks(input.tasks);

  return [
    buildCard("human-gates", buildHumanGateRows(activeTasks, nowMs), dataAgeMs),
    buildCard(
      "anomalies",
      buildAnomalyRows(activeTasks, input.complianceFindings, nowMs),
      dataAgeMs,
    ),
    buildCard("running-now", buildRunningNowRows(activeTasks, nowMs), dataAgeMs),
    buildCard("recent-outcomes", buildRecentOutcomeRows(input.shippedOutcomes, nowMs), dataAgeMs),
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
