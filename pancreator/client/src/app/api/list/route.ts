import { PathAccessError } from "@/services/repo-paths";
import { listRepoDirectory } from "@/services/repo-files";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const repoPath = url.searchParams.get("path");

  if (!repoPath) {
    return Response.json({ error: "path query parameter is required" }, { status: 400 });
  }

  try {
    const entries = await listRepoDirectory(repoPath);
    return Response.json({ path: repoPath, entries });
  } catch (error) {
    if (error instanceof PathAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
