"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActiveMemorySnapshot } from "@/services/run-state-shared";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";

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

  return (
    <section className="active-memory-header" data-testid="active-memory-header" aria-busy={loading}>
      <h2>Active memory</h2>
      {loading ? <LoadingState label="Loading active memory…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void loadActiveMemory()} /> : null}
      {!loading && !error && snapshot !== null ? (
        <>
          <p
            className="active-memory-path"
            title={snapshot.activeFeaturePath ?? undefined}
            data-testid="active-memory-path"
          >
            {snapshot.activeFeaturePath ?? "(none)"}
          </p>
          {snapshot.blockersSummary ? (
            <p className="active-memory-blockers" data-testid="active-memory-blockers">
              {snapshot.blockersSummary}
            </p>
          ) : null}
          <p className="active-memory-refreshed" data-testid="active-memory-refreshed">
            {snapshot.refreshTimestamp
              ? `Refreshed ${snapshot.refreshTimestamp}`
              : "Refresh timestamp unavailable"}
          </p>
          <button
            type="button"
            className="cockpit-action-button active-memory-refresh-link"
            data-testid="active-memory-refresh-procedure"
            onClick={() => onOpenRefreshProcedure("OPERATION.md")}
          >
            Refresh procedure
          </button>
        </>
      ) : null}
    </section>
  );
}
