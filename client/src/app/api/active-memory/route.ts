import { loadActiveMemory } from "@/services/active-memory";

export async function GET(): Promise<Response> {
  const snapshot = await loadActiveMemory();
  return Response.json(snapshot);
}
