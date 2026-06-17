import { loadRuntimeConfig } from "@/services/config";

export async function GET(): Promise<Response> {
  const snapshot = await loadRuntimeConfig();
  return Response.json(snapshot);
}
