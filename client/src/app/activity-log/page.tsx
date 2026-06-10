"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/command-center/shared/EmptyState";
import { ErrorState } from "@/components/command-center/shared/ErrorState";
import { LoadingState } from "@/components/command-center/shared/LoadingState";
import type { MutationReceipt } from "@/services/activity";

export default function ActivityLogPage() {
  const [receipts, setReceipts] = useState<MutationReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/activity");
      if (!response.ok) {
        throw new Error("Unable to load activity receipts");
      }
      const payload = (await response.json()) as { receipts: MutationReceipt[] };
      setReceipts(payload.receipts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load activity receipts");
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  return (
    <div className="activity-log-page" data-testid="activity-log-page">
      <header className="activity-log-header">
        <h1>Activity Log</h1>
        <p>Mutation receipts for operator and pipeline actions.</p>
      </header>

      {loading ? <LoadingState label="Loading receipts" /> : null}
      {error ? <ErrorState message={error} onRetry={() => void loadReceipts()} /> : null}

      {!loading && !error && receipts.length === 0 ? (
        <EmptyState>
          <h2>No receipts yet</h2>
          <p>State mutations from feature delivery, compliance, and automations appear here.</p>
          <Link href="/command-center" className="command-center-row-cta">
            Open Home
          </Link>
        </EmptyState>
      ) : null}

      {!loading && !error && receipts.length > 0 ? (
        <ul className="activity-log-receipt-list" data-testid="activity-log-receipt-list">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="activity-log-receipt-row" data-testid="activity-receipt-row">
              <div className="activity-log-receipt-main">
                <p className="activity-log-receipt-verb">
                  <strong>{receipt.verb}</strong> {receipt.object}
                </p>
                <p className="activity-log-receipt-meta">
                  {receipt.actor} · <time dateTime={receipt.timestamp}>{receipt.relativeTime}</time>
                </p>
              </div>
              <div className="activity-log-receipt-actions">
                {receipt.surfaceHref ? (
                  <Link href={receipt.surfaceHref} className="command-center-row-cta">
                    Open surface
                  </Link>
                ) : null}
                {receipt.artifactLink ? (
                  <button
                    type="button"
                    className="command-center-row-cta-secondary"
                    onClick={() => void navigator.clipboard.writeText(receipt.artifactLink ?? "")}
                  >
                    Copy artifact path
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
