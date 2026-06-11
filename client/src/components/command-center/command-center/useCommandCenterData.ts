"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findActiveStage,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import {
  buildCommandCenterRows,
  mapComplianceResultsToFindings,
} from "./command-center-data";
import type { ComplianceFindingRow } from "./command-center-types";
import {
  COMMAND_CENTER_ACTIVE_REVALIDATE_MS,
  COMMAND_CENTER_STALE_DATA_MS,
} from "./command-center-types";
import type { ShippedOutcome } from "@/services/run-state";

const AUDIT_HISTORY_PATH = "lib/memory/features/quality-governance/compliance-tests/audit-history.json";

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

type AttentionRunStatePayload = {
  tasks: TaskRunStateEnvelope[];
  reconciliation: {
    archivedTaskIds: string[];
    shippedOutcomes: ShippedOutcome[];
    shippedTaskIds: string[];
    errors?: Record<string, string>;
  };
};

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

export function useCommandCenterData() {
  const [tasks, setTasks] = useState<TaskRunStateEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [runStateError, setRunStateError] = useState<string | null>(null);
  const [complianceFindings, setComplianceFindings] = useState<ComplianceFindingRow[]>([]);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [shippedOutcomes, setShippedOutcomes] = useState<ShippedOutcome[]>([]);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [dataFetchedAtMs, setDataFetchedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadRunState = useCallback(async () => {
    setRunStateError(null);
    setOutcomesError(null);
    setArchiveError(null);
    try {
      const response = await fetch("/api/run-state?view=attention");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setTasks([]);
        setRunStateError(data.error ?? "Unable to load run state");
        return null;
      }
      const data = (await response.json()) as AttentionRunStatePayload;
      setTasks(data.tasks);
      setShippedOutcomes(data.reconciliation.shippedOutcomes);
      const reconciliationErrors = data.reconciliation.errors ?? {};
      setOutcomesError(reconciliationErrors["feature-index"] ?? null);
      setArchiveError(reconciliationErrors.archive ?? null);
      setDataFetchedAtMs(Date.now());
      return data.tasks;
    } catch {
      setTasks([]);
      setRunStateError("Unable to load run state");
      return null;
    }
  }, []);

  const loadSupplementary = useCallback(async () => {
    setComplianceError(null);
    try {
      const findings = await loadComplianceFindings();
      setComplianceFindings(findings);
    } catch {
      setComplianceError("Unable to load compliance findings");
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
    }, COMMAND_CENTER_ACTIVE_REVALIDATE_MS);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [hasActiveStage, loadRunState]);

  useEffect(() => {
    const elapsedTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, []);

  const failedSources = useMemo(() => {
    const sources: string[] = [];
    if (runStateError) {
      sources.push("run-state");
    }
    if (complianceError) {
      sources.push("compliance");
    }
    if (outcomesError) {
      sources.push("feature-index");
    }
    if (archiveError) {
      sources.push("archive");
    }
    return sources;
  }, [archiveError, complianceError, outcomesError, runStateError]);

  const cards = useMemo(
    () =>
      buildCommandCenterRows({
        tasks,
        complianceFindings,
        shippedOutcomes,
        activityEvents: [],
        nowMs,
        dataFetchedAtMs: dataFetchedAtMs ?? undefined,
        failedSources,
      }),
    [complianceFindings, dataFetchedAtMs, failedSources, nowMs, shippedOutcomes, tasks],
  );

  const hasOperationalRows = useMemo(
    () => cards.some((card) => card.rows.length > 0),
    [cards],
  );

  const isGlobalEmpty = !loading && runStateError === null && !hasOperationalRows;

  const isDataStale = useMemo(() => {
    if (dataFetchedAtMs === null) {
      return false;
    }
    return nowMs - dataFetchedAtMs > COMMAND_CENTER_STALE_DATA_MS;
  }, [dataFetchedAtMs, nowMs]);

  return {
    cards,
    loading,
    runStateError,
    complianceError,
    outcomesError,
    archiveError,
    isGlobalEmpty,
    isDataStale,
    dataFetchedAtMs,
    retry: refresh,
  };
}
