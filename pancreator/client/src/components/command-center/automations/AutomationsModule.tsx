"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import type { AutomationRecord, AutomationSummary } from "@/services/automations-client";
import type { RunRecord } from "@/services/scheduler-runs";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";
import { ActivityReceiptFeed, type ActivityReceipt } from "../shared/ActivityReceiptFeed";
import { AutomationListView } from "./AutomationListView";
import { AutomationRunHistory } from "./AutomationRunHistory";
import { AutomationWizardShell } from "./AutomationWizard/Shell";

type WizardState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; record: AutomationRecord };

export function AutomationsModule() {
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [personas, setPersonas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState>({ mode: "closed" });
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runningAutomationIds, setRunningAutomationIds] = useState<Set<string>>(new Set());
  const [mutationReceipts, setMutationReceipts] = useState<ActivityReceipt[]>([]);
  const [latestRunsByAutomationId, setLatestRunsByAutomationId] = useState<
    Record<string, RunRecord | undefined>
  >({});
  const newestRunRef = useRef<HTMLLIElement>(null);

  const loadAutomations = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/automations");
      if (!response.ok) {
        const data = (await response.json()) as { errors?: string[] };
        throw new Error(data.errors?.join(" ") ?? "Unable to load automations.");
      }
      const data = (await response.json()) as {
        automations: AutomationSummary[];
        personas?: string[];
      };
      setAutomations(data.automations);
      if (data.personas) {
        setPersonas(data.personas);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load automations.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      const response = await fetch("/api/automations");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { personas?: string[] };
      setPersonas(data.personas ?? []);
    } catch {
      setPersonas([]);
    }
  }, []);

  const loadRunHistory = useCallback(async (automationId: string) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const response = await fetch(`/api/automations/${encodeURIComponent(automationId)}/runs`);
      if (!response.ok) {
        const data = (await response.json()) as { errors?: string[] };
        throw new Error(data.errors?.join(" ") ?? "Unable to load run history.");
      }
      const data = (await response.json()) as { runs: RunRecord[] };
      setRuns(data.runs);
    } catch (loadError) {
      setRunsError(loadError instanceof Error ? loadError.message : "Unable to load run history.");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAutomations();
    void loadPersonas();
  }, [loadAutomations, loadPersonas]);

  const loadLatestRunsForList = useCallback(async (automationIds: string[]) => {
    if (automationIds.length === 0) {
      setLatestRunsByAutomationId({});
      return;
    }
    const entries = await Promise.all(
      automationIds.map(async (automationId) => {
        try {
          const response = await fetch(`/api/automations/${encodeURIComponent(automationId)}/runs`);
          if (!response.ok) {
            return [automationId, undefined] as const;
          }
          const data = (await response.json()) as { runs: RunRecord[] };
          return [automationId, data.runs[0]] as const;
        } catch {
          return [automationId, undefined] as const;
        }
      }),
    );
    setLatestRunsByAutomationId(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (!selectedAutomationId) {
      setRuns([]);
      setRunsError(null);
      return;
    }
    void loadRunHistory(selectedAutomationId);
  }, [loadRunHistory, selectedAutomationId]);

  useEffect(() => {
    void loadLatestRunsForList(automations.map((automation) => automation.id));
  }, [automations, loadLatestRunsForList]);

  const listLatestRuns = useMemo(() => {
    const map = { ...latestRunsByAutomationId };
    if (selectedAutomationId && runs[0]) {
      map[selectedAutomationId] = runs[0];
    }
    return map;
  }, [latestRunsByAutomationId, runs, selectedAutomationId]);

  const selectedAutomation =
    automations.find((automation) => automation.id === selectedAutomationId) ?? null;
  const selectedAutomationName = selectedAutomation?.name ?? null;
  const selectedAutomationEnabled = selectedAutomation?.enabled ?? false;

  function appendReceipt(receipt: Omit<ActivityReceipt, "id">): void {
    setMutationReceipts((current) => [
      { ...receipt, id: `${Date.now()}-${current.length}` },
      ...current,
    ].slice(0, 20));
  }

  async function handleToggleEnabled(
    automation: AutomationSummary,
    enabled: boolean,
  ): Promise<void> {
    const detailResponse = await fetch(`/api/automations?id=${encodeURIComponent(automation.id)}`);
    if (!detailResponse.ok) {
      throw new Error("Unable to load automation for update.");
    }
    const record = (await detailResponse.json()) as AutomationRecord;
    const optimistic = automations.map((item) =>
      item.id === automation.id
        ? {
            ...item,
            enabled,
            status: enabled ? ("scheduled" as const) : ("paused" as const),
          }
        : item,
    );
    setAutomations(optimistic);

    const response = await fetch("/api/automations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({ ...record, enabled }),
    });
    if (!response.ok) {
      setAutomations(automations);
      const data = (await response.json()) as { errors?: string[] };
      throw new Error(data.errors?.join(" ") ?? "Unable to update automation.");
    }
    const updated = (await response.json()) as AutomationSummary;
    setAutomations((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    appendReceipt({
      actor: "operator",
      verb: enabled ? "enabled" : "paused",
      object: automation.name,
      timestamp: new Date().toISOString(),
    });
  }

  async function handleDelete(automation: AutomationSummary): Promise<void> {
    const response = await fetch(`/api/automations?id=${encodeURIComponent(automation.id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = (await response.json()) as { errors?: string[] };
      throw new Error(data.errors?.join(" ") ?? "Unable to delete automation.");
    }
    setAutomations((current) => current.filter((item) => item.id !== automation.id));
    if (selectedAutomationId === automation.id) {
      setSelectedAutomationId(null);
    }
    appendReceipt({
      actor: "operator",
      verb: "deleted",
      object: automation.name,
      timestamp: new Date().toISOString(),
    });
  }

  async function openEdit(automationId: string): Promise<void> {
    const response = await fetch(`/api/automations?id=${encodeURIComponent(automationId)}`);
    if (!response.ok) {
      setError("Unable to load automation for edit.");
      return;
    }
    const record = (await response.json()) as AutomationRecord;
    setWizard({ mode: "edit", record });
  }

  async function handleRetryRun(automationId: string): Promise<void> {
    const response = await fetch(`/api/automations/${encodeURIComponent(automationId)}/run`, {
      method: "POST",
    });
    if (!response.ok) {
      const data = (await response.json()) as { errors?: string[] };
      throw new Error(data.errors?.join(" ") ?? "Unable to retry automation run.");
    }
    await loadRunHistory(automationId);
  }

  async function handleRunNow(automation: AutomationSummary): Promise<void> {
    setRunningAutomationIds((current) => new Set(current).add(automation.id));
    try {
      const response = await fetch(`/api/automations/${encodeURIComponent(automation.id)}/run`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json()) as { errors?: string[] };
        throw new Error(data.errors?.join(" ") ?? "Unable to run automation.");
      }
      setSelectedAutomationId(automation.id);
      await loadRunHistory(automation.id);
      appendReceipt({
        actor: "operator",
        verb: "ran",
        object: automation.name,
        timestamp: new Date().toISOString(),
      });
      requestAnimationFrame(() => {
        newestRunRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } finally {
      setRunningAutomationIds((current) => {
        const next = new Set(current);
        next.delete(automation.id);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="automations-module" data-testid="automations-module">
        <LoadingState label="Loading automations…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="automations-module" data-testid="automations-module">
        <ErrorState message={error} onRetry={() => void loadAutomations()} />
      </div>
    );
  }

  return (
    <div className="automations-module" data-testid="automations-module">
      <div className="automations-module-body">
        <AutomationListView
          automations={automations}
          selectedAutomationId={selectedAutomationId}
          latestRunsByAutomationId={listLatestRuns}
          runningAutomationIds={runningAutomationIds}
          onSelect={setSelectedAutomationId}
          onCreate={() => setWizard({ mode: "create" })}
          onEdit={(automationId) => void openEdit(automationId)}
          onToggleEnabled={handleToggleEnabled}
          onDelete={handleDelete}
          onRunNow={handleRunNow}
        />
        <ActivityReceiptFeed receipts={mutationReceipts} testId="automations-receipt-feed" />
        <AutomationRunHistory
          selectedAutomationId={selectedAutomationId}
          selectedAutomationName={selectedAutomationName}
          selectedAutomationEnabled={selectedAutomationEnabled}
          runs={runs}
          loading={runsLoading}
          error={runsError}
          onRefresh={() => {
            if (selectedAutomationId) {
              void loadRunHistory(selectedAutomationId);
            }
          }}
          onRetry={async () => {
            if (!selectedAutomationId) {
              return;
            }
            await handleRetryRun(selectedAutomationId);
          }}
          newestRunRef={newestRunRef}
        />
      </div>

      {wizard.mode !== "closed" ? (
        <AutomationWizardShell
          mode={wizard.mode}
          initialRecord={wizard.mode === "edit" ? wizard.record : undefined}
          personas={personas}
          onClose={() => setWizard({ mode: "closed" })}
          onSaved={loadAutomations}
        />
      ) : null}
    </div>
  );
}
