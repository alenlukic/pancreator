import {
  excludeReconciledAttentionTasks,
  getActiveRunState,
  loadArchivedTaskIds,
  loadShippedOutcomes,
} from "@/services/run-state";
import { findRepoRoot } from "@/services/repo-paths";

export async function GET(request?: Request): Promise<Response> {
  const repoRoot = findRepoRoot();
  const view =
    request !== undefined ? new URL(request.url).searchParams.get("view") : null;

  if (view === "attention") {
    const [tasks, archivedTaskIds, shippedOutcomes] = await Promise.all([
      getActiveRunState(repoRoot),
      loadArchivedTaskIds(repoRoot),
      loadShippedOutcomes(repoRoot),
    ]);
    const shippedTaskIds = shippedOutcomes.map((outcome) => outcome.taskId);
    const reconciledTasks = excludeReconciledAttentionTasks(
      tasks,
      archivedTaskIds,
      new Set(shippedTaskIds),
    );

    return Response.json({
      tasks: reconciledTasks,
      reconciliation: {
        archivedTaskIds: [...archivedTaskIds],
        shippedTaskIds,
        shippedOutcomes,
      },
    });
  }

  const envelopes = await getActiveRunState(repoRoot);
  return Response.json(envelopes);
}
