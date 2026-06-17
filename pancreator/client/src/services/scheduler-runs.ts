import {
  createSchedulerTickExecutors,
  tickAutomations,
  type TickAutomationOutcome,
  type TickExecutors,
} from "@pancreator/scheduler";

import { findRepoRoot } from "@/services/repo-paths";

export type { RunRecord } from "@pancreator/scheduler";

export async function triggerManualAutomationRun(automationId: string): Promise<{
  outcomes: { automationId: string; runId: string; status: string }[];
}> {
  const repoRoot = findRepoRoot();
  const executors = await createSchedulerTickExecutors(repoRoot);
  const outcomes = await tickAutomations(repoRoot, {
    automationId,
    manual: true,
    executors,
  });
  return { outcomes };
}

export {
  AutomationNotFoundError,
  InvalidAutomationIdError,
} from "@pancreator/scheduler";

export type { TickAutomationOutcome, TickExecutors };
