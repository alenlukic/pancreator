import type React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationsSurface } from "./AutomationsSurface";
import { stringifyCompactJson } from "@/lib/json-io";

const mockAutomations = [
  {
    id: "hourly-coder",
    name: "Hourly coder",
    enabled: true,
    schedule: "0 * * * *",
    scheduleLabel: "Hourly",
    status: "scheduled",
    triggerKind: "agent",
    persona: "coder",
  },
];

function mockAutomationsFetch() {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/automations") && !url.includes("/runs")) {
      return new Response(
        stringifyCompactJson({ automations: mockAutomations, personas: ["coder"] }),
        { status: 200 },
      );
    }
    if (url.match(/\/api\/automations\/[^/]+\/runs$/u)) {
      return new Response(stringifyCompactJson({ runs: [] }), { status: 200 });
    }
    return new Response(stringifyCompactJson({}), { status: 404 });
  });
}

describe("AutomationsSurface", () => {
  beforeEach(() => {
    mockAutomationsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders automations-surface and list card after load", async () => {
    render(<AutomationsSurface />);

    expect(screen.getByTestId("automations-surface")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("automations-list-card")).toBeInTheDocument();
      expect(screen.getByTestId("automation-row-hourly-coder")).toBeInTheDocument();
    });
  });
});
