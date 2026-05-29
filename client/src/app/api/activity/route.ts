import { getActivityFeed } from "@/services/activity";

export async function GET(): Promise<Response> {
  const events = await getActivityFeed();
  return Response.json(events);
}
