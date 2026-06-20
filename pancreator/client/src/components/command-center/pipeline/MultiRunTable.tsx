"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import {
  featureDisplayLabel,
  findActiveStage,
  formatLastEventTime,
  hasActiveHumanApprovalGate,
  newestRunEventTimestamp,
  sortTasksForMultiRunTable,
  type MultiRunSortMode,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";

function stageTestId(stageName: string): string {
  return `stage-cell-${stageName.toLowerCase().replace(/_/g, "-")}`;
}

export function MultiRunTable({
  tasks,
  selectedTaskId,
  nowMs,
  onSelectTask,
}: {
  tasks: TaskRunStateEnvelope[];
  selectedTaskId: string | null;
  nowMs: number;
  onSelectTask: (taskId: string) => void;
}) {
  const [sortMode, setSortMode] = useState<MultiRunSortMode>("last-event");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());

  const sortedTasks = useMemo(
    () => sortTasksForMultiRunTable(tasks, sortMode),
    [sortMode, tasks],
  );

  function toggleExpanded(taskId: string) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  async function copyTaskId(taskId: string, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    await navigator.clipboard.writeText(taskId);
  }

  return (
    <section className="multi-run-table" data-testid="multi-run-table">
      <div className="multi-run-table-header">
        <h2>Multi-run</h2>
        <div className="multi-run-sort-controls">
          <button
            type="button"
            className={`multi-run-sort-button${sortMode === "last-event" ? " multi-run-sort-active" : ""}`}
            data-testid="multi-run-sort-last-event"
            onClick={() => setSortMode("last-event")}
          >
            Last event
          </button>
          <button
            type="button"
            className={`multi-run-sort-button${sortMode === "human-gate" ? " multi-run-sort-active" : ""}`}
            data-testid="multi-run-sort-human-gate"
            onClick={() => setSortMode("human-gate")}
          >
            Human gate
          </button>
        </div>
      </div>
      <div className="multi-run-grid" role="grid" aria-label="Concurrent feature-delivery runs">
        {sortedTasks.map((task) => {
          const activeStage = findActiveStage(task);
          const isSelected = task.taskId === selectedTaskId;
          const isExpanded = expandedTaskIds.has(task.taskId);
          const lastEvent = formatLastEventTime(newestRunEventTimestamp(task), nowMs);

          return (
            <div key={task.taskId} className="multi-run-row-wrap">
              <div
                className={`multi-run-row${isSelected ? " multi-run-row-selected" : ""}`}
                role="row"
                aria-selected={isSelected}
                data-testid={`multi-run-row-${task.taskId}`}
              >
                <button
                  type="button"
                  className="multi-run-row-select"
                  data-testid={`multi-run-select-${task.taskId}`}
                  onClick={() => onSelectTask(task.taskId)}
                >
                  <span className="multi-run-row-primary">
                    <span className="multi-run-row-label">{featureDisplayLabel(task)}</span>
                    <span className="multi-run-row-meta">
                      <span className="multi-run-row-stage">{activeStage?.name ?? "—"}</span>
                      <span className="multi-run-row-meta-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="multi-run-row-event">{lastEvent}</span>
                      {hasActiveHumanApprovalGate(task) ? (
                        <span className="multi-run-gate-badge">human_approval</span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="multi-run-copy-id"
                  data-testid={`multi-run-copy-id-${task.taskId}`}
                  aria-label="Copy run id"
                  onClick={(event) => void copyTaskId(task.taskId, event)}
                >
                  Copy run id
                </button>
                <button
                  type="button"
                  className="multi-run-expand-toggle"
                  data-testid={`multi-run-expand-${task.taskId}`}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} stage grid for ${featureDisplayLabel(task)}`}
                  onClick={() => toggleExpanded(task.taskId)}
                >
                  {isExpanded ? (
                    <ChevronDown aria-hidden="true" size={16} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={16} />
                  )}
                </button>
              </div>
              {isExpanded ? (
                <div className="multi-run-expanded-grid" data-testid="multi-run-expanded-grid">
                  <div className="stage-grid">
                    {task.stages.map((stage) => (
                      <article
                        key={`${task.taskId}-${stage.name}`}
                        className={`stage-cell stage-cell-${stage.status}`}
                        data-testid={stageTestId(stage.name)}
                      >
                        <header className="stage-cell-header">
                          <h4>{stage.name}</h4>
                          <span className="stage-cell-persona">{stage.ownerPersona}</span>
                        </header>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
