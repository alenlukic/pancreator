import { StatusPill, type StatusPillValue } from "@/components/cockpit/shared/StatusPill";
import {
  findActiveStage,
  formatLastEventTime,
  hasActiveHumanApprovalGate,
  newestRunEventTimestamp,
  taskDisplayLabel,
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
  const lastUpdated = formatLastEventTime(newestRunEventTimestamp(task), nowMs);

  return (
    <header className="mc-run-context-header" data-testid="run-context-header">
      <div className="mc-run-context-primary">
        <h1 className="mc-run-context-title">{taskDisplayLabel(task)}</h1>
        <div className="mc-run-context-meta">
          <StatusPill status={taskStatusPill(task)} />
          <span className="mc-run-context-updated">Updated {lastUpdated}</span>
        </div>
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
