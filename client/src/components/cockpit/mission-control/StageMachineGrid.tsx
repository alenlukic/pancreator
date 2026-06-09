import {
  activeStageElapsedMs,
  countStageRetryTransitions,
  formatElapsedDuration,
  newestStageTelemetryChip,
  taskDisplayLabel,
  type RunLogEvent,
  type StageCell,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";

function stageTestId(stageName: string): string {
  return `stage-cell-${stageName.toLowerCase().replace(/_/g, "-")}`;
}

export function StageCellCard({
  stage,
  runEvents,
  nowMs,
  onActivate,
  isSelected = false,
  showMissionControlChrome = false,
}: {
  stage: StageCell;
  runEvents: RunLogEvent[];
  nowMs: number;
  onActivate: () => void;
  isSelected?: boolean;
  showMissionControlChrome?: boolean;
}) {
  const isPending = stage.status === "pending";
  const retryCount = countStageRetryTransitions(runEvents, stage.name);
  const elapsedMs =
    stage.status === "active" ? activeStageElapsedMs(runEvents, stage.name, nowMs) : null;
  const telemetryChip =
    stage.status === "active" ? newestStageTelemetryChip(runEvents, stage.name) : null;

  const cellClasses = [
    "stage-cell",
    `stage-cell-${stage.status}`,
    showMissionControlChrome && stage.status === "active" ? "mc-stage-active" : "",
    showMissionControlChrome && isSelected ? "mc-stage-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <header className="stage-cell-header">
        <h4>{stage.name}</h4>
        <span className="stage-cell-persona">{stage.ownerPersona}</span>
      </header>
      {stage.status === "active" ? (
        <div className="stage-cell-active-meta">
          <span className="stage-status-badge stage-status-badge-active">{stage.status}</span>
          {showMissionControlChrome ? (
            <span className="mc-current-stage-label">Current stage</span>
          ) : null}
          {elapsedMs !== null ? (
            <span className="stage-elapsed-time">{formatElapsedDuration(elapsedMs)}</span>
          ) : null}
          {telemetryChip ? (
            <span className={`stage-telemetry-chip telemetry-${telemetryChip.kind}`}>
              {telemetryChip.label}
            </span>
          ) : null}
        </div>
      ) : null}
      {showMissionControlChrome && retryCount > 0 ? (
        <span className="mc-retry-badge" data-testid={`retry-badge-${stage.name}`}>
          {retryCount}
        </span>
      ) : null}
      {!showMissionControlChrome && stage.humanGate ? (
        <p className="stage-cell-gate">Gate: {stage.humanGate}</p>
      ) : null}
      {!showMissionControlChrome && stage.status === "active" && stage.nextHumanAction ? (
        <p className="stage-cell-action">{stage.nextHumanAction}</p>
      ) : null}
      {!showMissionControlChrome && stage.status === "active" && stage.humanAttention ? (
        <p className="stage-cell-action">{stage.humanAttention}</p>
      ) : null}
      {!showMissionControlChrome &&
      (stage.status === "complete" || stage.status === "failed") &&
      stage.humanAttention ? (
        <p className="stage-cell-action">{stage.humanAttention}</p>
      ) : null}
      {!showMissionControlChrome && stage.status === "active" && stage.nextCommand ? (
        <code className="stage-cell-command">{stage.nextCommand}</code>
      ) : null}
      {!showMissionControlChrome &&
      (stage.status === "complete" || stage.status === "failed") &&
      stage.nextCommand ? (
        <code className="stage-cell-command">{stage.nextCommand}</code>
      ) : null}
    </>
  );

  if (isPending) {
    return (
      <article className={cellClasses} data-testid={stageTestId(stage.name)}>
        {content}
      </article>
    );
  }

  return (
    <button
      type="button"
      className={`${cellClasses} stage-cell-interactive`}
      data-testid={stageTestId(stage.name)}
      onClick={onActivate}
    >
      {content}
    </button>
  );
}

export function StageMachineGrid({
  tasks,
  selectedTaskId,
  onSelectTask,
  nowMs,
  onOpenStageDrawer,
}: {
  tasks: TaskRunStateEnvelope[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  nowMs: number;
  onOpenStageDrawer: (task: TaskRunStateEnvelope, stage: StageCell) => void;
}) {
  return (
    <div className="cockpit-grids">
      {tasks.map((task) => {
        const isSelected = task.taskId === selectedTaskId;
        return (
          <section
            key={task.taskId}
            className="task-cockpit"
            aria-label={`Pipeline ${taskDisplayLabel(task)}`}
            aria-selected={isSelected}
            data-testid={`task-cockpit-${task.taskId}`}
          >
            <button
              type="button"
              className="task-cockpit-select"
              onClick={() => onSelectTask(task.taskId)}
            >
              <h3 className="task-cockpit-title">{taskDisplayLabel(task)}</h3>
            </button>
            {task.sourceWarning ? <p className="source-warning">{task.sourceWarning}</p> : null}
            <div className="stage-grid-header">
              <span className="stage-grid-label">Stage grid</span>
            </div>
            <div className="stage-grid" data-testid="stage-grid">
              {task.stages.map((stage) => (
                <StageCellCard
                  key={`${task.taskId}-${stage.name}`}
                  stage={stage}
                  runEvents={task.runEvents}
                  nowMs={nowMs}
                  onActivate={() => onOpenStageDrawer(task, stage)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
