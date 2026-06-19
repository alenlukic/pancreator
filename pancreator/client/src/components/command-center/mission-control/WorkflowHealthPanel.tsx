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

  if (loadError !== undefined) {
    return (
      <section className="mc-workflow-health" data-testid="workflow-health-panel">
        <h2>Workflow health</h2>
        <p className="mc-workflow-health-degraded">{loadError}</p>
        <button type="button" className="mc-workflow-health-primary" onClick={onOpenMissionControl}>
          Retry loading run state
        </button>
      </section>
    );
  }

  if (health === undefined) {
    return (
      <section className="mc-workflow-health" data-testid="workflow-health-panel">
        <h2>Workflow health</h2>
        <p className="mc-workflow-health-empty">
          No workflow-health summary yet for {featureDisplayLabel(task)}.
        </p>
        <button type="button" className="mc-workflow-health-primary" onClick={onOpenMissionControl}>
          Refresh run state
        </button>
      </section>
    );
  }

  return (
    <section className="mc-workflow-health" data-testid="workflow-health-panel">
      <div className="mc-workflow-health-header">
        <h2>Workflow health</h2>
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
        <div className="mc-workflow-health-span">
          <dt>Last oversight check</dt>
          <dd>{formatCheckAge(health.last_oversight_check_at)}</dd>
        </div>
      </dl>

      {health.gate_block_reasons !== undefined && health.gate_block_reasons.length > 0 ? (
        <div className="mc-workflow-health-blockers">
          <h3>Gate blocks</h3>
          <ul>
            {health.gate_block_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {companions.some((item) => !item.present || item.blockingReason !== undefined) ? (
        <div className="mc-workflow-health-companions">
          <h3>Companion artifacts</h3>
          <ul>
            {companions
              .filter((item) => !item.present || item.blockingReason !== undefined)
              .map((item) => (
                <li key={item.name}>
                  <strong>{item.name}</strong>
                  <span>{item.blockingReason ?? "Missing companion artifact"}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {pointers.length > 0 ? (
        <div className="mc-workflow-health-pointers">
          <h3>Pointer status</h3>
          <ul>
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
        </div>
      ) : null}

      <details className="mc-workflow-health-disclosure">
        <summary>Show technical paths</summary>
        {showPaths ? null : (
          <button type="button" className="mc-workflow-health-secondary" onClick={() => setShowPaths(true)}>
            Reveal paths for copy
          </button>
        )}
        {showPaths ? (
          <div className="mc-workflow-health-paths">
            <p>{health.run_dir}</p>
            {pointers.map((pointer) => (
              <p key={pointer.referencedPath}>{pointer.referencedPath}</p>
            ))}
          </div>
        ) : null}
      </details>

      <button type="button" className="mc-workflow-health-primary" onClick={onOpenMissionControl}>
        Open remediation steps
      </button>
    </section>
  );
}
