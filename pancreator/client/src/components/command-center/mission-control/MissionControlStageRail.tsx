import type { KeyboardEvent } from "react";
import type { StageCell, TaskRunStateEnvelope } from "@/services/run-state-shared";
import { StageCellCard } from "./StageMachineGrid";

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

export function MissionControlStageRail({
  task,
  selectedStageName,
  nowMs,
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
      className="mc-stage-rail"
      role="navigation"
      aria-label="Feature delivery stages"
      data-testid="mission-control-stage-rail"
    >
      <div className="mc-stage-rail-track">
        {FD_STAGE_ORDER.map((stageName) => {
          const stage = stageByName.get(stageName);
          if (stage === undefined) {
            return null;
          }
          const isSelected = selectedStageName === stage.name;
          return (
            <div
              key={stage.name}
              className="mc-stage-rail-cell-wrap"
              onKeyDown={(event) => handleKeyDown(event, stage)}
            >
              <StageCellCard
                stage={stage}
                runEvents={task.runEvents}
                nowMs={nowMs}
                isSelected={isSelected}
                showMissionControlChrome
                onActivate={() => {
                  if (stage.status !== "pending") {
                    onSelectStage(stage);
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </nav>
  );
}
