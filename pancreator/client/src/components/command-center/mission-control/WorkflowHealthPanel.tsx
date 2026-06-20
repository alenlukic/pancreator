"use client";

import { useMemo, useState } from "react";
import type {
  PointerResolution,
  TaskRunStateEnvelope,
  WorkflowHealthSummary,
} from "@/services/run-state-shared";
import {
  featureDisplayLabel,
  formatLastEventTime,
} from "@/services/run-state-shared";

function pointerChipClass(status: PointerResolution["status"]): string {
  switch (status) {
    case "Live":
      return "mc-pointer-chip mc-pointer-live";
    case "Archived":
      return "mc-pointer-chip mc-pointer-archived";
    case "Missing":
      return "mc-pointer-chip mc-pointer-missing";
    default:
      return "mc-pointer-chip mc-pointer-reconcile";
  }
}

function formatCheckAge(iso: string | undefined): string {
  if (iso === undefined || iso.trim().length === 0) {
    return "No oversight check recorded";
  }
  return `Last check ${formatLastEventTime(iso)}`;
}

async function followPointerAction(pointer: PointerResolution): Promise<void> {
  const target = pointer.resolvedPath ?? pointer.referencedPath;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(target);
  }
}

export function WorkflowHealthPanel({
  task,
  onOpenMissionControl,
}: {
  task: TaskRunStateEnvelope;
  onOpenMissionControl?: () => void;
}) {
  const [showPaths, setShowPaths] = useState(false);
  const health: WorkflowHealthSummary | undefined = task.workflowHealth;
  const loadError = task.workflowHealthLoadError;

  const companions = useMemo(() => health?.companion_artifacts ?? [], [health]);
  const pointers = useMemo(() => health?.pointers ?? [], [health]);
  const lintWarningCount = useMemo(
    () =>
      health?.artifact_lint_warning_count ??
      companions.filter((item) => !item.present || item.blockingReason !== undefined).length,
    [companions, health?.artifact_lint_warning_count],
  );
  const lintStatus = useMemo(
    () =>
      health?.artifact_lint_status ??
      (lintWarningCount > 0 ? "fail" : "pass"),
    [health?.artifact_lint_status, lintWarningCount],
  );
  const warningCount = useMemo(
    () =>
      (health?.findings ?? []).filter(
        (finding) =>
          finding.severity === "warning" || finding.severity === "blocking",
      ).length,
    [health?.findings],
  );

  if (loadError !== undefined) {
    return (
      <section className="mc-workflow-health mc-workflow-health-support" data-testid="workflow-health-panel">
        <h2 className="mc-workflow-health-title">Workflow health</h2>
        <p className="mc-workflow-health-degraded">{loadError}</p>
        <button
          type="button"
          className="mc-workflow-health-quiet"
          onClick={onOpenMissionControl}
        >
          Open workflow health
        </button>
      </section>
    );
  }

  if (health === undefined) {
    return (
      <section className="mc-workflow-health mc-workflow-health-support" data-testid="workflow-health-panel">
        <h2 className="mc-workflow-health-title">Workflow health</h2>
        <p className="mc-workflow-health-empty">
          No workflow-health summary yet for {featureDisplayLabel(task)}.
        </p>
        <button
          type="button"
          className="mc-workflow-health-quiet"
          onClick={onOpenMissionControl}
        >
          Open workflow health
        </button>
      </section>
    );
  }

  return (
    <section className="mc-workflow-health mc-workflow-health-support" data-testid="workflow-health-panel">
      <div className="mc-workflow-health-header">
        <h2 className="mc-workflow-health-title">Workflow health</h2>
        <span className={`mc-workflow-health-status mc-workflow-health-${health.status}`}>
          {health.status.replace(/_/gu, " ")}
        </span>
      </div>

      <dl className="mc-workflow-health-summary-grid">
        <div>
          <dt>Repairs</dt>
          <dd>{health.repair_count}</dd>
        </div>
        <div>
          <dt>Auto-chain reversals</dt>
          <dd>{health.auto_chain_reversal_count}</dd>
        </div>
        <div>
          <dt>Pointer status</dt>
          <dd>{pointers[0]?.status ?? "None recorded"}</dd>
        </div>
        <div>
          <dt>Companion artifacts</dt>
          <dd>
            {companions.filter((item) => item.present).length}/{companions.length || 0} ready
          </dd>
        </div>
        <div>
          <dt>Artifact lint</dt>
          <dd>{`${lintStatus} (${lintWarningCount})`}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{warningCount}</dd>
        </div>
        <div className="mc-workflow-health-span">
          <dt>Last oversight check</dt>
          <dd>{formatCheckAge(health.last_oversight_check_at)}</dd>
        </div>
      </dl>

      {health.gate_block_reasons !== undefined && health.gate_block_reasons.length > 0 ? (
        <details className="mc-workflow-health-details">
          <summary>Gate blocks</summary>
          <ul className="mc-workflow-health-blockers-list">
            {health.gate_block_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {companions.some((item) => !item.present || item.blockingReason !== undefined) ? (
        <details className="mc-workflow-health-details">
          <summary>Companion artifact gaps</summary>
          <ul className="mc-workflow-health-companions-list">
            {companions
              .filter((item) => !item.present || item.blockingReason !== undefined)
              .map((item) => (
                <li key={item.name}>
                  <strong>{item.name}</strong>
                  <span>{item.blockingReason ?? "Missing companion artifact"}</span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      {pointers.length > 0 ? (
        <details className="mc-workflow-health-details">
          <summary>Pointer status</summary>
          <ul className="mc-workflow-health-pointers-list">
            {pointers.map((pointer) => (
              <li key={`${pointer.label}:${pointer.referencedPath}`}>
                <span className={pointerChipClass(pointer.status)}>{pointer.status}</span>
                <span>{pointer.label}</span>
                {pointer.action !== undefined ? (
                  <button
                    type="button"
                    className="mc-workflow-health-secondary"
                    onClick={() => {
                      void followPointerAction(pointer).then(() => setShowPaths(true));
                    }}
                  >
                    {pointer.action}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="mc-workflow-health-disclosure">
        <summary>Reveal technical paths</summary>
        {showPaths ? null : (
          <button
            type="button"
            className="mc-workflow-health-secondary"
            data-testid="workflow-health-reveal-paths"
            onClick={() => setShowPaths(true)}
          >
            Copy or reveal technical paths
          </button>
        )}
        {showPaths ? (
          <div className="mc-workflow-health-paths" data-testid="workflow-health-paths">
            <p>{health.run_dir}</p>
            {pointers.map((pointer) => (
              <p key={pointer.referencedPath}>{pointer.referencedPath}</p>
            ))}
          </div>
        ) : null}
      </details>

      <button
        type="button"
        className="mc-workflow-health-quiet"
        data-testid="workflow-health-open"
        onClick={onOpenMissionControl}
      >
        Open workflow health
      </button>
    </section>
  );
}
