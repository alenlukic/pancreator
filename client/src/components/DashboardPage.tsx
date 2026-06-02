"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useMemo, useState } from "react";
import { taskDisplayLabel, type RunLogEvent, type StageCell, type TaskRunStateEnvelope } from "@/services/run-state-shared";

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

const GUARDED_PATH_SEGMENTS = [
  "run.log.jsonl",
  "state.json",
  "handoff.md",
  "next-prompt.md",
] as const;

type FileModalState = {
  path: string;
  content: string;
  draft: string;
  open: boolean;
  isReadOnly: boolean;
  showDiff: boolean;
  writeGuardError: string | null;
};

function computeDiff(original: string, modified: string): string {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const hunks: string[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      hunks.push(` ${oldLines[oldIndex]}`);
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    const nextMatchInNew =
      oldIndex < oldLines.length
        ? newLines.findIndex((line, index) => index >= newIndex && line === oldLines[oldIndex])
        : -1;
    const nextMatchInOld =
      newIndex < newLines.length
        ? oldLines.findIndex((line, index) => index >= oldIndex && line === newLines[newIndex])
        : -1;

    if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length ||
        (nextMatchInOld === -1 && nextMatchInNew !== -1) ||
        (nextMatchInNew !== -1 &&
          (nextMatchInOld === -1 || nextMatchInNew - newIndex <= nextMatchInOld - oldIndex)))
    ) {
      hunks.push(`+${newLines[newIndex]}`);
      newIndex += 1;
      continue;
    }

    if (oldIndex < oldLines.length) {
      hunks.push(`-${oldLines[oldIndex]}`);
      oldIndex += 1;
    }
  }

  return hunks.join("\n");
}

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
        <section
          key={task.taskId}
          className="task-cockpit"
          aria-label={`Pipeline ${taskDisplayLabel(task)}`}
        >
          <h3 className="task-cockpit-title">{taskDisplayLabel(task)}</h3>
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
          <h3>Run log · {taskDisplayLabel(task)}</h3>
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
    isReadOnly: true,
    showDiff: false,
    writeGuardError: null,
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
    setModal({
      path: repoPath,
      content: data.content,
      draft: data.content,
      open: true,
      isReadOnly: true,
      showDiff: false,
      writeGuardError: null,
    });
    setStatus("");
  }

  function enterEditMode() {
    setModal((current) => ({
      ...current,
      isReadOnly: false,
      showDiff: false,
      writeGuardError: null,
    }));
  }

  function requestSaveReview() {
    if (modal.draft === modal.content) {
      return;
    }
    setModal((current) => ({ ...current, showDiff: true, writeGuardError: null }));
  }

  function cancelSaveReview() {
    setModal((current) => ({ ...current, showDiff: false, writeGuardError: null }));
  }

  async function handleEntryClick(entry: RepoListEntry) {
    if (entry.kind === "directory") {
      navigateToPath(entry.path);
      return;
    }
    await openFile(entry.path);
  }

  async function saveFile() {
    const isGuarded = GUARDED_PATH_SEGMENTS.some((segment) => modal.path.endsWith(segment));
    if (isGuarded) {
      setModal((current) => ({
        ...current,
        showDiff: false,
        writeGuardError: `Write blocked: ${modal.path} is a pipeline-owned file.`,
      }));
      return;
    }

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
      showDiff: false,
      writeGuardError: null,
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
            {modal.isReadOnly ? (
              <span data-testid="readonly-indicator">Read-only</span>
            ) : null}
            <textarea
              value={modal.draft}
              readOnly={modal.isReadOnly || modal.showDiff}
              onChange={(event) => setModal((current) => ({ ...current, draft: event.target.value }))}
            />
            {modal.showDiff ? (
              <pre data-testid="diff-view">{computeDiff(modal.content, modal.draft)}</pre>
            ) : null}
            {modal.writeGuardError ? (
              <p className="status" data-testid="write-guard-error">
                {modal.writeGuardError}
              </p>
            ) : null}
            <div className="modal-actions">
              {modal.isReadOnly ? (
                <button type="button" data-testid="edit-button" onClick={enterEditMode}>
                  Edit
                </button>
              ) : null}
              {!modal.isReadOnly && !modal.showDiff ? (
                <button
                  type="button"
                  disabled={modal.draft === modal.content}
                  onClick={requestSaveReview}
                >
                  Save
                </button>
              ) : null}
              {!modal.isReadOnly && modal.showDiff ? (
                <>
                  <button type="button" data-testid="confirm-save" onClick={() => void saveFile()}>
                    Confirm save
                  </button>
                  <button type="button" data-testid="cancel-save" onClick={cancelSaveReview}>
                    Cancel
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setModal((current) => ({ ...current, open: false, writeGuardError: null }))
                }
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
