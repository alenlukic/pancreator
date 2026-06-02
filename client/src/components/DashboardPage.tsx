"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunLogEvent, StageCell, TaskRunStateEnvelope } from "@/services/run-state";

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

const DOMAINS: Domain[] = [
  {
    id: "inbox",
    path: "lib/inbox",
    label: "Inbox",
    relatesTo: ["work", "memory"],
    blurb: "Incoming directives and operator responses.",
  },
  {
    id: "memory",
    path: "lib/memory",
    label: "Memory",
    relatesTo: ["inbox", "work", "personas"],
    blurb: "Handbook, features, ADRs, and active context.",
  },
  {
    id: "personas",
    path: "lib/personas",
    label: "Personas",
    relatesTo: ["memory", "work"],
    blurb: "Pipeline stage owners and authority boundaries.",
  },
  {
    id: "work",
    path: "work",
    label: "Work",
    relatesTo: ["inbox", "memory", "personas"],
    blurb: "Active pipeline runs and stage artifacts.",
  },
  {
    id: "packages",
    path: "lib/internal/packages",
    label: "Internal Packages",
    relatesTo: ["work", "memory"],
    blurb: "Runtime substrate packages powering pan and runners.",
  },
];

type FileModalState = {
  path: string;
  content: string;
  draft: string;
  open: boolean;
};

type DashboardTab = "cockpit" | "files";

function breadcrumbSegments(repoPath: string): string[] {
  return repoPath.split("/").filter(Boolean);
}

function stageTestId(stageName: string): string {
  return `stage-cell-${stageName.toLowerCase().replace(/_/g, "-")}`;
}

export function StageMachineGrid({ tasks }: { tasks: TaskRunStateEnvelope[] }) {
  return (
    <div className="cockpit-grids">
      {tasks.map((task) => (
        <section key={task.taskId} className="task-cockpit" aria-label={`Pipeline ${task.taskId}`}>
          <h3 className="task-cockpit-title">{task.taskId}</h3>
          {task.sourceWarning ? <p className="source-warning">{task.sourceWarning}</p> : null}
          <div className="stage-grid" data-testid="stage-grid">
            {task.stages.map((stage) => (
              <StageCellCard key={`${task.taskId}-${stage.name}`} stage={stage} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StageCellCard({ stage }: { stage: StageCell }) {
  return (
    <article
      className={`stage-cell stage-cell-${stage.status}`}
      data-testid={stageTestId(stage.name)}
    >
      <header className="stage-cell-header">
        <h4>{stage.name}</h4>
        <span className="stage-cell-persona">{stage.ownerPersona}</span>
      </header>
      {stage.humanGate ? <p className="stage-cell-gate">Gate: {stage.humanGate}</p> : null}
      {stage.status !== "pending" && stage.nextHumanAction ? (
        <p className="stage-cell-action">{stage.nextHumanAction}</p>
      ) : null}
      {stage.status !== "pending" && stage.nextCommand ? (
        <code className="stage-cell-command">{stage.nextCommand}</code>
      ) : null}
    </article>
  );
}

export function RunEventTimeline({ tasks }: { tasks: TaskRunStateEnvelope[] }) {
  return (
    <div className="run-timeline" data-testid="run-timeline">
      {tasks.map((task) => (
        <section key={task.taskId} className="run-timeline-task">
          <h3>Run log · {task.taskId}</h3>
          <div className="run-timeline-events">
            {task.runEvents.map((event) => (
              <RunEventItem key={`${task.taskId}-${event.timestamp}-${event.event}`} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RunEventItem({ event }: { event: RunLogEvent }) {
  return (
    <article className="run-timeline-item">
      <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
      <h4>{event.event}</h4>
      <p>{event.message}</p>
    </article>
  );
}

export function DashboardPage() {
  const [selectedDomain, setSelectedDomain] = useState<Domain>(DOMAINS[0]);
  const [browsePath, setBrowsePath] = useState(DOMAINS[0].path);
  const [entries, setEntries] = useState<RepoListEntry[]>([]);
  const [runState, setRunState] = useState<TaskRunStateEnvelope[]>([]);
  const [modal, setModal] = useState<FileModalState>({
    path: "",
    content: "",
    draft: "",
    open: false,
  });
  const [status, setStatus] = useState<string>("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("cockpit");
  const [filesOpen, setFilesOpen] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadingRunState, setLoadingRunState] = useState(false);

  const relationshipSummary = useMemo(() => {
    return DOMAINS.map((domain) => {
      const peers = domain.relatesTo
        .map((peerId) => DOMAINS.find((candidate) => candidate.id === peerId)?.label)
        .filter(Boolean)
        .join(", ");
      return `${domain.label} ↔ ${peers}`;
    }).join(" · ");
  }, []);

  const loadRunState = useCallback(async () => {
    setLoadingRunState(true);
    try {
      const response = await fetch("/api/run-state");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setRunState([]);
        setStatus(data.error ?? "Unable to load run state");
        return;
      }
      const data = (await response.json()) as TaskRunStateEnvelope[];
      setRunState(data);
    } finally {
      setLoadingRunState(false);
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
    void loadRunState();
  }, [loadRunState]);

  useEffect(() => {
    if (activeTab === "files") {
      void loadEntries(browsePath);
    }
  }, [activeTab, browsePath, loadEntries]);

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
  }

  const crumbs = breadcrumbSegments(browsePath);

  return (
    <div className="app-shell" data-testid="dashboard-root">
      <header className="app-header">
        <div>
          <p className="eyebrow">Pancreator operator dashboard</p>
          <h1>Operator cockpit</h1>
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

        <section className="panel panel-main" aria-label="Dashboard workspace">
          <nav className="dashboard-tabs" aria-label="Dashboard views">
            <button
              type="button"
              className={`dashboard-tab${activeTab === "cockpit" ? " dashboard-tab-active" : ""}`}
              data-testid="tab-cockpit"
              aria-selected={activeTab === "cockpit"}
              onClick={() => setActiveTab("cockpit")}
            >
              Cockpit
            </button>
            <button
              type="button"
              className={`dashboard-tab${activeTab === "files" ? " dashboard-tab-active" : ""}`}
              data-testid="tab-files"
              aria-selected={activeTab === "files"}
              onClick={() => setActiveTab("files")}
            >
              Files
            </button>
          </nav>

          {activeTab === "cockpit" ? (
            <div className="cockpit-view" data-testid="cockpit-view">
              {loadingRunState ? <p className="muted">Loading run state…</p> : null}
              {!loadingRunState && runState.length === 0 ? (
                <p className="cockpit-empty" data-testid="cockpit-empty">
                  No active feature-delivery tasks. Start a run with{" "}
                  <code>pnpm -w exec pan run feature-delivery &lt;inbox-entry&gt;</code>.
                </p>
              ) : null}
              {!loadingRunState && runState.length > 0 ? (
                <>
                  <StageMachineGrid tasks={runState} />
                  <RunEventTimeline tasks={runState} />
                </>
              ) : null}
            </div>
          ) : (
            <section className="panel-browser" aria-label="File browser">
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
                          <button
                            type="button"
                            className="crumb-link"
                            onClick={() => navigateToPath(segmentPath)}
                          >
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
            </section>
          )}

          {status ? <p className="status">{status}</p> : null}
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
