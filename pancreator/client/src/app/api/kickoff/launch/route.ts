import { launchFeatureDelivery } from "@/services/kickoff-server";

type LaunchRequestBody = {
  inboxPath?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: LaunchRequestBody;
  try {
    body = (await request.json()) as LaunchRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inboxPath = body.inboxPath?.trim() ?? "";
  if (inboxPath.length === 0) {
    return Response.json({ error: "inboxPath is required" }, { status: 400 });
  }

  try {
    const result = await launchFeatureDelivery({ inboxPath });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
