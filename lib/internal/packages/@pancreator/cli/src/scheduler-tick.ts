import { spawnSync } from "node:child_process";

import { asTaskId, stringifyCompactJson } from "@pancreator/core";
import { FsInterventionStore } from "@pancreator/intervention";
import { CursorRunner } from "@pancreator/runner-cursor";
import {
  aggregateTickExitCode,
  tickAutomations,
  type TickAutomationOutcome,
  type TickExecutors,
} from "@pancreator/scheduler";

import { resolvePersona } from "./persona-resolve.js";
import { loadRepoEnv } from "./repo-env.js";

export type SchedulerTickOptions = {
  repoRoot: string;
  automationId?: string;
  invocation?: "manual" | "sdk";
  now?: Date;
  executors?: TickExecutors;
};

async function defaultExecutors(
  repoRoot: string,
  invocation: "manual" | "sdk",
): Promise<TickExecutors> {
  loadRepoEnv(repoRoot);
  const runner = new CursorRunner({
    invocation,
    repoRoot,
    cwd: repoRoot,
    apiKey: process.env.CURSOR_API_KEY,
  });
  const interventionStore = new FsInterventionStore(repoRoot);

  return {
    dispatchAgent: async ({ automation, persona, prompt, runId }) => {
      const personaInput = await resolvePersona(repoRoot, persona);
      const envelope = await runner.invoke({
        persona: personaInput,
        message: prompt,
        ledger: {
          taskId: `${automation.id}-${runId}`,
          pipelineId: "scheduler",
          stageId: "tick",
          featureId: automation.id,
        },
      });
      const taskId = envelope.resolved.ledger?.taskId ?? `${automation.id}-${runId}`;
      await interventionStore.appendRecord(asTaskId(taskId), {
        taskId: asTaskId(taskId),
        command: "pause",
        atIso: new Date().toISOString(),
      });
      const ok = envelope.sdkResult?.status !== "error";
      return {
        ok,
        stdoutSummary: envelope.sdkResult?.resultText ?? envelope.userMessage,
        stderrSummary: envelope.sdkResult?.errorMessage ?? "",
        taskId,
      };
    },
    dispatchPan: async ({ subcommand }) => {
      const args = ["-w", "exec", "pan", ...subcommand.trim().split(/\s+/u)];
      const result = spawnSync("pnpm", args, {
        cwd: repoRoot,
        encoding: "utf8",
        shell: false,
      });
      const stdoutSummary = result.stdout?.trim() ?? "";
      const stderrSummary = result.stderr?.trim() ?? "";
      return {
        ok: result.status === 0,
        stdoutSummary,
        stderrSummary,
      };
    },
  };
}

/** Runs one scheduler tick pass and returns per-automation outcomes. */
export async function runSchedulerTick(
  options: SchedulerTickOptions,
): Promise<{ outcomes: TickAutomationOutcome[]; exitCode: number }> {
  const executors =
    options.executors ?? (await defaultExecutors(options.repoRoot, options.invocation ?? "manual"));
  const outcomes = await tickAutomations(options.repoRoot, {
    automationId: options.automationId,
    manual: options.automationId !== undefined,
    now: options.now,
    executors,
  });
  return {
    outcomes,
    exitCode: aggregateTickExitCode(outcomes),
  };
}

export function formatSchedulerTickOutput(
  outcomes: readonly TickAutomationOutcome[],
): string {
  return stringifyCompactJson({ outcomes });
}
