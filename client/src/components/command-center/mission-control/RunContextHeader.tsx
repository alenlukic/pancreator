"use client";

import { useState } from "react";
import { StatusPill, type StatusPillValue } from "@/components/command-center/shared/StatusPill";
import {
  featureDisplayLabel,
  findActiveStage,
  formatLastEventTime,
  hasActiveHumanApprovalGate,
  newestRunEventTimestamp,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";

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
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const lastUpdated = formatLastEventTime(newestRunEventTimestamp(task), nowMs);

  async function copyTaskId() {
    await navigator.clipboard.writeText(task.taskId);
    setCopyFeedback("Copied task id");
    window.setTimeout(() => setCopyFeedback(null), 2000);
  }

  return (
    <header className="mc-run-context-header" data-testid="run-context-header">
      <div className="mc-run-context-primary">
        <h1 className="mc-run-context-title">{featureDisplayLabel(task)}</h1>
        <div className="mc-run-context-meta">
          <StatusPill status={taskStatusPill(task)} />
          <span className="mc-run-context-updated">Updated {lastUpdated}</span>
        </div>
        <button
          type="button"
          className="mc-show-technical-details-btn"
          data-testid="toggle-technical-details"
          onClick={() => setShowTechnicalDetails((current) => !current)}
        >
          {showTechnicalDetails ? "Hide technical details" : "Show technical details"}
        </button>
        {showTechnicalDetails ? (
          <div className="mc-run-context-technical" data-testid="run-context-technical-details">
            <code className="mc-run-context-task-id">{task.taskId}</code>
            <button type="button" data-testid="copy-task-id" onClick={() => void copyTaskId()}>
              Copy task id
            </button>
            {copyFeedback ? (
              <span className="mc-copy-feedback" aria-live="polite">
                {copyFeedback}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mc-run-context-actions">
        {isPolling ? (
          <span className="mc-live-indicator" data-testid="mc-live-indicator" aria-live="polite">
            <span className="mc-live-dot" aria-hidden="true" />
            Live
          </span>
        ) : null}
        <button
          type="button"
          className="mc-open-run-logs-btn"
          data-testid="open-run-logs-button"
          onClick={onOpenRunLogs}
        >
          Open run logs
        </button>
      </div>
    </header>
  );
}
