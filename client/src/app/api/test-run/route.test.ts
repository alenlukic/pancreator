import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { POST } from "@/app/api/test-run/route";

async function readSseBody(response: Response): Promise<string> {
  return response.text();
}

vi.mock("@/services/maintenance-test-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/maintenance-test-run")>();
  return {
    ...actual,
    streamSuiteOutput: vi.fn(async function* mockStream() {
      yield { type: "stdout" as const, line: "vitest output" };
      yield { type: "exit" as const, exitCode: 0 };
    }),
  };
});

vi.mock("@/services/maintenance-runs", () => ({
  createRunRecordId: vi.fn(() => "run-1"),
  saveRunRecord: vi.fn(),
}));

describe("test-run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams SSE chunks for allowlisted suites", async () => {
    const response = await POST(
      new Request("http://localhost/api/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ suite: "client" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await readSseBody(response);
    expect(body).toContain('"line":"vitest output"');
    expect(body).toContain("event: exit");
    expect(body).toContain('"exitCode":0');
  });

  it("rejects unknown suites with HTTP 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ suite: "unknown" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects shell metacharacters with HTTP 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ suite: "client; rm -rf /" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
