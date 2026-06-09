"use client";

import {
  collectHumanGateQueue,
  featureDisplayLabel,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { AttentionBanner } from "../shared/AttentionBanner";

const ARTIFACT_FILES = ["plan.md", "review.md", "test-report.md"] as const;

export function HumanGateBanner({
  tasks,
  dismissedGateKeys,
  artifactAvailability,
  onDismissGate,
  onSelectTask,
}: {
  tasks: TaskRunStateEnvelope[];
  dismissedGateKeys: Set<string>;
  artifactAvailability: Record<string, Record<string, boolean>>;
  onDismissGate: (taskId: string, stageName: string) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const queue = collectHumanGateQueue(tasks).filter(
    (entry) => !dismissedGateKeys.has(`${entry.taskId}:${entry.stageName}`),
  );

  if (queue.length === 0) {
    return null;
  }

  return (
    <AttentionBanner title="Human gate queue">
      <div className="human-gate-banner" data-testid="human-gate-banner">
        <ul className="human-gate-queue" data-testid="human-gate-queue">
          {queue.map((entry) => {
            const task = tasks.find((candidate) => candidate.taskId === entry.taskId);
            const label = task ? featureDisplayLabel(task) : entry.taskId;
            const artifacts = artifactAvailability[entry.taskId] ?? {};

            return (
              <li key={`${entry.taskId}-${entry.stageName}`} className="human-gate-row">
                <button
                  type="button"
                  className="human-gate-row-select"
                  onClick={() => onSelectTask(entry.taskId)}
                >
                  <span className="human-gate-task">{label}</span>
                  <span className="human-gate-stage">{entry.stageName}</span>
                  <span className="human-gate-persona">{entry.ownerPersona}</span>
                  <span className="human-gate-status">{entry.status}</span>
                </button>
                <div className="human-gate-artifacts">
                  {ARTIFACT_FILES.map((fileName) =>
                    artifacts[fileName] ? (
                      <a
                        key={fileName}
                        href={`/api/file?path=${encodeURIComponent(`${entry.runDir}/${fileName}`)}`}
                        className="human-gate-artifact-link"
                      >
                        {fileName}
                      </a>
                    ) : (
                      <span key={fileName} className="human-gate-artifact-unavailable">
                        {fileName} unavailable
                      </span>
                    ),
                  )}
                  {entry.inboxSource ? (
                    <a href={`/api/file?path=${encodeURIComponent(entry.inboxSource)}`} className="human-gate-artifact-link">
                      inbox source
                    </a>
                  ) : (
                    <span className="human-gate-artifact-unavailable">inbox source unavailable</span>
                  )}
                </div>
                <button
                  type="button"
                  className="human-gate-dismiss"
                  data-testid={`dismiss-gate-${entry.taskId}-${entry.stageName}`}
                  onClick={() => onDismissGate(entry.taskId, entry.stageName)}
                >
                  Dismiss
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AttentionBanner>
  );
}
