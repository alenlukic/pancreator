import { readRunRecordsNewestFirst, type RunRecord } from "@pancreator/scheduler";

import { findHarnessRoot } from "@/services/repo-paths";

export type { RunRecord };

export async function loadAutomationRunHistory(automationId: string): Promise<RunRecord[]> {
  const harnessRoot = findHarnessRoot();
  return readRunRecordsNewestFirst(harnessRoot, automationId);
}
