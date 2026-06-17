"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { EmptyState } from "@/components/command-center/shared/EmptyState";
import { ErrorState } from "@/components/command-center/shared/ErrorState";
import { LoadingState } from "@/components/command-center/shared/LoadingState";
import type { MutationReceipt } from "@/services/activity";

type ActivityFilter = "all" | "feature-delivery" | "compliance" | "automations";

const FILTER_OPTIONS: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "feature-delivery", label: "Feature delivery" },
  { id: "compliance", label: "Compliance" },
  { id: "automations", label: "Automations" },
];

function receiptMatchesFilter(receipt: MutationReceipt, filter: ActivityFilter): boolean {
  if (filter === "all") {
    return true;
  }
  const haystack = `${receipt.verb} ${receipt.object} ${receipt.surfaceHref ?? ""}`.toLowerCase();
  if (filter === "feature-delivery") {
    return haystack.includes("mission-control") || haystack.includes("feature") || haystack.includes("gate");
  }
  if (filter === "compliance") {
    return haystack.includes("compliance") || haystack.includes("audit");
  }
  return haystack.includes("automation") || haystack.includes("cron");
}

function ActivityReceiptActions({
  receipt,
  onViewDetails,
}: {
  receipt: MutationReceipt;
  onViewDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="activity-log-receipt-actions">
      {receipt.surfaceHref ? (
        <Link href={receipt.surfaceHref} className="command-center-row-cta-quiet">
          Open run detail
        </Link>
      ) : (
        <button type="button" className="command-center-row-cta-quiet" onClick={onViewDetails}>
          View receipt details
        </button>
      )}
      <div className="command-center-row-overflow-wrap" ref={menuRef}>
        <button
          type="button"
          className="command-center-row-overflow"
          aria-label="Receipt actions"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((current) => !current)}
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </button>
        {open ? (
          <div className="command-center-overflow-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { onViewDetails(); setOpen(false); }}>
              View receipt details
            </button>
            {receipt.artifactLink ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard.writeText(receipt.artifactLink ?? "");
                  setOpen(false);
                }}
              >
                Copy artifact path
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ActivityLogPage() {
  const [receipts, setReceipts] = useState<MutationReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all");
  const [selectedReceipt, setSelectedReceipt] = useState<MutationReceipt | null>(null);

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

  const filteredReceipts = useMemo(
    () => receipts.filter((receipt) => receiptMatchesFilter(receipt, activeFilter)),
    [activeFilter, receipts],
  );

  return (
    <div className="activity-log-page" data-testid="activity-log-page">
      <header className="activity-log-header">
        <h1>Activity Log</h1>
        <p>Mutation receipts for operator and pipeline actions.</p>
      </header>

      <div className="activity-log-filters" role="toolbar" aria-label="Filter receipts">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`activity-log-filter-chip${activeFilter === option.id ? " activity-log-filter-chip-active" : ""}`}
            data-testid={`activity-filter-${option.id}`}
            aria-pressed={activeFilter === option.id}
            onClick={() => setActiveFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState label="Loading receipts" /> : null}
      {error ? <ErrorState message={error} onRetry={() => void loadReceipts()} /> : null}

      {!loading && !error && filteredReceipts.length === 0 ? (
        <EmptyState>
          <h2>No receipts yet</h2>
          <p>State mutations from feature delivery, compliance, and automations appear here.</p>
          <Link href="/command-center" className="command-center-row-cta">
            Open Home
          </Link>
        </EmptyState>
      ) : null}

      {!loading && !error && filteredReceipts.length > 0 ? (
        <div className="activity-log-receipt-list" data-testid="activity-log-receipt-list">
          {filteredReceipts.map((receipt) => (
            <article
              key={receipt.id}
              className="activity-log-receipt-row"
              data-testid="activity-receipt-row"
            >
              <div className="activity-log-receipt-main">
                <p className="activity-log-receipt-verb">
                  <strong>{receipt.verb}</strong> {receipt.object}
                </p>
                <p className="activity-log-receipt-meta">
                  {receipt.actor} · <time dateTime={receipt.timestamp}>{receipt.relativeTime}</time>
                </p>
              </div>
              <ActivityReceiptActions
                receipt={receipt}
                onViewDetails={() => setSelectedReceipt(receipt)}
              />
            </article>
          ))}
        </div>
      ) : null}

      {selectedReceipt ? (
        <div
          className="activity-log-drawer-backdrop"
          data-testid="activity-log-drawer-backdrop"
          onClick={() => setSelectedReceipt(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSelectedReceipt(null);
            }
          }}
          role="presentation"
        >
          <aside
            className="activity-log-drawer"
            data-testid="activity-log-drawer"
            role="dialog"
            aria-label="Receipt details"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="activity-log-drawer-header">
              <h2>Receipt details</h2>
              <button type="button" onClick={() => setSelectedReceipt(null)}>
                Close
              </button>
            </header>
            <dl className="activity-log-drawer-body">
              <div>
                <dt>Actor</dt>
                <dd>{selectedReceipt.actor}</dd>
              </div>
              <div>
                <dt>Verb</dt>
                <dd>{selectedReceipt.verb}</dd>
              </div>
              <div>
                <dt>Object</dt>
                <dd>{selectedReceipt.object}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  <time dateTime={selectedReceipt.timestamp}>{selectedReceipt.relativeTime}</time>
                </dd>
              </div>
              {selectedReceipt.artifactLink ? (
                <div>
                  <dt>Artifact</dt>
                  <dd>
                    <button
                      type="button"
                      className="command-center-row-cta-quiet"
                      onClick={() => void navigator.clipboard.writeText(selectedReceipt.artifactLink ?? "")}
                    >
                      Copy artifact path
                    </button>
                  </dd>
                </div>
              ) : null}
            </dl>
            {selectedReceipt.surfaceHref ? (
              <Link href={selectedReceipt.surfaceHref} className="command-center-row-cta">
                Open run detail for {selectedReceipt.object}
              </Link>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
