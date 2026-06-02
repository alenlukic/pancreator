import { getActiveRunState } from "@/services/run-state";

export async function GET(): Promise<Response> {
  const envelopes = await getActiveRunState();
  return Response.json(envelopes);
}
