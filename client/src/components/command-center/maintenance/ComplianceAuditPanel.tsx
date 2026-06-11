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

const AUDIT_HISTORY_PATH = "lib/memory/features/quality-governance/compliance-tests/audit-history.json";
const SEVERITY_ORDER = ["high", "medium", "low"] as const;

function descriptorLabel(id: string): string {
  return id.replace(/-/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

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
    () =>
      (report?.results ?? [])
        .filter((row) => !row.pass)
        .sort((left, right) => severityRank(left.severity) - severityRank(right.severity)),
    [report],
  );

  const failuresBySeverity = useMemo(() => {
    const groups = new Map<string, ComplianceResultRow[]>();
    for (const row of failedResults) {
      const bucket = groups.get(row.severity) ?? [];
      bucket.push(row);
      groups.set(row.severity, bucket);
    }
    return groups;
  }, [failedResults]);

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
        line: `${descriptorLabel(row.id)}: ${row.pass ? "pass" : "fail"}${row.detail ? ` — ${row.detail}` : ""}`,
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
        <h2>Compliance + Recovery</h2>
        <div className="compliance-audit-actions">
          <button
            type="button"
            className="command-center-action-button"
            data-testid="compliance-run-all-button"
            disabled={running}
            aria-busy={running}
            onClick={() => void runCompliance()}
          >
            Re-run compliance audit
          </button>
          <button
            type="button"
            className="command-center-action-button-secondary"
            data-testid="compliance-audit-history-link"
            onClick={() => onOpenAuditHistory(AUDIT_HISTORY_PATH)}
          >
            Audit history
          </button>
        </div>
      </div>

      {failedResults.length > 0 ? (
        <div className="compliance-failure-cards" data-testid="compliance-failure-cards">
          <h3>Open findings</h3>
          {SEVERITY_ORDER.map((severity) => {
            const rows = failuresBySeverity.get(severity);
            if (!rows || rows.length === 0) {
              return null;
            }
            return (
              <section
                key={severity}
                className={`compliance-severity-group compliance-severity-group-${severity}`}
                data-testid={`compliance-failures-${severity}`}
              >
                <h4>{severity} severity</h4>
                <div className="compliance-failure-card-grid">
                  {rows.map((row) => (
                    <article
                      key={row.id}
                      className="compliance-failure-card"
                      data-testid={`compliance-failure-card-${row.id}`}
                    >
                      <header className="compliance-failure-card-header">
                        <h5>{descriptorLabel(row.id)}</h5>
                        <span
                          className={`compliance-severity-badge compliance-severity-${row.severity}`}
                        >
                          {row.severity}
                        </span>
                      </header>
                      <p className="compliance-failure-card-summary">
                        {row.detail?.slice(0, 120) ?? "Compliance check failed."}
                      </p>
                      <div className="compliance-failure-card-actions">
                        <button
                          type="button"
                          className="command-center-row-cta-quiet"
                          aria-expanded={expandedIds.has(row.id)}
                          onClick={() => toggleFinding(row.id)}
                        >
                          Review finding
                        </button>
                        <button
                          type="button"
                          className="command-center-row-cta-quiet"
                          onClick={() => void runCompliance(row.id)}
                          disabled={running}
                        >
                          Run recovery for {descriptorLabel(row.id)}
                        </button>
                      </div>
                      {expandedIds.has(row.id) ? (
                        <pre className="compliance-finding-detail">{row.detail ?? "No detail provided."}</pre>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {failedResults.length > 0 ? (
        <div className="compliance-recovery-worklist" data-testid="compliance-recovery-worklist">
          <h3>Recovery worklist</h3>
          <div className="compliance-recovery-rows">
            {failedResults.map((row) => (
              <div key={`recovery:${row.id}`} className="compliance-recovery-row">
                <span>{descriptorLabel(row.id)}</span>
                <button
                  type="button"
                  className="command-center-row-cta-quiet"
                  disabled={running}
                  onClick={() => void runCompliance(row.id)}
                >
                  Run recovery for {descriptorLabel(row.id)}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="compliance-audit-triggers">
        <h3>Audit triggers</h3>
        <div className="compliance-descriptor-list">
          {descriptors.map((descriptor) => {
            const result = report?.results?.find((row) => row.id === descriptor.id);
            const runCommand = `node lib/internal/tools/run-compliance.mjs ${descriptor.id}`;
            return (
              <article
                key={descriptor.id}
                className="compliance-descriptor-card"
                data-testid={`compliance-descriptor-${descriptor.id}`}
              >
                <div className="compliance-descriptor-card-main">
                  <h4>{descriptorLabel(descriptor.id)} audit</h4>
                  <div className="compliance-descriptor-meta">
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
                  </div>
                  <div className="compliance-trigger-chips">
                    {descriptor.triggerModes.map((mode) => (
                      <span key={mode} className="compliance-trigger-chip">
                        {mode}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="compliance-descriptor-card-actions">
                  <button
                    type="button"
                    className="command-center-row-cta-quiet"
                    data-testid={`compliance-run-one-${descriptor.id}`}
                    disabled={running}
                    onClick={() => void runCompliance(descriptor.id)}
                  >
                    Run {descriptorLabel(descriptor.id)} audit
                  </button>
                  <button
                    type="button"
                    className="command-center-row-cta-quiet"
                    onClick={() => void navigator.clipboard.writeText(runCommand)}
                  >
                    Copy run command
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
