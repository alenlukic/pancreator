"use client";

import { useEffect, useState } from "react";
import { SeverityChip } from "@/components/cockpit/shared/SeverityChip";
import { stageArtifactPathsForStage } from "@/services/stage-artifact-contract";
import type { TaskRunStateEnvelope } from "@/services/run-state-shared";

const FD_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
  "ship",
  "index",
] as const;

function basename(repoPath: string): string {
  const segments = repoPath.split("/");
  return segments[segments.length - 1] ?? repoPath;
}

function artifactLabel(path: string): string {
  const base = basename(path);
  if (base === "spec.md") return "Engineering spec";
  if (base === "plan.md") return "Plan";
  if (base === "review.md") return "Review report";
  if (base === "test-report.md") return "Test report";
  if (base === "implementation-report.md") return "Implementation report";
  if (base === "delivery-report.md") return "Delivery report";
  if (base === "index.json") return "Feature index";
  return base;
}

export function ArtifactsByStage({
  task,
  selectedStageName,
  designSteps,
  onPreviewArtifact,
  onOpenInEditor,
}: {
  task: TaskRunStateEnvelope;
  selectedStageName: string | null;
  designSteps: boolean;
  onPreviewArtifact: (path: string) => void;
  onOpenInEditor: (path: string) => void;
}) {
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const featureId = task.featureId ?? "unknown-feature";

  useEffect(() => {
    const paths = FD_STAGE_ORDER.flatMap((stageName) =>
      stageArtifactPathsForStage({ featureId, runDir: task.runDir, designSteps }, stageName),
    );

    void (async () => {
      const nextPresence: Record<string, boolean> = {};
      await Promise.all(
        paths.map(async (artifactPath) => {
          try {
            const response = await fetch(`/api/file?path=${encodeURIComponent(artifactPath)}`);
            nextPresence[artifactPath] = response.ok;
          } catch {
            nextPresence[artifactPath] = false;
          }
        }),
      );
      setPresence(nextPresence);
    })();
  }, [designSteps, featureId, task.runDir]);

  return (
    <section className="mc-artifacts-by-stage" data-testid="artifacts-by-stage">
      <h2>Artifacts by stage</h2>
      {FD_STAGE_ORDER.map((stageName) => {
        const paths = stageArtifactPathsForStage(
          { featureId, runDir: task.runDir, designSteps },
          stageName,
        );
        const expanded = selectedStageName === stageName;
        const blockingCount = paths.filter((path) => presence[path] !== true).length;

        return (
          <details
            key={stageName}
            className="mc-artifact-group"
            open={expanded}
            data-testid={`artifact-group-${stageName}`}
          >
            <summary className="mc-artifact-group-summary">
              <span>{stageName}</span>
              {blockingCount > 0 ? <SeverityChip severity="Blocking" /> : null}
            </summary>
            {paths.length === 0 ? (
              <p className="mc-artifact-empty">No artifacts for this stage</p>
            ) : (
              <ul className="mc-artifact-list">
                {paths.map((artifactPath) => {
                  const present = presence[artifactPath] === true;
                  return (
                    <li
                      key={artifactPath}
                      className={`mc-artifact-row${present ? "" : " mc-artifact-blocking"}`}
                      data-testid={`artifact-row-${basename(artifactPath)}`}
                    >
                      <div className="mc-artifact-row-main">
                        <span className="mc-artifact-title">{artifactLabel(artifactPath)}</span>
                        {!present ? (
                          <span className="mc-artifact-missing-label">Missing artifact</span>
                        ) : null}
                      </div>
                      <div className="mc-artifact-row-actions">
                        <button
                          type="button"
                          className="mc-preview-artifact-btn"
                          data-testid={`preview-artifact-${basename(artifactPath)}`}
                          disabled={!present}
                          onClick={() => onPreviewArtifact(artifactPath)}
                        >
                          Preview artifact
                        </button>
                        <button
                          type="button"
                          className="mc-open-editor-btn"
                          disabled={!present}
                          onClick={() => onOpenInEditor(artifactPath)}
                        >
                          Open in editor
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        );
      })}
    </section>
  );
}
