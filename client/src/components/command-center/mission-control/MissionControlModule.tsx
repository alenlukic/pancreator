"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileModalOverlay,
  useDashboardFileModal,
} from "./dashboard-file-modal";
import type { RuntimeConfigSnapshot } from "@/services/config";
import {
  detectRetryLimitFailure,
  filterNonTerminalTasks,
  findActiveStage,
  isNonTerminalTask,
  type StageCell,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { ArtifactsByStage } from "./ArtifactsByStage";
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

  const [tasks, setTasks] = useState<TaskRunStateEnvelope[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedStageName, setSelectedStageName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<RuntimeConfigSnapshot | null>(null);

  const file = useDashboardFileModal();

  const loadRunState = useCallback(async (options?: { initial?: boolean }) => {
    const isInitial = options?.initial ?? false;
    if (isInitial) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch("/api/run-state");
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
  }, []);

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
    return nonTerminalTasks[0] ?? tasks[0] ?? null;
  }, [nonTerminalTasks, selectedTaskId, taskQuery, tasks]);

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
    return (
      <div className="mission-control-module" data-testid="mission-control-module">
        <section className="mc-empty-state" data-testid="mission-control-empty">
          <h2>No active runs</h2>
          <p>Start a feature-delivery run from Work Intake or return to Command Center.</p>
          <div className="mc-empty-actions">
            <Link href="/work-intake" className="command-center-start-fd-cta">
              Start feature delivery
            </Link>
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
      <RunContextHeader
        task={selectedTask}
        nowMs={nowMs}
        isPolling={isPolling}
        onOpenRunLogs={() => setLogDrawerOpen(true)}
      />
      {retryLimitSummary !== null ? <RetryLimitBanner summary={retryLimitSummary} /> : null}
      <MissionControlStageRail
        task={selectedTask}
        selectedStageName={selectedStageName}
        nowMs={nowMs}
        onSelectStage={handleSelectStage}
      />
      <div className="mc-workspace">
        {selectedStage !== null ? (
          <StageDetailPanel stage={selectedStage} runEvents={selectedTask.runEvents} nowMs={nowMs} />
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
      <VerboseLogDrawer
        open={logDrawerOpen}
        task={selectedTask}
        tasks={tasks}
        onClose={() => setLogDrawerOpen(false)}
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
