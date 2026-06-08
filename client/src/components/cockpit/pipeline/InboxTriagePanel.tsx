"use client";

import { useCallback, useEffect, useState } from "react";
import {
  inboxRunCommand,
  type InboxEntrySnapshot,
} from "@/services/run-state-shared";
import { CopyCommandButton } from "../shared/CopyCommandButton";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";

export function InboxTriagePanel({
  onOpenInboxEntry,
}: {
  onOpenInboxEntry: (filePath: string) => void;
}) {
  const [entries, setEntries] = useState<InboxEntrySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setEntries([]);
        setError(data.error ?? "Unable to load inbox");
        return;
      }
      const data = (await response.json()) as { entries?: InboxEntrySnapshot[] };
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
      setError("Unable to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  return (
    <section className="inbox-triage-panel" data-testid="inbox-triage-panel" aria-busy={loading}>
      <h2>Inbox triage</h2>
      {loading ? <LoadingState label="Loading inbox…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void loadInbox()} /> : null}
      {!loading && !error && entries.length === 0 ? (
        <EmptyState>
          <p>No pending inbox directives</p>
        </EmptyState>
      ) : null}
      {!loading && !error && entries.length > 0 ? (
        <ul className="inbox-triage-list">
          {entries.map((entry) => (
            <li key={entry.path} className="inbox-triage-row" data-testid={`inbox-row-${entry.slug}`}>
              <div className="inbox-row-main">
                <p className="inbox-row-title">{entry.title}</p>
                <p className="inbox-row-slug">{entry.slug}</p>
                <span className="inbox-row-age">{entry.ageHours}h</span>
              </div>
              <div className="inbox-row-actions">
                <CopyCommandButton command={entry.path} label="Copy path" />
                <CopyCommandButton command={inboxRunCommand(entry.path)} label="Copy run command" />
                <button
                  type="button"
                  className="cockpit-action-button"
                  data-testid={`open-inbox-${entry.slug}`}
                  onClick={() => onOpenInboxEntry(entry.path)}
                >
                  Open in Files
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
