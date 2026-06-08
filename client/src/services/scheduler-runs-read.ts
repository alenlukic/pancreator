import { readRunRecordsNewestFirst, type RunRecord } from "@pancreator/scheduler";

import { findRepoRoot } from "@/services/repo-paths";

export type { RunRecord };

export async function loadAutomationRunHistory(automationId: string): Promise<RunRecord[]> {
  const repoRoot = findRepoRoot();
  return readRunRecordsNewestFirst(repoRoot, automationId);
}
