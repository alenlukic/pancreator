"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatActiveMemoryRefreshTime,
  type ActiveMemorySnapshot,
} from "@/services/run-state-shared";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";

const LABEL_MAX_VISIBLE = 60;
const COLLAPSED_CHIP_LIMIT = 3;

function truncateLabel(label: string): { visible: string; full: string } {
  if (label.length <= LABEL_MAX_VISIBLE) {
    return { visible: label, full: label };
  }
  return {
    visible: `${label.slice(0, LABEL_MAX_VISIBLE - 1)}…`,
    full: label,
  };
}

function resolvePrimaryLabel(snapshot: ActiveMemorySnapshot): string {
  if (snapshot.activeFeaturePath === null) {
    return "No active feature — triage inbox or start a run";
  }
  return snapshot.activeFeatureLabel ?? snapshot.activeFeatureSlug ?? "Active feature";
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  async function handleCopy() {
    await navigator.clipboard.writeText(path);
    setCopied(true);
  }

  return (
    <span className="active-memory-copy-wrap">
      <button
        type="button"
        className="active-memory-copy-path"
        data-testid="active-memory-copy-path"
        aria-label="Copy inbox path"
        onClick={() => void handleCopy()}
      >
        <span aria-hidden="true">⎘</span>
      </button>
      {copied ? (
        <span className="active-memory-copy-tooltip" aria-live="polite">
          Copied
        </span>
      ) : null}
    </span>
  );
}

function BlockersChips({ chips }: { chips: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = chips.length > COLLAPSED_CHIP_LIMIT;
  const visibleChips = expanded || !needsToggle ? chips : chips.slice(0, COLLAPSED_CHIP_LIMIT);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className="active-memory-blockers"
      data-testid="active-memory-blockers"
      data-expanded={expanded ? "true" : "false"}
    >
      {visibleChips.map((chip) => (
        <span key={chip} className="active-memory-blocker-chip">
          {chip}
        </span>
      ))}
      {needsToggle ? (
        <button
          type="button"
          className="active-memory-blockers-toggle"
          data-testid="active-memory-blockers-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : "Show all blockers"}
        </button>
      ) : null}
    </div>
  );
}

export function ActiveMemoryHeader({
  onOpenRefreshProcedure,
}: {
  onOpenRefreshProcedure: (filePath: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ActiveMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActiveMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/active-memory");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setSnapshot(null);
        setError(data.error ?? "Unable to load active memory");
        return;
      }
      const data = (await response.json()) as ActiveMemorySnapshot;
      setSnapshot(data);
    } catch {
      setSnapshot(null);
      setError("Unable to load active memory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveMemory();
  }, [loadActiveMemory]);

  const primaryLabel = snapshot === null ? "" : resolvePrimaryLabel(snapshot);
  const { visible: labelVisible, full: labelFull } = truncateLabel(primaryLabel);
  const idle = snapshot?.activeFeaturePath === null;
  const refreshText = formatActiveMemoryRefreshTime(snapshot?.refreshTimestamp ?? null);

  return (
    <section className="active-memory-header" data-testid="active-memory-header" aria-busy={loading}>
      <h2>Active memory</h2>
      {loading ? <LoadingState label="Loading active memory…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void loadActiveMemory()} /> : null}
      {!loading && !error && snapshot !== null ? (
        <>
          <div className="active-memory-label-row">
            <p
              className={`active-memory-label${idle ? " active-memory-label-idle" : ""}`}
              data-testid="active-memory-label"
              title={labelFull.length > LABEL_MAX_VISIBLE ? labelFull : undefined}
            >
              {labelVisible}
            </p>
            {snapshot.activeFeaturePath ? <CopyPathButton path={snapshot.activeFeaturePath} /> : null}
          </div>
          <BlockersChips chips={snapshot.blockerChips} />
          <p className="active-memory-refreshed" data-testid="active-memory-refreshed">
            {snapshot.refreshTimestamp ? (
              <time id="active-memory-refreshed-at" dateTime={snapshot.refreshTimestamp}>
                {refreshText}
              </time>
            ) : (
              refreshText
            )}
          </p>
          <button
            type="button"
            className="cockpit-action-button active-memory-refresh-link"
            data-testid="active-memory-refresh-procedure"
            aria-describedby={snapshot.refreshTimestamp ? "active-memory-refreshed-at" : undefined}
            onClick={() => onOpenRefreshProcedure("OPERATION.md")}
          >
            Open OPERATION.md
          </button>
        </>
      ) : null}
    </section>
  );
}
