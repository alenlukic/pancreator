"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useMemo, useState } from "react";

type Domain = {
  id: string;
  path: string;
  label: string;
  relatesTo: string[];
  blurb: string;
};

type RepoListEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

type ActivityEvent = {
  timestamp: string;
  title: string;
  description: string;
};

const DOMAINS: Domain[] = [
  {
    id: "inbox",
    path: "src/inbox",
    label: "Inbox",
    relatesTo: ["work", "memory"],
    blurb: "Incoming directives and operator responses.",
  },
  {
    id: "memory",
    path: "src/memory",
    label: "Memory",
    relatesTo: ["inbox", "work", "personas"],
    blurb: "Handbook, features, ADRs, and active context.",
  },
  {
    id: "personas",
    path: "src/personas",
    label: "Personas",
    relatesTo: ["memory", "work"],
    blurb: "Pipeline stage owners and authority boundaries.",
  },
  {
    id: "work",
    path: "src/work",
    label: "Work",
    relatesTo: ["inbox", "memory", "personas"],
    blurb: "Active pipeline runs and stage artifacts.",
  },
  {
    id: "packages",
    path: "src/internal/packages",
    label: "Internal Packages",
    relatesTo: ["work", "memory"],
    blurb: "Runtime substrate packages powering ddl and runners.",
  },
];

type FileModalState = {
  path: string;
  content: string;
  draft: string;
  open: boolean;
};

function breadcrumbSegments(repoPath: string): string[] {
  return repoPath.split("/").filter(Boolean);
}

export function DashboardPage() {
  const [selectedDomain, setSelectedDomain] = useState<Domain>(DOMAINS[0]);
  const [browsePath, setBrowsePath] = useState(DOMAINS[0].path);
  const [entries, setEntries] = useState<RepoListEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [modal, setModal] = useState<FileModalState>({
    path: "",
    content: "",
    draft: "",
    open: false,
  });
  const [status, setStatus] = useState<string>("");
  const [filesOpen, setFilesOpen] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const relationshipSummary = useMemo(() => {
    return DOMAINS.map((domain) => {
      const peers = domain.relatesTo
        .map((peerId) => DOMAINS.find((candidate) => candidate.id === peerId)?.label)
        .filter(Boolean)
        .join(", ");
      return `${domain.label} ↔ ${peers}`;
    }).join(" · ");
  }, []);

  const loadActivity = useCallback(async () => {
    setLoadingActivity(true);
    try {
      const response = await fetch("/api/activity");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setActivity([]);
        setStatus(data.error ?? "Unable to load activity feed");
        return;
      }
      const data = (await response.json()) as ActivityEvent[];
      setActivity(data);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  const loadEntries = useCallback(async (directoryPath: string) => {
    setLoadingEntries(true);
    try {
      const response = await fetch(`/api/list?path=${encodeURIComponent(directoryPath)}`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setEntries([]);
        setStatus(data.error ?? "Unable to list directory");
        return;
      }
      const data = (await response.json()) as { entries?: RepoListEntry[] };
      setEntries(data.entries ?? []);
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    void loadEntries(browsePath);
  }, [browsePath, loadEntries]);

  function selectDomain(domain: Domain) {
    setSelectedDomain(domain);
    setBrowsePath(domain.path);
    setStatus("");
  }

  function navigateToPath(repoPath: string) {
    setBrowsePath(repoPath);
    setStatus("");
  }

  async function openFile(repoPath: string) {
    const response = await fetch(`/api/file?path=${encodeURIComponent(repoPath)}`);
    const data = (await response.json()) as { content?: string; error?: string };
    if (!response.ok || typeof data.content !== "string") {
      setStatus(data.error ?? "Unable to read file");
      return;
    }
    setModal({ path: repoPath, content: data.content, draft: data.content, open: true });
    setStatus("");
  }

  async function handleEntryClick(entry: RepoListEntry) {
    if (entry.kind === "directory") {
      navigateToPath(entry.path);
      return;
    }
    await openFile(entry.path);
  }

  async function saveFile() {
    const response = await fetch("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: modal.path, content: modal.draft }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Unable to save file");
      return;
    }
    setModal((current) => ({
      ...current,
      content: current.draft,
    }));
    setStatus("Saved without reload");
    await loadActivity();
  }

  const crumbs = breadcrumbSegments(browsePath);

  return (
    <div className="app-shell" data-testid="dashboard-root">
      <header className="app-header">
        <div>
          <p className="eyebrow">Daedaline operator dashboard</p>
          <h1>Repository explorer</h1>
        </div>
        <p className="header-summary">{relationshipSummary}</p>
      </header>

      <main className="dashboard">
        <section className="panel panel-nav" aria-label="Repository domains">
          <h2>Domains</h2>
          <div className="domain-grid">
            {DOMAINS.map((domain) => (
              <article
                key={domain.id}
                className={`domain-card${selectedDomain.id === domain.id ? " domain-card-active" : ""}`}
                data-testid={`domain-${domain.id}`}
              >
                <h3>{domain.label}</h3>
                <p>{domain.blurb}</p>
                <p className="domain-path">{domain.path}/</p>
                <button type="button" onClick={() => selectDomain(domain)}>
                  Open {domain.label}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-browser" aria-label="File browser">
          <div className="browser-header">
            <h2>Files</h2>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              {crumbs.map((segment, index) => {
                const segmentPath = crumbs.slice(0, index + 1).join("/");
                const isLast = index === crumbs.length - 1;
                return (
                  <span key={segmentPath}>
                    {index > 0 ? <span className="crumb-sep">/</span> : null}
                    {isLast ? (
                      <span className="crumb-current">{segment}</span>
                    ) : (
                      <button type="button" className="crumb-link" onClick={() => navigateToPath(segmentPath)}>
                        {segment}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>

          <Collapsible.Root open={filesOpen} onOpenChange={setFilesOpen} className="collapsible-content">
            <Collapsible.Trigger asChild>
              <button type="button" className="toggle-files">
                {filesOpen ? "Hide" : "Show"} entries in {browsePath}/
              </button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              {loadingEntries ? <p className="muted">Loading entries…</p> : null}
              <div className="file-list">
                {browsePath !== selectedDomain.path ? (
                  <button
                    type="button"
                    className="file-entry file-entry-dir"
                    onClick={() => {
                      const parent = browsePath.split("/").slice(0, -1).join("/");
                      navigateToPath(parent || selectedDomain.path);
                    }}
                  >
                    <span className="entry-kind">↩</span>
                    <span>..</span>
                  </button>
                ) : null}
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className={`file-entry${entry.kind === "directory" ? " file-entry-dir" : " file-entry-file"}`}
                    onClick={() => void handleEntryClick(entry)}
                  >
                    <span className="entry-kind">{entry.kind === "directory" ? "▸" : "·"}</span>
                    <span>{entry.name}</span>
                  </button>
                ))}
                {!loadingEntries && entries.length === 0 ? (
                  <p className="muted">No entries in this directory.</p>
                ) : null}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          {status ? <p className="status">{status}</p> : null}
        </section>

        <section className="panel panel-activity" aria-label="Activity feed">
          <h2>Activity</h2>
          {loadingActivity ? <p className="muted">Loading activity…</p> : null}
          <div className="activity-feed" data-testid="activity-feed">
            {!loadingActivity && activity.length === 0 ? (
              <p className="muted">No recent repository activity.</p>
            ) : null}
            {activity.map((event) => (
              <article key={`${event.timestamp}-${event.description}`} className="activity-item">
                <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
                <h4>{event.title}</h4>
                <p>{event.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      {modal.open ? (
        <div className="modal-backdrop" data-testid="file-modal">
          <div className="modal-panel">
            <h3>{modal.path}</h3>
            <textarea
              value={modal.draft}
              onChange={(event) => setModal((current) => ({ ...current, draft: event.target.value }))}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => void saveFile()}>
                Save
              </button>
              <button
                type="button"
                onClick={() => setModal((current) => ({ ...current, open: false }))}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
