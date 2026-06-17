import { saveKickoffDirective } from "@/services/kickoff-server";

type SaveRequestBody = {
  markdown?: string;
  slug?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: SaveRequestBody;
  try {
    body = (await request.json()) as SaveRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const markdown = body.markdown?.trim() ?? "";
  if (markdown.length === 0) {
    return Response.json({ error: "Directive markdown is required" }, { status: 400 });
  }

  try {
    const result = await saveKickoffDirective({
      markdown,
      slug: body.slug,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
