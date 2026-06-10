"use client";

import { useState } from "react";
import { SeverityChip } from "@/components/command-center/shared/SeverityChip";
import { StatusPill, type StatusPillValue } from "@/components/command-center/shared/StatusPill";
import {
  formatLastEventTime,
  runEventActorLabel,
  runEventDisplayLabel,
  type RunLogEvent,
  type StageCell,
} from "@/services/run-state-shared";

function stageStatusPill(status: StageCell["status"]): StatusPillValue {
  switch (status) {
    case "active":
      return "Running";
    case "failed":
      return "Failed";
    case "complete":
      return "Complete";
    default:
      return "Ready";
  }
}

function stageEvents(runEvents: RunLogEvent[], stageName: string): RunLogEvent[] {
  return runEvents.filter((event) => event.stageId === stageName);
}

function newestStageEvent(runEvents: RunLogEvent[], stageName: string): RunLogEvent | null {
  const matching = stageEvents(runEvents, stageName);
  if (matching.length === 0) {
    return null;
  }
  return matching.reduce((newest, event) =>
    Date.parse(event.timestamp) > Date.parse(newest.timestamp) ? event : newest,
  );
}

function hasInternalEventIdentifier(text: string): boolean {
  return text.includes("cursor.runner") || text.includes("pancreator.pipeline");
}

function operatorFacingEventText(event: RunLogEvent): string {
  if (hasInternalEventIdentifier(event.message) || hasInternalEventIdentifier(event.event)) {
    return runEventDisplayLabel(event);
  }
  return event.message;
}

function stageOutputExcerpt(runEvents: RunLogEvent[], stageName: string): string {
  const matching = stageEvents(runEvents, stageName);
  if (matching.length === 0) {
    return "No stage output recorded yet.";
  }
  return matching
    .slice(0, 5)
    .map((event) => operatorFacingEventText(event))
    .join("\n");
}

export function StageDetailPanel({
  stage,
  runEvents,
  nowMs,
}: {
  stage: StageCell;
  runEvents: RunLogEvent[];
  nowMs: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const newest = newestStageEvent(runEvents, stage.name);
  const output = stageOutputExcerpt(runEvents, stage.name);
  const displayOutput = expanded ? output : output.slice(0, 280);
  const modelLabel = newest ? runEventActorLabel(newest) : "—";
  const startTime = formatLastEventTime(
    stageEvents(runEvents, stage.name).at(-1)?.timestamp ?? null,
    nowMs,
  );
  const endTime =
    stage.status === "complete" || stage.status === "failed"
      ? formatLastEventTime(newest?.timestamp ?? null, nowMs)
      : null;

  async function copyOutput() {
    await navigator.clipboard.writeText(displayOutput);
    setCopyFeedback("Copied stage output");
    window.setTimeout(() => setCopyFeedback(null), 2000);
  }

  return (
    <section className="mc-stage-detail-panel" data-testid="stage-detail-panel">
      <header className="mc-stage-detail-header">
        <h2>{stage.name}</h2>
        <div className="mc-stage-detail-meta">
          <span className="mc-stage-detail-persona">{stage.ownerPersona}</span>
          <span className="mc-stage-detail-model">{modelLabel}</span>
          <StatusPill status={stageStatusPill(stage.status)} />
        </div>
      </header>
      <dl className="mc-stage-detail-times">
        <div>
          <dt>Started</dt>
          <dd>{startTime}</dd>
        </div>
        {endTime !== null ? (
          <div>
            <dt>Ended</dt>
            <dd>{endTime}</dd>
          </div>
        ) : null}
      </dl>
      {stage.status === "failed" ? (
        <div className="mc-stage-detail-error" data-testid="stage-detail-error">
          <SeverityChip severity="Critical" />
          <p>
            {newest
              ? operatorFacingEventText(newest)
              : "Stage failed without error excerpt."}
          </p>
        </div>
      ) : null}
      <div className="mc-stage-detail-output-wrap">
        <pre className="mc-stage-detail-output">{displayOutput}</pre>
        {output.length > 280 ? (
          <button
            type="button"
            className="mc-expand-output-btn"
            data-testid="expand-stage-output"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Collapse stage output" : "Expand stage output"}
          </button>
        ) : null}
      </div>
      <div className="mc-stage-detail-actions">
        <button
          type="button"
          className="mc-copy-output-btn"
          data-testid="copy-stage-output"
          onClick={() => void copyOutput()}
        >
          Copy stage output
        </button>
        {copyFeedback ? (
          <span className="mc-copy-feedback" aria-live="polite">
            {copyFeedback}
          </span>
        ) : null}
      </div>
    </section>
  );
}
