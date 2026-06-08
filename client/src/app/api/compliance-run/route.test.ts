import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { GET, POST } from "@/app/api/compliance-run/route";

const mockDescriptors = [
  {
    id: "json-formatting",
    severity: "high" as const,
    triggerModes: ["operator-on-demand"],
    descriptorPath: "tests/compliance/json-formatting.yaml",
  },
];

const mockReport = {
  status: "pass",
  descriptorsRun: 1,
  blockFindings: 0,
  results: [{ id: "json-formatting", pass: true, severity: "high", blocks: false }],
};

vi.mock("@/services/maintenance-compliance", () => ({
  listComplianceDescriptors: vi.fn(async () => mockDescriptors),
  isKnownDescriptorId: vi.fn(async (descriptorId: string) => descriptorId === "json-formatting"),
  validateDescriptorId: vi.fn((descriptorId: string) => {
    if (descriptorId.includes(";")) {
      return { error: "Shell metacharacters are not allowed" };
    }
    return null;
  }),
  executeComplianceRun: vi.fn(async (descriptorId?: string) => ({
    exitCode: descriptorId === "json-formatting" ? 0 : 0,
    report: mockReport,
  })),
}));

describe("compliance-run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists descriptors on GET", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { descriptors: unknown[] };
    expect(payload.descriptors).toHaveLength(1);
  });

  it("runs all compliance descriptors when body omits descriptorId", async () => {
    const response = await POST(
      new Request("http://localhost/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({}),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; exitCode: number };
    expect(payload.status).toBe("pass");
    expect(payload.exitCode).toBe(0);
  });

  it("runs one descriptor when descriptorId is provided", async () => {
    const response = await POST(
      new Request("http://localhost/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ descriptorId: "json-formatting" }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string };
    expect(payload.status).toBe("pass");
  });

  it("rejects unknown descriptor ids with HTTP 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ descriptorId: "missing-descriptor" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects shell metacharacters with HTTP 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ descriptorId: "json-formatting; rm -rf /" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
