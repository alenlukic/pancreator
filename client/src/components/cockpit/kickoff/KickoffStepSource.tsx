"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import type { InboxEntrySnapshot } from "@/services/inbox";
import type { KickoffFlowApi } from "./useKickoffFlow";
import type { KickoffSourceKind } from "./kickoff-types";

const SOURCE_TILES: { kind: KickoffSourceKind; title: string; description: string }[] = [
  { kind: "inbox", title: "Inbox item", description: "Pick an existing inbox directive." },
  { kind: "url", title: "Raw URL", description: "Seed a directive from a web page." },
  { kind: "raw-text", title: "Raw text", description: "Paste markdown directly." },
  { kind: "backlog", title: "Feature backlog", description: "Browse ranked backlog items." },
  { kind: "interactive", title: "Interactive intake", description: "Optional Agent Chat branch." },
];

type KickoffStepSourceProps = {
  flow: KickoffFlowApi;
};

export function KickoffStepSource({ flow }: KickoffStepSourceProps) {
  const { state, setSourceKind, selectInboxEntry, setUrl, setRawText, setLoading, setError, applyUrlSeed } =
    flow;
  const [inboxEntries, setInboxEntries] = useState<InboxEntrySnapshot[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [urlInput, setUrlInput] = useState(state.source?.url ?? "");
  const [rawInput, setRawInput] = useState(state.source?.rawText ?? "");
  const [urlFetching, setUrlFetching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInboxLoading(true);

    void (async () => {
      try {
        const response = await fetch("/api/inbox");
        if (!response.ok) {
          throw new Error("Failed to load inbox entries");
        }
        const payload = (await response.json()) as { entries: InboxEntrySnapshot[] };
        if (!cancelled) {
          setInboxEntries(payload.entries);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Failed to load inbox");
        }
      } finally {
        if (!cancelled) {
          setInboxLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setError]);

  const selectedKind = state.source?.kind ?? null;
  const busy = inboxLoading || urlFetching || state.loading;

  async function handleFetchUrlContext() {
    const trimmed = urlInput.trim();
    if (trimmed.length === 0) {
      setError("Enter a page URL first.");
      return;
    }
    setUrlFetching(true);
    setLoading(true, "Fetching page context…");
    setError(null);
    try {
      const response = await fetch("/api/kickoff/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ url: trimmed }),
      });
      const payload = (await response.json()) as {
        directiveSeed?: string;
        error?: string;
      };
      if (!response.ok || payload.directiveSeed === undefined) {
        throw new Error(payload.error ?? "URL summarization failed");
      }
      setUrl(trimmed);
      applyUrlSeed(payload.directiveSeed, trimmed);
    } catch (error) {
      setError(error instanceof Error ? error.message : "URL summarization failed");
    } finally {
      setUrlFetching(false);
      setLoading(false);
    }
  }

  return (
    <section
      className="kickoff-step-panel"
      data-testid="kickoff-step-source"
      aria-busy={busy || undefined}
    >
      <h2 className="kickoff-step-title">Choose source</h2>
      <p className="kickoff-step-helper">Select how you want to seed the feature-delivery directive.</p>

      <div className="kickoff-source-grid" role="list">
        {SOURCE_TILES.map((tile) => {
          const selected = selectedKind === tile.kind;
          return (
            <button
              key={tile.kind}
              type="button"
              className={`kickoff-source-tile${selected ? " kickoff-source-tile-selected" : ""}`}
              data-testid={`kickoff-source-${tile.kind}`}
              onClick={() => setSourceKind(tile.kind)}
              aria-pressed={selected}
            >
              <span className="kickoff-source-tile-title">{tile.title}</span>
              <span className="kickoff-source-tile-desc">{tile.description}</span>
            </button>
          );
        })}
      </div>

      {selectedKind === "inbox" ? (
        <div className="kickoff-inbox-panel">
          {inboxLoading ? (
            <div className="kickoff-skeleton-list" data-testid="kickoff-inbox-skeleton">
              <div className="kickoff-skeleton-row" />
              <div className="kickoff-skeleton-row" />
            </div>
          ) : inboxEntries.length === 0 ? (
            <div className="kickoff-guided-empty">
              <p>No inbox directives yet</p>
              <button
                type="button"
                className="kickoff-btn-secondary"
                onClick={() => {
                  setSourceKind("raw-text");
                }}
              >
                Paste raw text
              </button>
            </div>
          ) : (
            <ul className="kickoff-inbox-list">
              {inboxEntries.map((entry) => (
                <li key={entry.path} className="kickoff-inbox-row">
                  <div className="kickoff-inbox-row-copy">
                    <span className="kickoff-inbox-row-title">{entry.title}</span>
                    <span className="kickoff-inbox-row-meta">{entry.ageHours}h ago</span>
                  </div>
                  <button
                    type="button"
                    className="kickoff-btn-accent-inline"
                    onClick={() => selectInboxEntry(entry)}
                    aria-pressed={state.source?.inboxPath === entry.path}
                  >
                    Select inbox item
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {selectedKind === "url" ? (
        <div className="kickoff-url-panel">
          <label className="kickoff-field-label" htmlFor="kickoff-url-input">
            Paste page URL
          </label>
          <input
            id="kickoff-url-input"
            className="kickoff-text-input"
            type="url"
            value={urlInput}
            onChange={(event) => {
              setUrlInput(event.target.value);
              setUrl(event.target.value);
            }}
            onBlur={() => setUrl(urlInput)}
            placeholder="https://example.com/spec"
          />
          <button
            type="button"
            className="kickoff-btn-secondary"
            onClick={() => void handleFetchUrlContext()}
            disabled={urlFetching}
          >
            Fetch page context
          </button>
        </div>
      ) : null}

      {selectedKind === "raw-text" ? (
        <div className="kickoff-raw-panel">
          <label className="kickoff-field-label" htmlFor="kickoff-raw-input">
            Paste markdown
          </label>
          <textarea
            id="kickoff-raw-input"
            className="kickoff-textarea"
            value={rawInput}
            onChange={(event) => {
              setRawInput(event.target.value);
              setRawText(event.target.value);
            }}
            placeholder="# Feature title&#10;&#10;## Problem&#10;&#10;## Goal"
          />
        </div>
      ) : null}

      {selectedKind === "backlog" ? (
        <div className="kickoff-guided-empty" data-testid="kickoff-backlog-deferred">
          <p>Feature backlog browse UX is deferred. Choose inbox, URL, or raw text instead.</p>
          <div className="kickoff-backlog-alternates">
            <button type="button" className="kickoff-btn-secondary" onClick={() => setSourceKind("inbox")}>
              Choose inbox item
            </button>
            <button type="button" className="kickoff-btn-secondary" onClick={() => setSourceKind("url")}>
              Paste page URL
            </button>
            <button type="button" className="kickoff-btn-secondary" onClick={() => setSourceKind("raw-text")}>
              Paste raw text
            </button>
          </div>
        </div>
      ) : null}

      {selectedKind === "interactive" ? (
        <div className="kickoff-guided-empty kickoff-interactive-callout">
          <p>Interactive intake is optional. You may open Agent Chat or switch to another source.</p>
          <Link href="/agent-chat" className="kickoff-btn-secondary kickoff-link-btn">
            Open agent chat
          </Link>
        </div>
      ) : null}

      {state.error ? (
        <div className="kickoff-error-banner" role="alert">
          {state.error}
        </div>
      ) : null}
    </section>
  );
}
