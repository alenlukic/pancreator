"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExecuteConfirmModal } from "../pipeline/ExecuteConfirmModal";
import { ExecuteResultPanel } from "../pipeline/ExecuteResultPanel";
import {
  FileModalOverlay,
  useDashboardFileModal,
} from "./dashboard-file-modal";
import { stringifyCompactJson } from "@/lib/json-io";
import type { RuntimeConfigSnapshot } from "@/services/config";
import {
  detectRetryLimitFailure,
  featureDisplayLabel,
  filterNonTerminalTasks,
  findActiveStage,
  isNonTerminalTask,
  panArgsFromNextCommand,
  type PanExecuteResult,
  type StageCell,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { MultiRunTable } from "../pipeline/MultiRunTable";
import { ArtifactsByStage } from "./ArtifactsByStage";
import { WorkflowHealthPanel } from "./WorkflowHealthPanel";
import { MISSION_CONTROL_TOAST_EVENT } from "./remediation";
import { MissionControlStageRail } from "./MissionControlStageRail";
import { RetryLimitBanner } from "./RetryLimitBanner";
import { RunContextHeader } from "./RunContextHeader";
import { StageDetailPanel } from "./StageDetailPanel";
import { VerboseLogDrawer } from "./VerboseLogDrawer";

const POLL_INTERVAL_MS = 7500;

export function MissionControlModule() {
  const searchParams = useSearchParams();
  const taskQuery = searchParams.get("task");
  const outcomeQuery = searchParams.get("outcome");
  const outcomeLabelQuery = searchParams.get("label");
  const isShippedOutcomeQuery = outcomeQuery !== null && outcomeQuery.length > 0;
  const shippedOutcomeLabel =
    outcomeLabelQuery !== null && outcomeLabelQuery.length > 0
      ? outcomeLabelQuery
      : outcomeQuery ?? "this shipped outcome";

  const [tasks, setTasks] = useState<TaskRunStateEnvelope[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedStageName, setSelectedStageName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [executeResult, setExecuteResult] = useState<PanExecuteResult | null>(null);
  const [pendingExecute, setPendingExecute] = useState<{ label: string; command: string } | null>(
    null,
  );
  const [config, setConfig] = useState<RuntimeConfigSnapshot | null>(null);

  const file = useDashboardFileModal();

  const loadRunState = useCallback(async (options?: { initial?: boolean }) => {
    const isInitial = options?.initial ?? false;
    if (isInitial) {
      setLoading(true);
    }
    setError(null);
    try {
      const runStateUrl =
        isShippedOutcomeQuery
          ? `/api/run-state?outcome=${encodeURIComponent(outcomeQuery!)}`
          : taskQuery !== null && taskQuery.length > 0
            ? `/api/run-state?task=${encodeURIComponent(taskQuery)}`
            : "/api/run-state";
      const response = await fetch(runStateUrl);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        if (isInitial) {
          setTasks([]);
        }
        setError(data.error ?? "Unable to load run state");
        return null;
      }
      const data = (await response.json()) as TaskRunStateEnvelope[];
      setTasks(data);
      return data;
    } catch {
      if (isInitial) {
        setTasks([]);
      }
      setError("Unable to load run state");
      return null;
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, [isShippedOutcomeQuery, outcomeQuery, taskQuery]);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as RuntimeConfigSnapshot;
      setConfig(data);
    } catch {
      // config is optional for artifact designSteps
    }
  }, []);

  useEffect(() => {
    void loadRunState({ initial: true });
    void loadConfig();
  }, [loadConfig, loadRunState]);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      setToastMessage(detail.message);
      window.setTimeout(() => setToastMessage(null), 3000);
    }
    window.addEventListener(MISSION_CONTROL_TOAST_EVENT, handleToast);
    return () => window.removeEventListener(MISSION_CONTROL_TOAST_EVENT, handleToast);
  }, []);

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
    return () => window.removeEventListener("keydown", onKeyDown);
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
      void loadRunState();
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

  const nonTerminalTasks = useMemo(() => filterNonTerminalTasks(tasks), [tasks]);

  const selectedTask = useMemo(() => {
    if (selectedTaskId !== null) {
      const match = tasks.find((task) => task.taskId === selectedTaskId);
      if (match !== undefined) {
        return match;
      }
    }
    if (taskQuery !== null) {
      const fromQuery = tasks.find((task) => task.taskId === taskQuery);
      if (fromQuery !== undefined) {
        return fromQuery;
      }
    }
    if (isShippedOutcomeQuery && outcomeQuery !== null) {
      const fromOutcome = tasks.find((task) => task.taskId === outcomeQuery);
      if (fromOutcome !== undefined) {
        return fromOutcome;
      }
    }
    return nonTerminalTasks[0] ?? tasks[0] ?? null;
  }, [isShippedOutcomeQuery, nonTerminalTasks, outcomeQuery, selectedTaskId, taskQuery, tasks]);

  useEffect(() => {
    if (selectedTask === null) {
      return;
    }
    setSelectedTaskId(selectedTask.taskId);
    if (selectedStageName === null) {
      const active = findActiveStage(selectedTask);
      if (active !== undefined && active.status !== "pending") {
        setSelectedStageName(active.name);
      }
    }
  }, [selectedStageName, selectedTask]);

  const shouldPoll = useMemo(() => {
    if (selectedTask === null) {
      return false;
    }
    return isNonTerminalTask(selectedTask) && findActiveStage(selectedTask) !== undefined;
  }, [selectedTask]);

  useEffect(() => {
    if (!shouldPoll) {
      setIsPolling(false);
      return undefined;
    }
    setIsPolling(true);
    const pollTimer = window.setInterval(() => {
      void loadRunState();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(pollTimer);
  }, [loadRunState, shouldPoll]);

  useEffect(() => {
    if (!shouldPoll) {
      return undefined;
    }
    const elapsedTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(elapsedTimer);
  }, [shouldPoll]);

  const retryLimitSummary = useMemo(
    () => (selectedTask === null ? null : detectRetryLimitFailure(selectedTask.runEvents)),
    [selectedTask],
  );

  const selectedStage = useMemo(() => {
    if (selectedTask === null || selectedStageName === null) {
      return null;
    }
    const stage = selectedTask.stages.find((item) => item.name === selectedStageName);
    if (stage === undefined || stage.status === "pending") {
      return null;
    }
    return stage;
  }, [selectedStageName, selectedTask]);

  function handleSelectStage(stage: StageCell) {
    if (stage.status === "pending") {
      return;
    }
    setSelectedStageName(stage.name);
  }

  if (loading) {
    return (
      <div className="mission-control-module" data-testid="mission-control-module" aria-busy="true">
        <div className="mc-skeleton" data-testid="mission-control-skeleton">
          Loading mission control…
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    if (isShippedOutcomeQuery) {
      return (
        <div className="mission-control-module" data-testid="mission-control-module">
          <section
            className="mc-empty-state mc-shipped-unavailable"
            data-testid="mission-control-shipped-unavailable"
          >
            <h2>Shipped outcome unavailable</h2>
            <p>
              Unable to open {shippedOutcomeLabel} from the current shipped index entry. The
              shipped record may be missing or no longer resolvable.
            </p>
            <div className="mc-empty-actions">
              <Link href="/command-center" className="command-center-row-cta">
                Return to Home
              </Link>
              <button
                type="button"
                className="command-center-row-cta-quiet"
                data-testid="mc-reload-shipped-outcome"
                onClick={() => void loadRunState({ initial: true })}
              >
                Reload shipped outcome
              </button>
            </div>
          </section>
        </div>
      );
    }

    const emptyTitle =
      taskQuery !== null && taskQuery.length > 0 ? "Outcome not available" : "No active runs";
    const emptyBody =
      taskQuery !== null && taskQuery.length > 0
        ? `Unable to load run detail for ${taskQuery}. The task may not exist under active or archived work paths.`
        : "Start a feature-delivery run from Work Intake or return to Command Center.";
    return (
      <div className="mission-control-module" data-testid="mission-control-module">
        <section className="mc-empty-state" data-testid="mission-control-empty">
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
          <div className="mc-empty-actions">
            {taskQuery === null || taskQuery.length === 0 ? (
              <Link href="/work-intake" className="command-center-start-fd-cta">
                Start feature delivery
              </Link>
            ) : null}
            <Link href="/command-center" className="mc-secondary-link">
              Return to command center
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (selectedTask === null) {
    return (
      <div className="mission-control-module" data-testid="mission-control-module">
        <p className="mc-inline-error">No matching task for selection.</p>
      </div>
    );
  }

  return (
    <div className="mission-control-module" data-testid="mission-control-module">
      {error !== null ? (
        <div className="mc-inline-error" data-testid="mission-control-error">
          <span>{error}</span>
          <button type="button" onClick={() => void loadRunState({ initial: true })}>
            Retry run-state fetch
          </button>
        </div>
      ) : null}
      <div className="mc-run-list-and-detail">
        <MultiRunTable
          tasks={nonTerminalTasks.length > 0 ? nonTerminalTasks : tasks}
          selectedTaskId={selectedTask.taskId}
          nowMs={nowMs}
          onSelectTask={setSelectedTaskId}
        />
        <div className="mc-run-detail-column">
          <RunContextHeader
            task={selectedTask}
            nowMs={nowMs}
            isPolling={isPolling}
            onOpenRunLogs={() => setLogDrawerOpen(true)}
            onRunNextCommand={(nextCommand) => {
              requestMutatingExecute(
                "Run next command",
                panArgsFromNextCommand(nextCommand),
              );
            }}
          />
          {isNonTerminalTask(selectedTask) ? (
            <div className="mc-intervention-strip" data-testid="mission-control-intervention-strip">
              <button
                type="button"
                className="command-center-row-cta-quiet"
                data-testid="mc-intervention-pause"
                disabled={executeBusy}
                aria-label={`Pause ${featureDisplayLabel(selectedTask)}`}
                onClick={() =>
                  requestMutatingExecute("Pause run", `pause ${selectedTask.taskId}`)
                }
              >
                Pause run
              </button>
              <button
                type="button"
                className="command-center-row-cta-quiet"
                data-testid="mc-intervention-steer"
                disabled={executeBusy}
                aria-label={`Open next prompt for ${featureDisplayLabel(selectedTask)}`}
                onClick={() =>
                  file.handleOpenNextPrompt(`${selectedTask.runDir}/next-prompt.md`)
                }
              >
                Open next prompt
              </button>
              <button
                type="button"
                className="command-center-row-cta-quiet mc-intervention-destructive"
                data-testid="mc-intervention-abort"
                disabled={executeBusy}
                aria-label={`Abort ${featureDisplayLabel(selectedTask)}`}
                onClick={() =>
                  requestMutatingExecute(
                    "Abort run",
                    `abort ${selectedTask.taskId} --reason "operator initiated from Command Center"`,
                  )
                }
              >
                Abort run
              </button>
            </div>
          ) : null}
          <ExecuteResultPanel result={executeResult} />
          {retryLimitSummary !== null ? <RetryLimitBanner summary={retryLimitSummary} /> : null}
          <MissionControlStageRail
            task={selectedTask}
            selectedStageName={selectedStageName}
            nowMs={nowMs}
            onSelectStage={handleSelectStage}
          />
          <WorkflowHealthPanel
            task={selectedTask}
            onOpenMissionControl={() => {
              void loadRunState();
            }}
          />
          <div className="mc-workspace">
            {selectedStage !== null ? (
              <StageDetailPanel
                stage={selectedStage}
                runEvents={selectedTask.runEvents}
                nowMs={nowMs}
              />
            ) : (
              <section className="mc-stage-detail-placeholder" data-testid="stage-detail-placeholder">
                Select a stage to view detail.
              </section>
            )}
            <ArtifactsByStage
              task={selectedTask}
              selectedStageName={selectedStageName}
              designSteps={config?.designStepsDefault ?? false}
              onPreviewArtifact={file.handleOpenArtifact}
              onOpenInEditor={(path) => {
                file.handleOpenArtifact(path);
                file.enterEditMode();
              }}
            />
          </div>
        </div>
      </div>
      <VerboseLogDrawer
        open={logDrawerOpen}
        task={selectedTask}
        tasks={tasks}
        onClose={() => setLogDrawerOpen(false)}
      />
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
      {toastMessage !== null ? (
        <div className="mc-toast" data-testid="mission-control-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
      <FileModalOverlay
        modal={file.modal}
        onEnterEditMode={file.enterEditMode}
        onRequestSaveReview={file.requestSaveReview}
        onCancelSaveReview={file.cancelSaveReview}
        onSaveFile={() => void file.saveFile()}
        onClose={() => file.setModal((current) => ({ ...current, open: false }))}
        onDraftChange={(draft) => file.setModal((current) => ({ ...current, draft }))}
      />
    </div>
  );
}
