import { PathAccessError } from "@/services/repo-paths";
import { readRepoFile, writeRepoFile } from "@/services/repo-files";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const repoPath = url.searchParams.get("path");

  if (!repoPath) {
    return Response.json({ error: "path query parameter is required" }, { status: 400 });
  }

  try {
    const content = await readRepoFile(repoPath);
    return Response.json({ path: repoPath, content });
  } catch (error) {
    if (error instanceof PathAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: { path?: string; content?: string };
  try {
    body = (await request.json()) as { path?: string; content?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.path || typeof body.content !== "string") {
    return Response.json({ error: "path and content are required" }, { status: 400 });
  }

  try {
    const entry = await writeRepoFile(body.path, body.content);
    return Response.json({ ok: true, ...entry });
  } catch (error) {
    if (error instanceof PathAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
