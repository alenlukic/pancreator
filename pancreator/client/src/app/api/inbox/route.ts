import { loadInboxEntries } from "@/services/inbox";

export async function GET(): Promise<Response> {
  const entries = await loadInboxEntries();
  return Response.json({ entries });
}
