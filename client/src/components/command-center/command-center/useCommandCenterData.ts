"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findActiveStage,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import type { AutomationSummary } from "@/services/automations-client";
import type { RunRecord } from "@/services/scheduler-runs";
import {
  buildCommandCenterRows,
  mapComplianceResultsToFindings,
} from "./command-center-data";
import type { AutomationPreviewRow, ComplianceFindingRow } from "./command-center-types";

const POLL_INTERVAL_MS = 7500;
const AUDIT_HISTORY_PATH = "lib/memory/features/compliance-tests/audit-history.json";

type AuditHistoryEntry = {
  stage_status?: string;
  artifact_paths?: {
    compliance_result?: string;
  };
};

type AuditHistoryFile = {
  entries?: AuditHistoryEntry[];
};

type ComplianceResultFile = {
  results?: Array<{
    id: string;
    pass: boolean;
    severity: string;
    blocks?: boolean;
    detail?: string | null;
  }>;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

async function fetchFileContent(path: string): Promise<string | null> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { content?: string };
  return payload.content ?? null;
}

async function loadComplianceFindings(): Promise<ComplianceFindingRow[]> {
  const historyContent = await fetchFileContent(AUDIT_HISTORY_PATH);
  if (!historyContent) {
    return [];
  }
  let history: AuditHistoryFile;
  try {
    history = JSON.parse(historyContent) as AuditHistoryFile;
  } catch {
    return [];
  }
  if (!history.entries?.length) {
    return [];
  }
  const latest = history.entries[0];
  if (latest?.stage_status === "passed") {
    return [];
  }
  const compliancePath = latest?.artifact_paths?.compliance_result;
  if (!compliancePath) {
    return [];
  }
  const resultContent = await fetchFileContent(compliancePath);
  if (!resultContent) {
    return [];
  }
  try {
    const parsed = JSON.parse(resultContent) as ComplianceResultFile;
    return mapComplianceResultsToFindings(parsed.results ?? []);
  } catch {
    return [];
  }
}

async function loadAutomationPreviews(
  automations: AutomationSummary[],
): Promise<AutomationPreviewRow[]> {
  const previews = await Promise.all(
    automations.slice(0, 5).map(async (automation) => {
      const runs = await fetchJson<{ runs: RunRecord[] }>(
        `/api/automations/${encodeURIComponent(automation.id)}/runs`,
      );
      const latestRun = runs?.runs?.[0];
      const failed = latestRun?.status === "error";
      return {
        automationId: automation.id,
        name: automation.name,
        scheduleLabel: automation.scheduleLabel,
        status: failed ? "failed" : automation.enabled ? automation.status : "paused",
        lastRunAt: latestRun?.startedAt,
        canRetry: failed && automation.enabled,
      } satisfies AutomationPreviewRow;
    }),
  );
  return previews;
}

export function useCommandCenterData() {
  const [tasks, setTasks] = useState<TaskRunStateEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [runStateError, setRunStateError] = useState<string | null>(null);
  const [complianceFindings, setComplianceFindings] = useState<ComplianceFindingRow[]>([]);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [automationRows, setAutomationRows] = useState<AutomationPreviewRow[]>([]);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadRunState = useCallback(async () => {
    setRunStateError(null);
    try {
      const response = await fetch("/api/run-state");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setTasks([]);
        setRunStateError(data.error ?? "Unable to load run state");
        return null;
      }
      const data = (await response.json()) as TaskRunStateEnvelope[];
      setTasks(data);
      return data;
    } catch {
      setTasks([]);
      setRunStateError("Unable to load run state");
      return null;
    }
  }, []);

  const loadSupplementary = useCallback(async () => {
    setComplianceError(null);
    setAutomationError(null);
    try {
      const findings = await loadComplianceFindings();
      setComplianceFindings(findings);
    } catch {
      setComplianceError("Unable to load compliance findings");
    }

    try {
      const automationsPayload = await fetchJson<{ automations: AutomationSummary[] }>(
        "/api/automations",
      );
      const automations = automationsPayload?.automations ?? [];
      if (automations.length === 0) {
        setAutomationRows([]);
      } else {
        setAutomationRows(await loadAutomationPreviews(automations));
      }
    } catch {
      setAutomationError("Unable to load automations");
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadRunState(), loadSupplementary()]);
    } finally {
      setLoading(false);
    }
  }, [loadRunState, loadSupplementary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActiveStage = useMemo(
    () => tasks.some((task) => findActiveStage(task) !== undefined),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveStage) {
      return undefined;
    }
    const pollTimer = window.setInterval(() => {
      void loadRunState();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [hasActiveStage, loadRunState]);

  useEffect(() => {
    if (!hasActiveStage) {
      return undefined;
    }
    const elapsedTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, [hasActiveStage]);

  const cards = useMemo(
    () =>
      buildCommandCenterRows({
        tasks,
        complianceFindings,
        automationRows,
        activityEvents: [],
        nowMs,
      }),
    [automationRows, complianceFindings, nowMs, tasks],
  );

  const hasOperationalRows = useMemo(
    () => cards.some((card) => card.rows.length > 0),
    [cards],
  );

  const isGlobalEmpty = !loading && runStateError === null && !hasOperationalRows;

  return {
    cards,
    loading,
    runStateError,
    complianceError,
    automationError,
    isGlobalEmpty,
    retry: refresh,
  };
}
