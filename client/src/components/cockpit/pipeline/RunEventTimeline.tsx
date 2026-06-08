import { useEffect, useMemo, useRef, useState } from "react";
import {
  taskDisplayLabel,
  type RunLogEvent,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";

function runEventKey(event: RunLogEvent): string {
  return `${event.timestamp}|${event.name ?? event.event}|${event.message}`;
}

function TelemetryBadges({ event }: { event: RunLogEvent }) {
  if (event.escalationLabel !== undefined) {
    return <span className="telemetry-escalation">{event.escalationLabel || "Escalation"}</span>;
  }
  if (event.retryBadge) {
    return <span className="telemetry-retry">Retry</span>;
  }
  if (event.deferralBadge) {
    return <span className="telemetry-deferral">Deferral</span>;
  }
  return null;
}

function RunEventItem({ event }: { event: RunLogEvent }) {
  return (
    <article className="run-timeline-item">
      <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
      <h4>
        {event.event}
        <TelemetryBadges event={event} />
      </h4>
      <p>{event.message}</p>
    </article>
  );
}

export function RunEventTimeline({
  tasks,
  selectedTaskId,
}: {
  tasks: TaskRunStateEnvelope[];
  selectedTaskId: string | null;
}) {
  const visibleTasks = useMemo(
    () =>
      selectedTaskId === null ? tasks : tasks.filter((task) => task.taskId === selectedTaskId),
    [selectedTaskId, tasks],
  );

  const mergedRef = useRef<Record<string, RunLogEvent[]>>({});
  const seenRef = useRef<Record<string, Set<string>>>({});
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    let added = false;

    for (const task of visibleTasks) {
      const seen = seenRef.current[task.taskId] ?? new Set<string>();
      const merged = mergedRef.current[task.taskId] ?? [];
      const newEvents: RunLogEvent[] = [];

      for (const event of task.runEvents) {
        const key = runEventKey(event);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        newEvents.push(event);
      }

      seenRef.current[task.taskId] = seen;

      if (newEvents.length > 0) {
        mergedRef.current[task.taskId] = [...newEvents, ...merged];
        added = true;
      }
    }

    if (added) {
      setRenderVersion((version) => version + 1);
    }
  }, [visibleTasks]);

  void renderVersion;

  return (
    <div className="run-timeline" data-testid="run-timeline">
      {visibleTasks.map((task) => {
        const events = mergedRef.current[task.taskId] ?? task.runEvents;
        return (
          <section key={task.taskId} className="run-timeline-task">
            <h3>Run log · {taskDisplayLabel(task)}</h3>
            <div className="run-timeline-events">
              {events.map((event) => (
                <RunEventItem
                  key={`${task.taskId}-${runEventKey(event)}`}
                  event={event}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
