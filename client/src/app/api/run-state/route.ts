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
    const tasks = await getActiveRunState(repoRoot);

    const reconciliationErrors: Record<string, string> = {};

    const [archiveResult, shippedResult] = await Promise.allSettled([
      loadArchivedTaskIds(repoRoot),
      loadShippedOutcomes(repoRoot),
    ]);

    let archivedTaskIds = new Set<string>();
    if (archiveResult.status === "fulfilled") {
      archivedTaskIds = archiveResult.value;
    } else {
      reconciliationErrors.archive = "Unable to load archived task ids";
    }

    let shippedOutcomes: Awaited<ReturnType<typeof loadShippedOutcomes>> = [];
    if (shippedResult.status === "fulfilled") {
      shippedOutcomes = shippedResult.value;
    } else {
      reconciliationErrors["feature-index"] = "Unable to load shipped outcomes from feature-index";
    }

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
        ...(Object.keys(reconciliationErrors).length > 0 ? { errors: reconciliationErrors } : {}),
      },
    });
  }

  const envelopes = await getActiveRunState(repoRoot);
  return Response.json(envelopes);
}
