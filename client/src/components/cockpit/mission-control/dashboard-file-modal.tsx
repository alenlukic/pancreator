"use client";

import { useCallback, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";

const GUARDED_PATH_SEGMENTS = [
  "run.log.jsonl",
  "state.json",
  "handoff.md",
  "next-prompt.md",
] as const;

type RepoListEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

export type DashboardFileModalState = {
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

export function useDashboardFileModal() {
  const [browsePath, setBrowsePath] = useState(".pan/work");
  const [filesOpen, setFilesOpen] = useState(true);
  const [modal, setModal] = useState<DashboardFileModalState>({
    path: "",
    content: "",
    draft: "",
    open: false,
    isReadOnly: true,
    showDiff: false,
    writeGuardError: null,
  });
  const [status, setStatus] = useState<string>("");

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

  function handleOpenNextPrompt(filePath: string) {
    void openFile(filePath);
  }

  function handleOpenRunFolder(runDir: string) {
    navigateToPath(runDir);
  }

  function handleOpenInboxEntry(filePath: string) {
    const parentPath = filePath.split("/").slice(0, -1).join("/");
    navigateToPath(parentPath || ".pan/work");
    void openFile(filePath);
  }

  function handleOpenRefreshProcedure(filePath: string) {
    void openFile(filePath);
  }

  const saveFile = useCallback(async () => {
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
  }, [modal.draft, modal.path]);

  return {
    browsePath,
    modal,
    status,
    filesOpen,
    setFilesOpen,
    navigateToPath,
    openFile,
    handleOpenArtifact: openFile,
    handleEntryClick,
    handleOpenNextPrompt,
    handleOpenRunFolder,
    handleOpenInboxEntry,
    handleOpenRefreshProcedure,
    enterEditMode,
    requestSaveReview,
    cancelSaveReview,
    saveFile,
    setModal,
  };
}

export function FileModalOverlay({
  modal,
  onEnterEditMode,
  onRequestSaveReview,
  onCancelSaveReview,
  onSaveFile,
  onClose,
  onDraftChange,
}: {
  modal: DashboardFileModalState;
  onEnterEditMode: () => void;
  onRequestSaveReview: () => void;
  onCancelSaveReview: () => void;
  onSaveFile: () => void;
  onClose: () => void;
  onDraftChange: (draft: string) => void;
}) {
  if (!modal.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" data-testid="file-modal">
      <div className="modal-panel">
        <h3>{modal.path}</h3>
        {modal.isReadOnly ? <span data-testid="readonly-indicator">Read-only</span> : null}
        <textarea
          value={modal.draft}
          readOnly={modal.isReadOnly || modal.showDiff}
          onChange={(event) => onDraftChange(event.target.value)}
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
            <button type="button" data-testid="edit-button" onClick={onEnterEditMode}>
              Edit
            </button>
          ) : null}
          {!modal.isReadOnly && !modal.showDiff ? (
            <button
              type="button"
              disabled={modal.draft === modal.content}
              onClick={onRequestSaveReview}
            >
              Save
            </button>
          ) : null}
          {!modal.isReadOnly && modal.showDiff ? (
            <>
              <button type="button" data-testid="confirm-save" onClick={onSaveFile}>
                Confirm save
              </button>
              <button type="button" data-testid="cancel-save" onClick={onCancelSaveReview}>
                Cancel
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
