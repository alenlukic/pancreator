"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findActiveStage,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import {
  buildCommandCenterRows,
  mapComplianceResultsToFindings,
} from "./command-center-data";
import type { ComplianceFindingRow } from "./command-center-types";
import { COMMAND_CENTER_ACTIVE_REVALIDATE_MS } from "./command-center-types";
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

type SuccessfulSnapshot = {
  tasks: TaskRunStateEnvelope[];
  shippedOutcomes: ShippedOutcome[];
  complianceFindings: ComplianceFindingRow[];
  dataFetchedAtMs: number;
};

async function fetchFileContent(path: string): Promise<string | null> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { content?: string };
  return payload.content ?? null;
}

async function loadComplianceFindings(): Promise<{
  findings: ComplianceFindingRow[];
  error: string | null;
}> {
  const historyContent = await fetchFileContent(AUDIT_HISTORY_PATH);
  if (!historyContent) {
    return { findings: [], error: null };
  }
  let history: AuditHistoryFile;
  try {
    history = JSON.parse(historyContent) as AuditHistoryFile;
  } catch {
    return { findings: [], error: null };
  }
  if (!history.entries?.length) {
    return { findings: [], error: null };
  }
  const latest = history.entries[0];
  if (latest?.stage_status === "passed") {
    return { findings: [], error: null };
  }
  const compliancePath = latest?.artifact_paths?.compliance_result;
  if (!compliancePath) {
    return { findings: [], error: null };
  }
  const resultContent = await fetchFileContent(compliancePath);
  if (!resultContent) {
    return {
      findings: mapComplianceResultsToFindings([
        {
          id: "compliance-result",
          pass: false,
          severity: "high",
          blocks: true,
          detail: `Missing artifact ${compliancePath}`,
        },
      ]),
      error: `compliance-result unavailable at ${compliancePath}`,
    };
  }
  try {
    const parsed = JSON.parse(resultContent) as ComplianceResultFile;
    return { findings: mapComplianceResultsToFindings(parsed.results ?? []), error: null };
  } catch {
    return { findings: [], error: "Unable to parse compliance-result.json" };
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
  const [hasLastSuccessfulSnapshot, setHasLastSuccessfulSnapshot] = useState(false);
  const lastSuccessfulSnapshot = useRef<SuccessfulSnapshot | null>(null);

  const loadRunState = useCallback(async () => {
    setRunStateError(null);
    setOutcomesError(null);
    setArchiveError(null);
    try {
      const response = await fetch("/api/run-state?view=attention");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setRunStateError(data.error ?? "Unable to load run state");
        return null;
      }
      const data = (await response.json()) as AttentionRunStatePayload;
      setTasks(data.tasks);
      setShippedOutcomes(data.reconciliation.shippedOutcomes);
      const reconciliationErrors = data.reconciliation.errors ?? {};
      setOutcomesError(reconciliationErrors["feature-index"] ?? null);
      setArchiveError(reconciliationErrors.archive ?? null);
      const fetchedAt = Date.now();
      setDataFetchedAtMs(fetchedAt);
      return { tasks: data.tasks, shippedOutcomes: data.reconciliation.shippedOutcomes, fetchedAt };
    } catch {
      setRunStateError("Unable to load run state");
      return null;
    }
  }, []);

  const loadSupplementary = useCallback(async () => {
    setComplianceError(null);
    try {
      const { findings, error } = await loadComplianceFindings();
      setComplianceFindings(findings);
      if (error) {
        setComplianceError(error);
      }
      return findings;
    } catch {
      setComplianceError("Unable to load compliance findings");
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [runStateResult, findings] = await Promise.all([loadRunState(), loadSupplementary()]);
      if (runStateResult) {
        lastSuccessfulSnapshot.current = {
          tasks: runStateResult.tasks,
          shippedOutcomes: runStateResult.shippedOutcomes,
          complianceFindings: findings,
          dataFetchedAtMs: runStateResult.fetchedAt,
        };
        setHasLastSuccessfulSnapshot(true);
      }
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
      void (async () => {
        const runStateResult = await loadRunState();
        if (runStateResult) {
          lastSuccessfulSnapshot.current = {
            tasks: runStateResult.tasks,
            shippedOutcomes: runStateResult.shippedOutcomes,
            complianceFindings,
            dataFetchedAtMs: runStateResult.fetchedAt,
          };
          setHasLastSuccessfulSnapshot(true);
        }
      })();
    }, COMMAND_CENTER_ACTIVE_REVALIDATE_MS);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [complianceFindings, hasActiveStage, loadRunState]);

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

  const displaySnapshot = useMemo(() => {
    const hasFailure = failedSources.length > 0;
    const lastGood = lastSuccessfulSnapshot.current;
    if (hasFailure && lastGood) {
      return lastGood;
    }
    return {
      tasks,
      shippedOutcomes,
      complianceFindings,
      dataFetchedAtMs: dataFetchedAtMs ?? undefined,
    };
  }, [complianceFindings, dataFetchedAtMs, failedSources.length, hasLastSuccessfulSnapshot, shippedOutcomes, tasks]);

  const cards = useMemo(
    () =>
      buildCommandCenterRows({
        tasks: displaySnapshot.tasks,
        complianceFindings: displaySnapshot.complianceFindings,
        shippedOutcomes: displaySnapshot.shippedOutcomes,
        activityEvents: [],
        nowMs,
        dataFetchedAtMs: displaySnapshot.dataFetchedAtMs,
        failedSources,
      }),
    [displaySnapshot, failedSources, nowMs],
  );

  return {
    cards,
    loading,
    failedSources,
    hasLastSuccessfulSnapshot,
    dataFetchedAtMs: displaySnapshot.dataFetchedAtMs ?? null,
    retry: refresh,
  };
}
