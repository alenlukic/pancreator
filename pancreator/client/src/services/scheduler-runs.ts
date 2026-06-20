import {
  createSchedulerTickExecutors,
  tickAutomations,
  type TickAutomationOutcome,
  type TickExecutors,
} from "@pancreator/scheduler";

import { findHarnessRoot } from "@/services/repo-paths";

export type { RunRecord } from "@pancreator/scheduler";

export async function triggerManualAutomationRun(automationId: string): Promise<{
  outcomes: { automationId: string; runId: string; status: string }[];
}> {
  const harnessRoot = findHarnessRoot();
  const executors = await createSchedulerTickExecutors(harnessRoot);
  const outcomes = await tickAutomations(harnessRoot, {
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
