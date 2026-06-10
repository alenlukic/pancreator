import { summarizeKickoffUrl } from "@/services/kickoff-server";

type UrlRequestBody = {
  url?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: UrlRequestBody;
  try {
    body = (await request.json()) as UrlRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim() ?? "";
  if (url.length === 0) {
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const summary = await summarizeKickoffUrl({ url });
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "URL summarization failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
