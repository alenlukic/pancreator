"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { useCallback, useEffect, useState } from "react";
import { CockpitShell, type CockpitModule } from "@/components/cockpit/layout/CockpitShell";
import { stringifyCompactJson } from "@/lib/json-io";

type RepoListEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

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

function breadcrumbSegments(repoPath: string): string[] {
  return repoPath.split("/").filter(Boolean);
}

export function DashboardPage() {
  const [browsePath, setBrowsePath] = useState(".pan/work");
  const [entries, setEntries] = useState<RepoListEntry[]>([]);
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
  const [activeModule, setActiveModule] = useState<CockpitModule>("pipeline");
  const [filesOpen, setFilesOpen] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);

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
    if (activeModule === "files") {
      void loadEntries(browsePath);
    }
  }, [activeModule, browsePath, loadEntries]);

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
      body: stringifyCompactJson({ path: modal.path, content: modal.draft }),
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

  function handleOpenNextPrompt(filePath: string) {
    setActiveModule("files");
    void openFile(filePath);
  }

  function handleOpenRunFolder(runDir: string) {
    setActiveModule("files");
    navigateToPath(runDir);
  }

  function handleOpenArtifact(filePath: string) {
    setActiveModule("files");
    void openFile(filePath);
  }

  function handleOpenInboxEntry(filePath: string) {
    setActiveModule("files");
    const parentPath = filePath.split("/").slice(0, -1).join("/");
    navigateToPath(parentPath || ".pan/work");
    void openFile(filePath);
  }

  function handleOpenRefreshProcedure(filePath: string) {
    setActiveModule("files");
    void openFile(filePath);
  }

  const crumbs = breadcrumbSegments(browsePath);

  const filesContent = (
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
            {browsePath !== ".pan/work" ? (
              <button
                type="button"
                className="file-entry file-entry-dir"
                onClick={() => {
                  const parent = browsePath.split("/").slice(0, -1).join("/");
                  navigateToPath(parent || ".pan/work");
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
  );

  return (
    <div className="app-shell" data-testid="dashboard-root">
      <header className="app-header">
        <div>
          <p className="eyebrow">Pancreator operator dashboard</p>
          <h1>Operator cockpit</h1>
        </div>
      </header>

      <main className="dashboard dashboard-cockpit-v2">
        <section className="panel panel-main" aria-label="Dashboard workspace">
          <CockpitShell
            filesContent={filesContent}
            activeModule={activeModule}
            onActiveModuleChange={setActiveModule}
            onOpenNextPrompt={handleOpenNextPrompt}
            onOpenRunFolder={handleOpenRunFolder}
            onOpenArtifact={handleOpenArtifact}
            onOpenInboxEntry={handleOpenInboxEntry}
            onOpenRefreshProcedure={handleOpenRefreshProcedure}
          />
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
