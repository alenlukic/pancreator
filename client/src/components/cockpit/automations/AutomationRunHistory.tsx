"use client";

import { useState, type Ref } from "react";
import type { RunRecord } from "@/services/scheduler-runs";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";
import { RunStatusBadge, type RunHistoryStatus } from "../shared/StatusBadge";

function runStatusBadge(status: RunRecord["status"]): RunHistoryStatus {
  if (
    status === "success" ||
    status === "running" ||
    status === "error" ||
    status === "aborted" ||
    status === "skipped"
  ) {
    return status;
  }
  return "success";
}

function formatDuration(startedAt: string, finishedAt?: string): string | null {
  if (!finishedAt) {
    return null;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function RunHistoryRow({
  run,
  rowRef,
}: {
  run: RunRecord;
  rowRef?: Ref<HTMLLIElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatDuration(run.startedAt, run.finishedAt);
  const badgeStatus = runStatusBadge(run.status);
  const skipped = run.status === "skipped";

  return (
    <li
      ref={rowRef}
      className={`automation-run-row${skipped ? " automation-run-row-skipped" : ""}`}
      data-testid={`automation-run-row-${run.runId}`}
    >
      <div className="automation-run-row-header">
        <RunStatusBadge status={badgeStatus} />
        <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time>
        {duration ? <span className="automation-run-duration">{duration}</span> : null}
        <span className="automation-run-trigger-pill">{run.trigger}</span>
        {run.taskId ? (
          <span className="automation-run-task-id" title={run.taskId}>
            {run.taskId}
          </span>
        ) : null}
        <button
          type="button"
          className="cockpit-action-button automation-run-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          data-testid={`automation-run-expand-${run.runId}`}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded ? (
        <div className="automation-run-log-excerpt" data-testid={`automation-run-logs-${run.runId}`}>
          {run.status === "skipped" ? (
            <p className="automation-run-skipped-reason">
              {run.stderrSummary || "Skipped due to concurrency lock."}
            </p>
          ) : null}
          {run.stdoutSummary ? (
            <pre className="automation-run-log-stdout">{run.stdoutSummary}</pre>
          ) : run.stderrSummary ? null : (
            <p className="automation-run-no-output">No output captured.</p>
          )}
          {run.stderrSummary && run.status !== "skipped" ? (
            <pre className="automation-run-log-stderr">{run.stderrSummary}</pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AutomationRunHistory({
  selectedAutomationId,
  selectedAutomationName,
  runs,
  loading,
  error,
  onRefresh,
  onRetry,
  newestRunRef,
}: {
  selectedAutomationId: string | null;
  selectedAutomationName: string | null;
  runs: RunRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRetry: () => void;
  newestRunRef?: Ref<HTMLLIElement>;
}) {
  return (
    <aside className="automation-run-history" data-testid="automation-run-history">
      <div className="automation-run-history-header">
        <h2>Run history</h2>
        {selectedAutomationId ? (
          <div className="automation-run-history-actions">
            {loading && runs.length > 0 ? (
              <span className="automation-run-history-refreshing" aria-live="polite">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="cockpit-action-button"
              onClick={onRefresh}
              disabled={loading}
              aria-busy={loading}
              data-testid="automation-run-history-refresh"
            >
              Refresh
            </button>
          </div>
        ) : null}
      </div>

      {selectedAutomationName ? (
        <p className="automation-run-history-selection">{selectedAutomationName}</p>
      ) : null}

      {!selectedAutomationId ? (
        <EmptyState>
          <p data-testid="automation-run-history-no-selection">
            Select an automation to view run history.
          </p>
        </EmptyState>
      ) : loading && runs.length === 0 ? (
        <LoadingState label="Loading run history…" />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : runs.length === 0 ? (
        <EmptyState>
          <p data-testid="automation-run-history-no-runs">
            No runs yet. Use Run now or wait for the OS scheduler tick.
          </p>
          <p className="automation-run-history-hint">
            See OPERATION.md for cron and launchd setup.
          </p>
        </EmptyState>
      ) : (
        <ul className="automation-run-rows" aria-busy={loading || undefined}>
          {runs.map((run, index) => (
            <RunHistoryRow
              key={run.runId}
              run={run}
              rowRef={index === 0 ? newestRunRef : undefined}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
