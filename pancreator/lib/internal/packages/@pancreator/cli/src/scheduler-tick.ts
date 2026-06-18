import { stringifyCompactJson } from "@pancreator/core";
import {
  aggregateTickExitCode,
  createSchedulerTickExecutors,
  tickAutomations,
  type TickAutomationOutcome,
  type TickExecutors,
} from "@pancreator/scheduler";

export type SchedulerTickOptions = {
  repoRoot: string;
  automationId?: string;
  invocation?: "manual" | "sdk";
  now?: Date;
  executors?: TickExecutors;
};

/** Runs one scheduler tick pass and returns per-automation outcomes. */
export async function runSchedulerTick(
  options: SchedulerTickOptions,
): Promise<{ outcomes: TickAutomationOutcome[]; exitCode: number }> {
  const executors =
    options.executors ?? (await createSchedulerTickExecutors(options.repoRoot, {
      invocation: options.invocation,
    }));
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
