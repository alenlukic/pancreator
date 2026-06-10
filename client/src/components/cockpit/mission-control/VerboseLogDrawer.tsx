"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { TaskRunStateEnvelope } from "@/services/run-state-shared";
import { RunEventTimeline } from "./RunEventTimeline";

export function VerboseLogDrawer({
  open,
  task,
  tasks,
  onClose,
}: {
  open: boolean;
  task: TaskRunStateEnvelope;
  tasks: TaskRunStateEnvelope[];
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const scrollPinnedRef = useRef(true);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of task.runEvents) {
      types.add(event.event);
    }
    return [...types].sort();
  }, [task.runEvents]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="mc-log-drawer-backdrop"
        aria-label="Close run logs"
        data-testid="verbose-log-drawer-backdrop"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="mc-verbose-log-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="verbose-log-drawer"
        tabIndex={-1}
      >
        <header className="mc-log-drawer-header">
          <h2 id={titleId}>Run event log</h2>
          <button
            type="button"
            className="mc-log-drawer-close"
            data-testid="close-run-logs-button"
            onClick={onClose}
          >
            Close run logs
          </button>
        </header>
        <div className="mc-log-drawer-filters" data-testid="log-drawer-filters">
          <div className="mc-log-filter-chips" role="group" aria-label="Severity filters">
            {["all", "retry", "escalation", "deferral"].map((filter) => (
              <button
                key={filter}
                type="button"
                className={`mc-log-filter-chip${severityFilter === filter ? " mc-log-filter-chip-active" : ""}`}
                aria-pressed={severityFilter === filter}
                onClick={() => setSeverityFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <label className="mc-log-event-type-filter">
            Event type
            <select
              value={eventTypeFilter}
              onChange={(event) => setEventTypeFilter(event.target.value)}
            >
              <option value="all">All events</option>
              {eventTypes.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {eventType}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className="mc-log-drawer-body"
          onScroll={(event) => {
            const target = event.currentTarget;
            scrollPinnedRef.current = target.scrollTop < 8;
          }}
        >
          <RunEventTimeline
            tasks={tasks}
            selectedTaskId={task.taskId}
            severityFilter={severityFilter}
            eventTypeFilter={eventTypeFilter}
          />
        </div>
      </aside>
    </>
  );
}
