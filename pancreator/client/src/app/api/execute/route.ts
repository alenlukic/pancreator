import { executePanCommand, type PanExecuteRejection } from "@/services/pan-execute";

type ExecuteRequestBody = {
  command?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: ExecuteRequestBody;
  try {
    body = (await request.json()) as ExecuteRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body", verb: "" }, { status: 400 });
  }

  const command = body.command?.trim() ?? "";
  const result = await executePanCommand(command);

  if ("error" in result) {
    const rejection = result as PanExecuteRejection;
    return Response.json(
      { error: rejection.error, verb: rejection.verb },
      { status: 400 },
    );
  }

  return Response.json(result);
}
