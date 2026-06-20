import {
  excludeReconciledAttentionTasks,
  getActiveRunState,
  getRunStateForMissionControl,
  getShippedOutcomeRunStateForMissionControl,
  loadArchivedTaskIds,
  loadShippedOutcomes,
} from "@/services/run-state";
import { findRepoRoot } from "@/services/repo-paths";

export async function GET(request: Request): Promise<Response> {
  const repoRoot = findRepoRoot();
  const view = new URL(request.url).searchParams.get("view");

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

    const workflowHealthErrors: Record<string, string> = {};
    for (const task of tasks) {
      if (task.workflowHealthLoadError !== undefined) {
        workflowHealthErrors[task.taskId] = task.workflowHealthLoadError;
      }
    }

    return Response.json({
      tasks: reconciledTasks,
      reconciliation: {
        archivedTaskIds: [...archivedTaskIds],
        shippedTaskIds,
        shippedOutcomes,
        ...(Object.keys(reconciliationErrors).length > 0 ? { errors: reconciliationErrors } : {}),
        ...(Object.keys(workflowHealthErrors).length > 0
          ? { workflowHealthErrors }
          : {}),
      },
    });
  }

  const outcomeId = new URL(request.url).searchParams.get("outcome");
  if (outcomeId !== null && outcomeId.length > 0) {
    const shippedEnvelopes = await getShippedOutcomeRunStateForMissionControl(
      repoRoot,
      outcomeId,
    );
    return Response.json(shippedEnvelopes);
  }

  const taskId = new URL(request.url).searchParams.get("task");
  const envelopes = await getRunStateForMissionControl(repoRoot, taskId);
  return Response.json(envelopes);
}
