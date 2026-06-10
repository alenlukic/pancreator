"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeConfigSnapshot } from "@/services/config";
import {
  filterNonTerminalTasks,
  findActiveStage,
  type StageCell,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { ActiveMemoryHeader } from "./ActiveMemoryHeader";
import { ArtifactDrawer } from "./ArtifactDrawer";
import { ConfigReadOnlyPanel } from "./ConfigReadOnlyPanel";
import { HumanGateBanner } from "./HumanGateBanner";
import { InboxTriagePanel } from "./InboxTriagePanel";
import { MultiRunTable } from "./MultiRunTable";
import { NextActionPanel } from "./NextActionPanel";
import { PreCloseValidationPanel } from "../maintenance/PreCloseValidationPanel";
import { RunEventTimeline } from "./RunEventTimeline";
import { StageMachineGrid } from "./StageMachineGrid";

const ARTIFACT_FILES = ["plan.md", "review.md", "test-report.md"] as const;
const POLL_INTERVAL_MS = 7500;

export function PipelineModule({
  onOpenNextPrompt,
  onOpenRunFolder,
  onOpenArtifact,
  onOpenInboxEntry,
  onOpenRefreshProcedure,
  onNavigateToMaintenance,
}: {
  onOpenNextPrompt: (filePath: string) => void;
  onOpenRunFolder: (runDir: string) => void;
  onOpenArtifact: (filePath: string) => void;
  onOpenInboxEntry: (filePath: string) => void;
  onOpenRefreshProcedure: (filePath: string) => void;
  onNavigateToMaintenance: () => void;
}) {
  const [tasks, setTasks] = useState<TaskRunStateEnvelope[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dismissedGateKeys, setDismissedGateKeys] = useState<Set<string>>(() => new Set());
  const [loadingRunState, setLoadingRunState] = useState(false);
  const [runStateError, setRunStateError] = useState<string | null>(null);
  const [config, setConfig] = useState<RuntimeConfigSnapshot | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [artifactAvailability, setArtifactAvailability] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [isPolling, setIsPolling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [drawerTarget, setDrawerTarget] = useState<{
    task: TaskRunStateEnvelope;
    stage: StageCell;
  } | null>(null);
  const [drawerArtifactPresence, setDrawerArtifactPresence] = useState<Record<string, boolean>>(
    {},
  );

  const loadRunState = useCallback(async (options?: { initial?: boolean }) => {
    const isInitial = options?.initial ?? false;
    if (isInitial) {
      setLoadingRunState(true);
    }
    setRunStateError(null);
    try {
      const response = await fetch("/api/run-state");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        if (isInitial) {
          setTasks([]);
        }
        setRunStateError(data.error ?? "Unable to load run state");
        return null;
      }
      const data = (await response.json()) as TaskRunStateEnvelope[];
      setTasks(data);
      setSelectedTaskId((current) => current ?? data[0]?.taskId ?? null);
      return data;
    } catch {
      if (isInitial) {
        setTasks([]);
      }
      setRunStateError("Unable to load run state");
      return null;
    } finally {
      if (isInitial) {
        setLoadingRunState(false);
      }
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const response = await fetch("/api/config");
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setConfig(null);
        setConfigError(data.error ?? "Unable to load configuration");
        return;
      }
      const data = (await response.json()) as RuntimeConfigSnapshot;
      setConfig(data);
    } catch {
      setConfig(null);
      setConfigError("Unable to load configuration");
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const loadArtifactAvailability = useCallback(async (nextTasks: TaskRunStateEnvelope[]) => {
    const availability: Record<string, Record<string, boolean>> = {};

    await Promise.all(
      nextTasks.map(async (task) => {
        const taskAvailability: Record<string, boolean> = {};
        await Promise.all(
          ARTIFACT_FILES.map(async (fileName) => {
            const filePath = `${task.runDir}/${fileName}`;
            const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
            taskAvailability[fileName] = response.ok;
          }),
        );
        availability[task.taskId] = taskAvailability;
      }),
    );

    setArtifactAvailability(availability);
  }, []);

  const loadDrawerArtifactPresence = useCallback(
    async (task: TaskRunStateEnvelope, stage: StageCell) => {
      const { stageArtifactPathsForStage } = await import("@/services/stage-artifact-contract");
      const featureId = task.featureId ?? "unknown-feature";
      const paths = stageArtifactPathsForStage(
        {
          featureId,
          runDir: task.runDir,
          designSteps: config?.designStepsDefault ?? false,
        },
        stage.name,
      );
      const presence: Record<string, boolean> = {};
      await Promise.all(
        paths.map(async (artifactPath) => {
          const response = await fetch(`/api/file?path=${encodeURIComponent(artifactPath)}`);
          presence[artifactPath] = response.ok;
        }),
      );
      setDrawerArtifactPresence(presence);
    },
    [config?.designStepsDefault],
  );

  useEffect(() => {
    void loadRunState({ initial: true });
    void loadConfig();
  }, [loadConfig, loadRunState]);

  useEffect(() => {
    if (tasks.length === 0) {
      setArtifactAvailability({});
      return;
    }
    void loadArtifactAvailability(tasks);
  }, [loadArtifactAvailability, tasks]);

  const hasActiveStage = useMemo(
    () => tasks.some((task) => findActiveStage(task) !== undefined),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveStage) {
      setIsPolling(false);
      return undefined;
    }

    setIsPolling(true);
    const pollTimer = window.setInterval(() => {
      void loadRunState();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollTimer);
    };
  }, [hasActiveStage, loadRunState]);

  useEffect(() => {
    if (!hasActiveStage) {
      return undefined;
    }
    const elapsedTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, [hasActiveStage]);

  useEffect(() => {
    if (drawerTarget === null) {
      return;
    }
    void loadDrawerArtifactPresence(drawerTarget.task, drawerTarget.stage);
  }, [drawerTarget, loadDrawerArtifactPresence]);

  const selectedTaskIdResolved = useMemo(() => {
    if (selectedTaskId !== null && tasks.some((task) => task.taskId === selectedTaskId)) {
      return selectedTaskId;
    }
    return tasks[0]?.taskId ?? null;
  }, [selectedTaskId, tasks]);

  const nonTerminalTasks = useMemo(() => filterNonTerminalTasks(tasks), [tasks]);
  const showMultiRunTable = nonTerminalTasks.length > 1;

  function dismissGate(taskId: string, stageName: string) {
    setDismissedGateKeys((current) => {
      const next = new Set(current);
      next.add(`${taskId}:${stageName}`);
      return next;
    });
  }

  function openStageDrawer(task: TaskRunStateEnvelope, stage: StageCell) {
    if (stage.status === "pending") {
      return;
    }
    setDrawerTarget({ task, stage });
  }

  return (
    <div className="pipeline-module" data-testid="pipeline-module">
      <HumanGateBanner
        tasks={tasks}
        dismissedGateKeys={dismissedGateKeys}
        artifactAvailability={artifactAvailability}
        onDismissGate={dismissGate}
        onSelectTask={setSelectedTaskId}
      />
      <div className="pipeline-module-body">
        <div className="pipeline-module-main">
          <NextActionPanel
            tasks={tasks}
            selectedTaskId={selectedTaskIdResolved}
            dismissedGateKeys={dismissedGateKeys}
            loading={loadingRunState}
            error={runStateError}
            onRetry={() => void loadRunState({ initial: true })}
            onOpenNextPrompt={(runDir) => onOpenNextPrompt(`${runDir}/next-prompt.md`)}
            onOpenRunFolder={onOpenRunFolder}
            onExecuteComplete={() => void loadRunState()}
          />
          <PreCloseValidationPanel
            tasks={tasks}
            selectedTaskId={selectedTaskIdResolved}
            onNavigateToMaintenance={onNavigateToMaintenance}
          />
          {isPolling ? (
            <div
              className="live-refresh-indicator"
              data-testid="live-refresh-indicator"
              aria-live="polite"
            >
              <span className="live-refresh-dot" aria-hidden="true" />
              Live
            </div>
          ) : null}
          <StageMachineGrid
            tasks={tasks}
            selectedTaskId={selectedTaskIdResolved}
            onSelectTask={setSelectedTaskId}
            nowMs={nowMs}
            onOpenStageDrawer={openStageDrawer}
          />
          <RunEventTimeline tasks={tasks} selectedTaskId={selectedTaskIdResolved} />
        </div>
        <div className="pipeline-module-sidebar">
          <ActiveMemoryHeader onOpenRefreshProcedure={onOpenRefreshProcedure} />
          <InboxTriagePanel onOpenInboxEntry={onOpenInboxEntry} />
          {showMultiRunTable ? (
            <MultiRunTable
              tasks={nonTerminalTasks}
              selectedTaskId={selectedTaskIdResolved}
              nowMs={nowMs}
              onSelectTask={setSelectedTaskId}
            />
          ) : null}
          <ConfigReadOnlyPanel
            config={config}
            loading={loadingConfig}
            error={configError}
            onRetry={() => void loadConfig()}
          />
        </div>
      </div>
      {drawerTarget !== null ? (
        <ArtifactDrawer
          task={drawerTarget.task}
          stage={drawerTarget.stage}
          designSteps={config?.designStepsDefault ?? false}
          artifactPresence={drawerArtifactPresence}
          onClose={() => setDrawerTarget(null)}
          onOpenArtifact={(filePath) => {
            onOpenArtifact(filePath);
          }}
        />
      ) : null}
    </div>
  );
}
