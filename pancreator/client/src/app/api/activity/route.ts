import { getMutationReceipts } from "@/services/activity";

export async function GET(): Promise<Response> {
  const receipts = await getMutationReceipts();
  return Response.json({ receipts });
}
