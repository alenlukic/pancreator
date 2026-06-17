"use client";

import { useEffect, useState } from "react";
import {
  collectHumanGateQueue,
  featureDisplayLabel,
  findActiveStage,
  panArgsFromNextCommand,
  taskLevelNextCommand,
  type PanExecuteResult,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { stringifyCompactJson } from "@/lib/json-io";
import { CommandCenterRowOverflow } from "../command-center/CommandCenterRowOverflow";
import { buildTaskOverflow } from "../command-center/command-center-row-helpers";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";
import { ExecuteConfirmModal } from "./ExecuteConfirmModal";
import { ExecuteResultPanel } from "./ExecuteResultPanel";

type PendingExecute = {
  label: string;
  command: string;
};

export function NextActionPanel({
  tasks,
  selectedTaskId,
  dismissedGateKeys,
  loading,
  error,
  onRetry,
  onOpenNextPrompt,
  onOpenRunFolder,
  onExecuteComplete,
}: {
  tasks: TaskRunStateEnvelope[];
  selectedTaskId: string | null;
  dismissedGateKeys: Set<string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenNextPrompt: (runDir: string) => void;
  onOpenRunFolder: (runDir: string) => void;
  onExecuteComplete: () => void;
}) {
  const [executeBusy, setExecuteBusy] = useState(false);
  const [pendingExecute, setPendingExecute] = useState<PendingExecute | null>(null);
  const [executeResult, setExecuteResult] = useState<PanExecuteResult | null>(null);

  useEffect(() => {
    if (pendingExecute === null) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPendingExecute(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pendingExecute]);

  async function runExecute(command: string) {
    setExecuteBusy(true);
    setExecuteResult(null);
    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ command }),
      });
      const payload = (await response.json()) as PanExecuteResult | { error?: string };
      if (!response.ok) {
        setExecuteResult({
          stdout: "",
          stderr: "error" in payload ? String(payload.error) : "Execute failed",
          exitCode: response.status,
        });
        return;
      }
      setExecuteResult(payload as PanExecuteResult);
      onExecuteComplete();
    } catch {
      setExecuteResult({
        stdout: "",
        stderr: "Unable to execute command",
        exitCode: 1,
      });
    } finally {
      setExecuteBusy(false);
      setPendingExecute(null);
    }
  }

  function requestMutatingExecute(label: string, command: string) {
    setPendingExecute({ label, command });
  }

  if (loading) {
    return (
      <section className="next-action-panel" data-testid="next-action-panel" aria-busy="true">
        <h2>Next Action</h2>
        <LoadingState label="Loading run state…" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="next-action-panel" data-testid="next-action-panel">
        <h2>Next Action</h2>
        <ErrorState message={error} onRetry={onRetry} />
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="next-action-panel" data-testid="next-action-panel">
        <h2>Next Action</h2>
        <EmptyState>
          <p>No active feature-delivery tasks.</p>
        </EmptyState>
      </section>
    );
  }

  const selectedTask = tasks.find((task) => task.taskId === selectedTaskId) ?? tasks[0];
  const activeStage = findActiveStage(selectedTask);
  const nextCommand = taskLevelNextCommand(selectedTask);
  const advanceCommand = nextCommand ? panArgsFromNextCommand(nextCommand) : "";
  const dismissedGates = collectHumanGateQueue(tasks).filter((entry) =>
    dismissedGateKeys.has(`${entry.taskId}:${entry.stageName}`),
  );
  const selectedDismissedGates = dismissedGates.filter((entry) => entry.taskId === selectedTask.taskId);

  return (
    <section className="next-action-panel" data-testid="next-action-panel">
      <h2>Next Action</h2>
      <p className="next-action-label">{featureDisplayLabel(selectedTask)}</p>
      {activeStage?.nextHumanAction ? (
        <p className="next-action-human">{activeStage.nextHumanAction}</p>
      ) : null}
      <div className="next-action-actions">
        <CommandCenterRowOverflow {...buildTaskOverflow(selectedTask)} />
        <button
          type="button"
          className="command-center-action-button"
          data-testid="open-next-prompt-button"
          onClick={() => onOpenNextPrompt(selectedTask.runDir)}
        >
          Open next-prompt
        </button>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="open-run-folder-button"
          onClick={() => onOpenRunFolder(selectedTask.runDir)}
        >
          Open run folder
        </button>
      </div>
      <div
        className="execute-action-bar"
        data-testid="execute-action-bar"
        aria-busy={executeBusy}
      >
        <button
          type="button"
          className="command-center-action-button"
          data-testid="execute-advance-button"
          disabled={executeBusy || advanceCommand.length === 0}
          onClick={() => requestMutatingExecute("Advance", advanceCommand)}
        >
          Advance
        </button>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="execute-pause-button"
          disabled={executeBusy}
          onClick={() => requestMutatingExecute("Pause", `pause ${selectedTask.taskId}`)}
        >
          Pause
        </button>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="execute-resume-button"
          disabled={executeBusy}
          onClick={() => requestMutatingExecute("Resume", `resume ${selectedTask.taskId}`)}
        >
          Resume
        </button>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="execute-abort-button"
          disabled={executeBusy}
          onClick={() =>
            requestMutatingExecute(
              "Abort",
              `abort ${selectedTask.taskId} --reason "operator initiated from Command Center"`,
            )
          }
        >
          Abort
        </button>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="execute-check-button"
          disabled={executeBusy}
          onClick={() => void runExecute("check")}
        >
          Check
        </button>
        <span className="execute-batch-status-wrap">
          <button
            type="button"
            className="command-center-action-button"
            data-testid="execute-batch-status-button"
            disabled
          >
            Batch status
          </button>
          <span className="execute-batch-status-helper">
            Batch status subcommand not yet available
          </span>
        </span>
      </div>
      <ExecuteResultPanel result={executeResult} />
      <ExecuteConfirmModal
        command={pendingExecute?.command ?? ""}
        taskLabel={featureDisplayLabel(selectedTask)}
        open={pendingExecute !== null}
        onConfirm={() => {
          if (pendingExecute !== null) {
            void runExecute(pendingExecute.command);
          }
        }}
        onCancel={() => setPendingExecute(null)}
      />
      {selectedDismissedGates.length > 0 ? (
        <div className="next-action-dismissed-gates" data-testid="next-action-dismissed-gates">
          {selectedDismissedGates.map((entry) => (
            <article key={`${entry.taskId}-${entry.stageName}`} className="next-action-dismissed-gate">
              <h4>
                {entry.stageName} · {entry.humanGate}
              </h4>
              <p>{entry.humanAttention || entry.nextHumanAction}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
