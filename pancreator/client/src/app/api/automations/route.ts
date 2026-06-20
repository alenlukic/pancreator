import {
  AutomationNotFoundError,
  AutomationValidationError,
  InvalidAutomationIdError,
} from "@pancreator/scheduler";
import { getAutomation } from "@pancreator/scheduler";
import { findHarnessRoot } from "@/services/repo-paths";
import {
  discoverPersonaSlugs,
  loadAutomationSummaries,
  removeAutomation,
  saveAutomationCreate,
  saveAutomationUpdate,
  type AutomationRecord,
} from "@/services/automations";

function validationResponse(error: unknown): Response {
  if (error instanceof AutomationValidationError) {
    return Response.json({ errors: error.errors }, { status: 400 });
  }
  if (error instanceof InvalidAutomationIdError) {
    return Response.json({ errors: [error.message] }, { status: 400 });
  }
  if (error instanceof AutomationNotFoundError) {
    return Response.json({ errors: [error.message] }, { status: 400 });
  }
  throw error;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const automationId = url.searchParams.get("id")?.trim() ?? "";

  if (automationId) {
    try {
      const record = await getAutomation(findHarnessRoot(), automationId);
      return Response.json(record);
    } catch (error) {
      return validationResponse(error);
    }
  }

  const [automations, personas] = await Promise.all([
    loadAutomationSummaries(),
    discoverPersonaSlugs(),
  ]);
  return Response.json({ automations, personas });
}

export async function POST(request: Request): Promise<Response> {
  let body: AutomationRecord;
  try {
    body = (await request.json()) as AutomationRecord;
  } catch {
    return Response.json({ errors: ["body: invalid JSON"] }, { status: 400 });
  }

  try {
    const created = await saveAutomationCreate(body);
    return Response.json(created, { status: 201 });
  } catch (error) {
    return validationResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  let body: AutomationRecord;
  try {
    body = (await request.json()) as AutomationRecord;
  } catch {
    return Response.json({ errors: ["body: invalid JSON"] }, { status: 400 });
  }

  try {
    const updated = await saveAutomationUpdate(body);
    return Response.json(updated);
  } catch (error) {
    return validationResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const automationId = url.searchParams.get("id")?.trim() ?? "";
  if (!automationId) {
    return Response.json({ errors: ["id: is required"] }, { status: 400 });
  }

  try {
    await removeAutomation(automationId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return validationResponse(error);
  }
}
