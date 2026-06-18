"use client";

import {
  featureDisplayLabel,
  findActiveStage,
  formatLastEventTime,
  hasActiveHumanApprovalGate,
  newestRunEventTimestamp,
  runEventDisplayLabel,
  taskLevelNextCommand,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { MetadataDisclosure } from "../shared/MetadataDisclosure";
import { RunSummaryHeader } from "../shared/RunSummaryHeader";
import type { StatusPillValue } from "../shared/StatusPill";

function taskStatusPill(task: TaskRunStateEnvelope): StatusPillValue {
  const activeStage = findActiveStage(task);
  if (activeStage?.status === "failed") {
    return "Failed";
  }
  if (hasActiveHumanApprovalGate(task)) {
    return "Waiting for human";
  }
  if (activeStage !== undefined) {
    return "Running";
  }
  const completeStage = task.stages.find((stage) => stage.name === "complete");
  if (completeStage?.status === "complete") {
    return "Complete";
  }
  return "Ready";
}

function blockingCondition(task: TaskRunStateEnvelope): string | undefined {
  const activeStage = findActiveStage(task);
  if (activeStage?.humanAttention) {
    return activeStage.humanAttention;
  }
  if (activeStage?.nextHumanAction) {
    return activeStage.nextHumanAction;
  }
  return undefined;
}

export function RunContextHeader({
  task,
  nowMs,
  isPolling,
  onOpenRunLogs,
}: {
  task: TaskRunStateEnvelope;
  nowMs: number;
  isPolling: boolean;
  onOpenRunLogs: () => void;
}) {
  const activeStage = findActiveStage(task);
  const latestEvent = task.runEvents[0];
  const nextCommand = taskLevelNextCommand(task);

  return (
    <RunSummaryHeader
      testId="run-context-header"
      title={featureDisplayLabel(task)}
      status={taskStatusPill(task)}
      stageLabel={activeStage ? `${activeStage.name} stage` : undefined}
      ownerPersona={activeStage?.ownerPersona}
      blockingCondition={blockingCondition(task)}
      latestReceipt={
        latestEvent ? runEventDisplayLabel(latestEvent) : undefined
      }
      meta={
        <>
          <span className="mc-run-context-updated">
            Updated {formatLastEventTime(newestRunEventTimestamp(task), nowMs)}
          </span>
          {isPolling ? (
            <span className="mc-live-indicator" data-testid="mc-live-indicator" aria-live="polite">
              <span className="mc-live-dot" aria-hidden="true" />
              Live
            </span>
          ) : null}
        </>
      }
      primaryAction={
        nextCommand ? (
          <button
            type="button"
            className="command-center-action-button command-center-action-cta"
            data-testid="run-summary-primary-action"
          >
            Run next command
          </button>
        ) : (
          <button
            type="button"
            className="command-center-row-cta-quiet mc-open-run-logs-btn"
            data-testid="open-run-logs-button"
            onClick={onOpenRunLogs}
          >
            Open run logs
          </button>
        )
      }
      disclosures={
        <MetadataDisclosure label="technical details" testId="run-context-metadata">
          <code className="mc-run-context-task-id">{task.taskId}</code>
          <p>Run directory: {task.runDir}</p>
          {task.inboxSource ? <p>Inbox source: {task.inboxSource}</p> : null}
        </MetadataDisclosure>
      }
    />
  );
}
