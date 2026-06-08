import { randomUUID } from "node:crypto";

import { acquireLock, releaseLock } from "./lock.js";
import { isAutomationDue } from "./due.js";
import { getAutomation, listDueAutomations } from "./registry.js";
import {
  appendRunRecord,
  readRunRecords,
  updateRunRecord,
  type RunRecord,
  type RunStatus,
  type RunTrigger,
} from "./run-log.js";
import type { AutomationRecord } from "./schema.js";

export type TickAgentDispatchInput = {
  automation: AutomationRecord;
  persona: string;
  prompt: string;
  runId: string;
};

export type TickPanDispatchInput = {
  automation: AutomationRecord;
  subcommand: string;
  runId: string;
};

export type TickDispatchResult = {
  ok: boolean;
  stdoutSummary: string;
  stderrSummary: string;
  taskId?: string;
};

export type TickExecutors = {
  dispatchAgent: (input: TickAgentDispatchInput) => Promise<TickDispatchResult>;
  dispatchPan: (input: TickPanDispatchInput) => Promise<TickDispatchResult>;
};

export type TickAutomationsOptions = {
  automationId?: string;
  manual?: boolean;
  now?: Date;
  executors: TickExecutors;
};

export type TickAutomationOutcome = {
  automationId: string;
  runId: string;
  status: RunStatus;
};

function toIso(date: Date): string {
  return date.toISOString();
}

async function appendSkippedRecord(
  repoRoot: string,
  automation: AutomationRecord,
  trigger: RunTrigger,
  reason: string,
  now: Date,
): Promise<TickAutomationOutcome> {
  const runId = randomUUID();
  const record: RunRecord = {
    runId,
    startedAt: toIso(now),
    finishedAt: toIso(now),
    status: "skipped",
    trigger,
    stdoutSummary: "",
    stderrSummary: reason,
  };
  await appendRunRecord(repoRoot, automation.id, record);
  return { automationId: automation.id, runId, status: "skipped" };
}

async function dispatchAutomation(
  repoRoot: string,
  automation: AutomationRecord,
  trigger: RunTrigger,
  executors: TickExecutors,
  now: Date,
): Promise<TickAutomationOutcome> {
  const runId = randomUUID();
  const lock = await acquireLock(
    repoRoot,
    automation.id,
    runId,
    automation.policy.maxConcurrent,
  );
  if (!lock.acquired) {
    return appendSkippedRecord(repoRoot, automation, trigger, lock.reason, now);
  }

  const startedAt = toIso(now);
  await appendRunRecord(repoRoot, automation.id, {
    runId,
    startedAt,
    status: "running",
    trigger,
    stdoutSummary: "",
    stderrSummary: "",
  });

  let dispatch: TickDispatchResult;
  try {
    if (automation.trigger.kind === "agent") {
      dispatch = await executors.dispatchAgent({
        automation,
        persona: automation.trigger.persona,
        prompt: automation.trigger.prompt,
        runId,
      });
    } else {
      dispatch = await executors.dispatchPan({
        automation,
        subcommand: automation.trigger.subcommand,
        runId,
      });
    }
  } catch (error) {
    dispatch = {
      ok: false,
      stdoutSummary: "",
      stderrSummary: error instanceof Error ? error.message : String(error),
    };
  }

  const finishedAt = toIso(now);
  const status: RunStatus = dispatch.ok ? "success" : "error";
  await updateRunRecord(repoRoot, automation.id, runId, {
    finishedAt,
    status,
    stdoutSummary: dispatch.stdoutSummary,
    stderrSummary: dispatch.stderrSummary,
    ...(dispatch.taskId ? { taskId: dispatch.taskId } : {}),
  });
  await releaseLock(repoRoot, automation.id, runId);
  return { automationId: automation.id, runId, status };
}

/** Evaluates due enabled automations or a manual `--id` target and dispatches each once. */
export async function tickAutomations(
  repoRoot: string,
  options: TickAutomationsOptions,
): Promise<TickAutomationOutcome[]> {
  const now = options.now ?? new Date();
  const outcomes: TickAutomationOutcome[] = [];

  if (options.automationId) {
    const automation = await getAutomation(repoRoot, options.automationId);
    const trigger: RunTrigger = options.manual ? "manual" : "scheduled";
    outcomes.push(
      await dispatchAutomation(repoRoot, automation, trigger, options.executors, now),
    );
    return outcomes;
  }

  const enabled = await listDueAutomations(repoRoot);
  for (const summary of enabled) {
    const automation = await getAutomation(repoRoot, summary.id);
    const records = await readRunRecords(repoRoot, automation.id);
    if (!isAutomationDue(automation.schedule, records, now)) {
      continue;
    }
    outcomes.push(
      await dispatchAutomation(repoRoot, automation, "scheduled", options.executors, now),
    );
  }

  return outcomes;
}

/** Returns exit code 0 when every attempted dispatch succeeded or was skipped. */
export function aggregateTickExitCode(outcomes: readonly TickAutomationOutcome[]): number {
  const failed = outcomes.some((outcome) => outcome.status === "error");
  return failed ? 1 : 0;
}
