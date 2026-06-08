"use client";

import { useRef, useState } from "react";
import type { AutomationRecord, AutomationSummary } from "@/services/automations-client";
import type { RunRecord } from "@/services/scheduler-runs";
import { EmptyState } from "../shared/EmptyState";
import { StatusBadge, type AutomationStatus } from "../shared/StatusBadge";
import { useFocusTrap } from "../shared/useFocusTrap";

function resolveListBadge(
  automation: AutomationSummary,
  latestRun: RunRecord | undefined,
  runningNow: boolean,
): AutomationStatus {
  if (!automation.enabled) {
    return "paused";
  }
  if (runningNow || latestRun?.status === "running") {
    return "running";
  }
  if (latestRun?.status === "error") {
    return "error";
  }
  return automation.status === "paused" ? "paused" : "scheduled";
}

export function AutomationListView({
  automations,
  selectedAutomationId,
  latestRunsByAutomationId,
  runningAutomationIds,
  onSelect,
  onCreate,
  onEdit,
  onToggleEnabled,
  onDelete,
  onRunNow,
}: {
  automations: AutomationSummary[];
  selectedAutomationId: string | null;
  latestRunsByAutomationId: Record<string, RunRecord | undefined>;
  runningAutomationIds: Set<string>;
  onSelect: (automationId: string) => void;
  onCreate: () => void;
  onEdit: (automationId: string) => void;
  onToggleEnabled: (automation: AutomationSummary, enabled: boolean) => Promise<void>;
  onDelete: (automation: AutomationSummary) => Promise<void>;
  onRunNow: (automation: AutomationSummary) => Promise<void>;
}) {
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDeleteId !== null, deleteDialogRef);

  async function handleToggle(automation: AutomationSummary, enabled: boolean): Promise<void> {
    setPendingToggleId(automation.id);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[automation.id];
      return next;
    });
    try {
      await onToggleEnabled(automation, enabled);
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [automation.id]: error instanceof Error ? error.message : "Unable to update automation.",
      }));
    } finally {
      setPendingToggleId(null);
    }
  }

  async function handleRunNow(automation: AutomationSummary): Promise<void> {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[automation.id];
      return next;
    });
    try {
      await onRunNow(automation);
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [automation.id]: error instanceof Error ? error.message : "Unable to run automation.",
      }));
    }
  }

  return (
    <section className="automations-list">
      <div className="automations-list-header">
        <h2>Automations</h2>
        <button
          type="button"
          className="cockpit-action-button"
          data-testid="automation-create-button"
          onClick={onCreate}
        >
          Create automation
        </button>
      </div>

      {automations.length === 0 ? (
        <EmptyState>
          <p>No automations yet. Create one to schedule recurring agent work.</p>
        </EmptyState>
      ) : (
        <ul className="automation-list-rows">
          {automations.map((automation) => {
            const latestRun = latestRunsByAutomationId[automation.id];
            const runningNow = runningAutomationIds.has(automation.id);
            const listBadge = resolveListBadge(automation, latestRun, runningNow);
            const selected = selectedAutomationId === automation.id;

            return (
              <li
                key={automation.id}
                className={`automation-row${selected ? " automation-row-selected" : ""}`}
                data-testid={`automation-row-${automation.id}`}
              >
                <button
                  type="button"
                  className="automation-row-select"
                  onClick={() => onSelect(automation.id)}
                  data-testid={`automation-select-${automation.id}`}
                >
                  <div className="automation-row-main">
                    <div>
                      <strong>{automation.name}</strong>
                      <p className="automation-schedule">{automation.scheduleLabel}</p>
                      {automation.persona ? (
                        <span className="automation-persona">{automation.persona}</span>
                      ) : null}
                    </div>
                    <StatusBadge status={listBadge} />
                  </div>
                </button>

                <div className="automation-row-controls">
                  <label className="automation-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={automation.enabled}
                      aria-checked={automation.enabled}
                      disabled={pendingToggleId === automation.id}
                      onChange={(event) => void handleToggle(automation, event.target.checked)}
                      data-testid={`automation-toggle-${automation.id}`}
                    />
                    <span>{automation.enabled ? "Enabled" : "Paused"}</span>
                  </label>

                  <div className="automation-row-actions">
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => onEdit(automation.id)}
                      data-testid={`automation-edit-${automation.id}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => void handleToggle(automation, !automation.enabled)}
                    >
                      {automation.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="cockpit-action-button automation-run-now-button"
                      disabled={!automation.enabled || runningNow}
                      aria-busy={runningNow}
                      title={
                        automation.enabled
                          ? "Run this automation now"
                          : "Resume automation to run manually."
                      }
                      onClick={() => void handleRunNow(automation)}
                      data-testid={`automation-run-now-${automation.id}`}
                    >
                      {runningNow ? (
                        <>
                          <span className="automation-run-now-spinner" aria-hidden="true" />
                          Running…
                        </>
                      ) : (
                        "Run now"
                      )}
                    </button>
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => setConfirmDeleteId(automation.id)}
                      data-testid={`automation-delete-${automation.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {rowErrors[automation.id] ? (
                  <p className="automation-row-error">{rowErrors[automation.id]}</p>
                ) : null}

                {confirmDeleteId === automation.id ? (
                  <div
                    ref={deleteDialogRef}
                    className="automation-delete-confirm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={`automation-delete-title-${automation.id}`}
                  >
                    <p id={`automation-delete-title-${automation.id}`}>
                      Delete automation {automation.name}?
                    </p>
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => {
                        void onDelete(automation).finally(() => setConfirmDeleteId(null));
                      }}
                      data-testid={`automation-delete-confirm-${automation.id}`}
                    >
                      Confirm delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type { AutomationRecord };
