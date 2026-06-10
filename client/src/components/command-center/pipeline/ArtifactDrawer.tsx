"use client";

import { useEffect, useId, useRef } from "react";
import type { StageCell, TaskRunStateEnvelope } from "@/services/run-state-shared";
import { stageArtifactPathsForStage } from "@/services/stage-artifact-contract";

function basename(repoPath: string): string {
  const segments = repoPath.split("/");
  return segments[segments.length - 1] ?? repoPath;
}

export function ArtifactDrawer({
  task,
  stage,
  designSteps,
  artifactPresence,
  onClose,
  onOpenArtifact,
}: {
  task: TaskRunStateEnvelope;
  stage: StageCell;
  designSteps: boolean;
  artifactPresence: Record<string, boolean>;
  onClose: () => void;
  onOpenArtifact: (filePath: string) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  const featureId = task.featureId ?? "unknown-feature";
  const artifactPaths = stageArtifactPathsForStage(
    { featureId, runDir: task.runDir, designSteps },
    stage.name,
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [stage.name, task.taskId]);

  return (
    <>
      <button
        type="button"
        className="artifact-drawer-backdrop"
        aria-label="Close artifact drawer"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="artifact-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="artifact-drawer"
        tabIndex={-1}
      >
        <header className="artifact-drawer-header">
          <div>
            <h3 id={titleId}>{stage.name}</h3>
            <p className="artifact-drawer-meta">
              <span className="artifact-drawer-persona">{stage.ownerPersona}</span>
              <span className={`stage-status-badge stage-status-badge-${stage.status}`}>
                {stage.status}
              </span>
              <span className="artifact-drawer-feature">{featureId}</span>
            </p>
          </div>
          <button type="button" className="artifact-drawer-close" onClick={onClose}>
            Close
          </button>
        </header>
        <ul className="artifact-drawer-list">
          {artifactPaths.map((artifactPath) => {
            const present = artifactPresence[artifactPath] === true;
            return (
              <li key={artifactPath}>
                <button
                  type="button"
                  className={`artifact-drawer-row${present ? "" : " artifact-row-missing"}`}
                  title={artifactPath}
                  disabled={!present}
                  onClick={() => {
                    if (present) {
                      onOpenArtifact(artifactPath);
                    }
                  }}
                >
                  <span className="artifact-drawer-basename">{basename(artifactPath)}</span>
                  <span className="artifact-drawer-path">{artifactPath}</span>
                  {!present ? <span className="artifact-drawer-missing-label">Missing</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
