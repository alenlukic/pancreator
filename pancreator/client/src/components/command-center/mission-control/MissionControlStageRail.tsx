import type { KeyboardEvent } from "react";
import {
  countStageRetryTransitions,
  type StageCell,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";

const FD_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
  "ship",
  "index",
] as const;

function stageTestId(stageName: string): string {
  return `stage-cell-${stageName.toLowerCase().replace(/_/g, "-")}`;
}

function stageStripStatusClass(status: StageCell["status"]): string {
  switch (status) {
    case "active":
      return "mc-stage-strip-active";
    case "failed":
      return "mc-stage-strip-failed";
    case "complete":
      return "mc-stage-strip-complete";
    default:
      return "mc-stage-strip-pending";
  }
}

export function MissionControlStageRail({
  task,
  selectedStageName,
  nowMs: _nowMs,
  onSelectStage,
}: {
  task: TaskRunStateEnvelope;
  selectedStageName: string | null;
  nowMs: number;
  onSelectStage: (stage: StageCell) => void;
}) {
  const stageByName = new Map(task.stages.map((stage) => [stage.name, stage]));

  function handleKeyDown(event: KeyboardEvent, stage: StageCell) {
    if (stage.status === "pending") {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectStage(stage);
    }
  }

  return (
    <nav
      className="mc-stage-rail mc-stage-strip"
      role="navigation"
      aria-label="Feature delivery stages"
      data-testid="mission-control-stage-rail"
    >
      <div className="mc-stage-rail-track mc-stage-strip-track">
        {FD_STAGE_ORDER.map((stageName) => {
          const stage = stageByName.get(stageName);
          if (stage === undefined) {
            return null;
          }
          const isSelected = selectedStageName === stage.name;
          const isPending = stage.status === "pending";
          const retryCount = countStageRetryTransitions(task.runEvents, stage.name);
          const cellClasses = [
            "mc-stage-strip-cell",
            stageStripStatusClass(stage.status),
            isSelected ? "mc-stage-strip-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const retryBadge =
            retryCount > 0 ? (
              <span
                className="mc-stage-strip-retry"
                data-testid={`retry-badge-${stage.name}`}
                aria-label={`${retryCount} retries`}
              >
                {retryCount}
              </span>
            ) : null;

          if (isPending) {
            return (
              <span
                key={stage.name}
                className={cellClasses}
                data-testid={stageTestId(stage.name)}
                aria-label={`${stage.name} stage, pending`}
              >
                <span className="mc-stage-strip-label">{stage.name}</span>
                {retryBadge}
              </span>
            );
          }

          return (
            <div
              key={stage.name}
              className="mc-stage-strip-cell-wrap"
              onKeyDown={(event) => handleKeyDown(event, stage)}
            >
              <button
                type="button"
                className={`${cellClasses} mc-stage-strip-interactive`}
                data-testid={stageTestId(stage.name)}
                aria-label={`${stage.name} stage, ${stage.status}`}
                aria-pressed={isSelected}
                onClick={() => onSelectStage(stage)}
              >
                <span className="mc-stage-strip-label">{stage.name}</span>
                {retryBadge}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
