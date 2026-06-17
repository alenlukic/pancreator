import {
  AutomationNotFoundError,
  InvalidAutomationIdError,
} from "@pancreator/scheduler";
import { triggerManualAutomationRun } from "@/services/scheduler-runs";

function validationResponse(error: unknown): Response {
  if (error instanceof InvalidAutomationIdError) {
    return Response.json({ errors: [error.message] }, { status: 400 });
  }
  if (error instanceof AutomationNotFoundError) {
    return Response.json({ errors: [error.message] }, { status: 404 });
  }
  throw error;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const automationId = id.trim();
  if (!automationId) {
    return Response.json({ errors: ["id: is required"] }, { status: 400 });
  }

  try {
    const result = await triggerManualAutomationRun(automationId);
    return Response.json(result);
  } catch (error) {
    return validationResponse(error);
  }
}
