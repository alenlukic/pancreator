import { afterEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { POST } from "@/app/api/kickoff/launch/route";
import * as kickoffServer from "@/services/kickoff-server";

describe("POST /api/kickoff/launch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns launch envelope on happy path", async () => {
    vi.spyOn(kickoffServer, "launchFeatureDelivery").mockResolvedValue({
      taskId: "25237_1659_demo",
      featureId: "demo",
      runDir: ".pan/work/172966_06-09-26/25237_1659_demo",
      handoffFile: ".pan/work/172966_06-09-26/25237_1659_demo/handoff.md",
    });

    const request = new Request("http://localhost/api/kickoff/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({
        inboxPath: "lib/inbox/in/172967_06-08-26/54352_0854_demo.md",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      taskId: string;
      featureId: string;
      runDir: string;
      handoffFile: string;
    };
    expect(payload).toMatchObject({
      taskId: "25237_1659_demo",
      featureId: "demo",
      runDir: ".pan/work/172966_06-09-26/25237_1659_demo",
      handoffFile: ".pan/work/172966_06-09-26/25237_1659_demo/handoff.md",
    });
  });

  it("rejects missing inboxPath", async () => {
    const request = new Request("http://localhost/api/kickoff/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
