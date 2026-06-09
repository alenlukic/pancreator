"use client";

import { useMemo, useRef, useState } from "react";
import {
  filterAutomationSummaries,
  formatNextRunLabel,
  type AutomationRecord,
  type AutomationStatusFilter,
  type AutomationSummary,
} from "@/services/automations-client";
import type { RunRecord } from "@/services/scheduler-runs";
import { formatLastEventTime } from "@/services/run-state-shared";
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

function rowStatusClass(
  automation: AutomationSummary,
  latestRun: RunRecord | undefined,
): string {
  if (!automation.enabled) {
    return " automation-row-paused";
  }
  if (latestRun?.status === "error") {
    return " automation-row-failed";
  }
  return "";
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
  const [confirmPauseAutomation, setConfirmPauseAutomation] = useState<AutomationSummary | null>(
    null,
  );
  const [openOverflowId, setOpenOverflowId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatusFilter>("all");
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const pauseDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDeleteId !== null, deleteDialogRef);
  useFocusTrap(confirmPauseAutomation !== null, pauseDialogRef);

  const filteredAutomations = useMemo(
    () =>
      filterAutomationSummaries(
        automations,
        searchText,
        statusFilter,
        latestRunsByAutomationId,
      ),
    [automations, latestRunsByAutomationId, searchText, statusFilter],
  );

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

  function requestToggle(automation: AutomationSummary, enabled: boolean): void {
    if (!enabled && automation.enabled) {
      setConfirmPauseAutomation(automation);
      return;
    }
    void handleToggle(automation, enabled);
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
    <section className="automations-list-card" data-testid="automations-list-card">
      <div className="automations-list-header">
        <h2>Automations</h2>
        <button
          type="button"
          className="cockpit-action-button cockpit-action-cta"
          data-testid="automation-create-button"
          onClick={onCreate}
        >
          Create automation
        </button>
      </div>

      <div className="automations-list-toolbar">
        <input
          type="search"
          className="automations-list-search"
          aria-label="Search automations"
          placeholder="Search automations"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          data-testid="automations-list-search"
        />
        <div className="automations-list-filters" role="group" aria-label="Automation status filters">
          {(["all", "failed", "paused"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`automations-filter-chip${statusFilter === filter ? " automations-filter-chip-active" : ""}`}
              aria-pressed={statusFilter === filter}
              onClick={() => setStatusFilter(filter)}
              data-testid={`automations-filter-${filter}`}
            >
              {filter === "all" ? "All" : filter === "failed" ? "Failed" : "Paused"}
            </button>
          ))}
        </div>
      </div>

      {automations.length === 0 ? (
        <EmptyState>
          <p>No automations yet. Create one to schedule recurring agent work.</p>
        </EmptyState>
      ) : filteredAutomations.length === 0 ? (
        <EmptyState>
          <p data-testid="automations-list-no-matches">No automations match the current filters.</p>
        </EmptyState>
      ) : (
        <ul className="automation-list-rows">
          {filteredAutomations.map((automation) => {
            const latestRun = latestRunsByAutomationId[automation.id];
            const runningNow = runningAutomationIds.has(automation.id);
            const listBadge = resolveListBadge(automation, latestRun, runningNow);
            const selected = selectedAutomationId === automation.id;
            const lastRunLabel = latestRun
              ? formatLastEventTime(latestRun.startedAt)
              : null;
            const nextRunLabel = automation.enabled
              ? formatNextRunLabel(automation.schedule)
              : null;

            return (
              <li
                key={automation.id}
                className={`automation-row${selected ? " automation-row-selected" : ""}${rowStatusClass(automation, latestRun)}`}
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
                      <strong className="automation-row-label" title={automation.name}>
                        {automation.name}
                      </strong>
                      <p className="automation-schedule">{automation.scheduleLabel}</p>
                      <div className="automation-row-meta">
                        {automation.persona ? (
                          <span className="automation-persona">{automation.persona}</span>
                        ) : null}
                        {lastRunLabel ? (
                          <span className="automation-row-last-run">Last: {lastRunLabel}</span>
                        ) : null}
                        {nextRunLabel ? (
                          <span className="automation-row-next-run">Next: {nextRunLabel}</span>
                        ) : null}
                      </div>
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
                      onChange={(event) => requestToggle(automation, event.target.checked)}
                      data-testid={`automation-toggle-${automation.id}`}
                    />
                    <span>{automation.enabled ? "Enabled" : "Paused"}</span>
                  </label>

                  <div className="automation-row-actions">
                    <button
                      type="button"
                      className="cockpit-action-button cockpit-action-cta automation-run-now-button"
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
                        "Run automation now"
                      )}
                    </button>

                    <div className="automation-row-overflow-wrap">
                      <button
                        type="button"
                        className="automation-row-overflow"
                        aria-expanded={openOverflowId === automation.id}
                        aria-haspopup="menu"
                        onClick={() =>
                          setOpenOverflowId((current) =>
                            current === automation.id ? null : automation.id,
                          )
                        }
                        data-testid={`automation-overflow-${automation.id}`}
                      >
                        ⋯
                      </button>
                      {openOverflowId === automation.id ? (
                        <div className="automation-overflow-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenOverflowId(null);
                              onEdit(automation.id);
                            }}
                            data-testid={`automation-edit-${automation.id}`}
                          >
                            Edit automation
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenOverflowId(null);
                              requestToggle(automation, !automation.enabled);
                            }}
                          >
                            {automation.enabled ? "Pause automation" : "Resume automation"}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenOverflowId(null);
                              setConfirmDeleteId(automation.id);
                            }}
                            data-testid={`automation-delete-${automation.id}`}
                          >
                            Delete automation
                          </button>
                        </div>
                      ) : null}
                    </div>
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
                      Cancel delete automation
                    </button>
                    <button
                      type="button"
                      className="cockpit-action-button"
                      onClick={() => {
                        void onDelete(automation).finally(() => setConfirmDeleteId(null));
                      }}
                      data-testid={`automation-delete-confirm-${automation.id}`}
                    >
                      Confirm delete automation
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {confirmPauseAutomation ? (
        <div
          ref={pauseDialogRef}
          className="automation-pause-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="automation-pause-confirm-title"
          data-testid="automation-pause-confirm"
        >
          <p id="automation-pause-confirm-title">
            Pause automation {confirmPauseAutomation.name}?
          </p>
          <button
            type="button"
            className="cockpit-action-button"
            onClick={() => setConfirmPauseAutomation(null)}
            data-testid="automation-pause-cancel"
          >
            Keep automation enabled
          </button>
          <button
            type="button"
            className="cockpit-action-button cockpit-action-cta"
            onClick={() => {
              const target = confirmPauseAutomation;
              setConfirmPauseAutomation(null);
              void handleToggle(target, false);
            }}
            data-testid="automation-pause-confirm-button"
          >
            Pause automation
          </button>
        </div>
      ) : null}
    </section>
  );
}

export type { AutomationRecord };
