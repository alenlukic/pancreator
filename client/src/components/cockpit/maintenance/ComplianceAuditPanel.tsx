"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";
import type { OutputLine } from "../shared/OutputStream";

export type ComplianceDescriptorRow = {
  id: string;
  severity: "high" | "medium" | "low";
  triggerModes: string[];
  descriptorPath: string;
};

export type ComplianceResultRow = {
  id: string;
  severity: string;
  pass: boolean;
  blocks?: boolean;
  detail?: string | null;
};

type ComplianceReport = {
  status?: string;
  exitCode?: number;
  results?: ComplianceResultRow[];
};

const AUDIT_HISTORY_PATH = "lib/memory/features/compliance-tests/audit-history.json";

export function ComplianceAuditPanel({
  onOutput,
  onRunStart,
  onOpenAuditHistory,
}: {
  onOutput: (lines: OutputLine[], exitCode: number | null, inFlight: boolean, command?: string) => void;
  onRunStart: () => void;
  onOpenAuditHistory: (path: string) => void;
}) {
  const [descriptors, setDescriptors] = useState<ComplianceDescriptorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const loadDescriptors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/compliance-run");
      if (!response.ok) {
        throw new Error("Unable to load compliance descriptors");
      }
      const data = (await response.json()) as { descriptors: ComplianceDescriptorRow[] };
      setDescriptors(data.descriptors);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load descriptors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDescriptors();
  }, [loadDescriptors]);

  const failedResults = useMemo(
    () => (report?.results ?? []).filter((row) => !row.pass),
    [report],
  );

  async function runCompliance(descriptorId?: string) {
    onRunStart();
    setRunning(true);
    setReport(null);
    const command =
      descriptorId === undefined
        ? "node lib/internal/tools/run-compliance.mjs"
        : `node lib/internal/tools/run-compliance.mjs ${descriptorId}`;
    onOutput([], null, true, command);
    try {
      const response = await fetch("/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson(descriptorId ? { descriptorId } : {}),
      });
      const payload = (await response.json()) as ComplianceReport & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Compliance run failed");
      }
      setReport(payload);
      const lines: OutputLine[] = (payload.results ?? []).map((row) => ({
        stream: row.pass ? "stdout" : "stderr",
        line: `${row.id}: ${row.pass ? "pass" : "fail"}${row.detail ? ` — ${row.detail}` : ""}`,
      }));
      const exitCode =
        payload.exitCode ??
        ((payload.results ?? []).some((row) => row.blocks) ? 1 : payload.status === "fail" ? 1 : 0);
      onOutput(lines, exitCode, false, command);
    } catch (runError) {
      onOutput(
        [{ stream: "stderr", line: runError instanceof Error ? runError.message : "Compliance run failed" }],
        1,
        false,
        command,
      );
    } finally {
      setRunning(false);
    }
  }

  function toggleFinding(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (loading) {
    return <LoadingState label="Loading compliance descriptors…" />;
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={() => void loadDescriptors()} />;
  }

  return (
    <section className="compliance-audit-panel" data-testid="compliance-audit-panel">
      <div className="compliance-audit-header">
        <h2>Compliance audit</h2>
        <div className="compliance-audit-actions">
          <button
            type="button"
            className="cockpit-action-button"
            data-testid="compliance-run-all-button"
            disabled={running}
            aria-busy={running}
            onClick={() => void runCompliance()}
          >
            Run all
          </button>
          <button
            type="button"
            className="cockpit-action-button cockpit-action-button-secondary"
            data-testid="compliance-audit-history-link"
            onClick={() => onOpenAuditHistory(AUDIT_HISTORY_PATH)}
          >
            Audit history
          </button>
        </div>
      </div>

      <table className="compliance-descriptor-table">
        <thead>
          <tr>
            <th scope="col">Descriptor</th>
            <th scope="col">Severity</th>
            <th scope="col">Triggers</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {descriptors.map((descriptor) => {
            const result = report?.results?.find((row) => row.id === descriptor.id);
            return (
              <tr key={descriptor.id} data-testid={`compliance-descriptor-${descriptor.id}`}>
                <td>{descriptor.id}</td>
                <td>
                  <span
                    className={`compliance-severity-badge compliance-severity-${descriptor.severity}`}
                  >
                    {descriptor.severity}
                  </span>
                  {result ? (
                    <span
                      className={`compliance-result-badge compliance-result-${result.pass ? "pass" : "fail"}`}
                      data-testid={`compliance-result-${descriptor.id}`}
                    >
                      {result.pass ? "pass" : "fail"}
                    </span>
                  ) : null}
                </td>
                <td>
                  <ul className="compliance-trigger-list">
                    {descriptor.triggerModes.map((mode) => (
                      <li key={mode} className="compliance-trigger-chip">
                        {mode}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  <button
                    type="button"
                    className="cockpit-action-button"
                    data-testid={`compliance-run-one-${descriptor.id}`}
                    disabled={running}
                    onClick={() => void runCompliance(descriptor.id)}
                  >
                    Run
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {failedResults.length > 0 ? (
        <div className="compliance-findings" data-testid="compliance-findings">
          <h3>Findings</h3>
          <ul className="compliance-findings-list">
            {failedResults.map((row) => (
              <li key={row.id} data-testid={`compliance-finding-${row.id}`}>
                <button
                  type="button"
                  className="compliance-finding-toggle"
                  aria-expanded={expandedIds.has(row.id)}
                  onClick={() => toggleFinding(row.id)}
                >
                  {row.id} ({row.severity})
                </button>
                {expandedIds.has(row.id) ? (
                  <pre className="compliance-finding-detail">{row.detail ?? "No detail provided."}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
