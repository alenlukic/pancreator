import {
  AutomationNotFoundError,
  InvalidAutomationIdError,
} from "@pancreator/scheduler";
import { getAutomation } from "@pancreator/scheduler";
import { findHarnessRoot } from "@/services/repo-paths";
import { loadAutomationRunHistory } from "@/services/scheduler-runs-read";

function validationResponse(error: unknown): Response {
  if (error instanceof InvalidAutomationIdError) {
    return Response.json({ errors: [error.message] }, { status: 400 });
  }
  if (error instanceof AutomationNotFoundError) {
    return Response.json({ errors: [error.message] }, { status: 404 });
  }
  throw error;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const automationId = id.trim();
  if (!automationId) {
    return Response.json({ errors: ["id: is required"] }, { status: 400 });
  }

  try {
    await getAutomation(findHarnessRoot(), automationId);
    const runs = await loadAutomationRunHistory(automationId);
    return Response.json({ runs });
  } catch (error) {
    return validationResponse(error);
  }
}
