import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenterSurface } from "./CommandCenterSurface";
import { stringifyCompactJson } from "@/lib/json-io";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockRunState = [
  {
    taskId: "65766_0543_demo-feature",
    featureId: "demo-feature",
    decodedTimestamp: "2026-06-02 05:43 UTC",
    runDir: ".pan/work/172973_06-02-26/65766_0543_demo-feature",
    inboxSource: "lib/inbox/in/demo.md",
    stages: [
      {
        name: "intake",
        ownerPersona: "intake-analyst",
        humanGate: "human_approval",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "complete",
      },
      {
        name: "plan",
        ownerPersona: "tech-lead",
        humanGate: "human_approval",
        nextHumanAction: "Ratify the plan before advancing.",
        nextCommand: "pnpm -w exec pan advance 65766_0543_demo-feature --artifact touch-set.json",
        humanAttention: "",
        status: "active",
      },
      {
        name: "implement",
        ownerPersona: "coder",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "review",
        ownerPersona: "reviewer",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "test",
        ownerPersona: "qa-tester",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "report",
        ownerPersona: "tech-writer",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "compliance",
        ownerPersona: "supervisor",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "ship",
        ownerPersona: "supervisor",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "index",
        ownerPersona: "librarian",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
      {
        name: "complete",
        ownerPersona: "librarian",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "",
        status: "pending",
      },
    ],
    runEvents: [
      {
        timestamp: "2026-06-02T12:00:00.000Z",
        event: "tech-lead",
        message: "tech-lead · plan: success",
        stageId: "plan",
      },
    ],
  },
];

function mockCommandCenterFetch(options: {
  runState?: unknown[];
  runStateOk?: boolean;
  shippedOutcomes?: unknown[];
} = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/run-state")) {
      if (options.runStateOk === false) {
        return new Response(stringifyCompactJson({ error: "run-state unavailable" }), {
          status: 500,
        });
      }
      return new Response(
        stringifyCompactJson({
          tasks: options.runState ?? mockRunState,
          reconciliation: {
            archivedTaskIds: [],
            shippedTaskIds: [],
            shippedOutcomes: options.shippedOutcomes ?? [],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/file")) {
      return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
    }
    return new Response(stringifyCompactJson({}), { status: 404 });
  });
}

describe("CommandCenterSurface", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders four orientation regions with operational rows", async () => {
    mockCommandCenterFetch();

    render(<CommandCenterSurface />);

    await waitFor(() => {
      expect(screen.getByTestId("command-center-page")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-human-gates")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-anomalies")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-running-now")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-recent-outcomes")).toBeInTheDocument();
      expect(screen.getAllByText("Demo Feature").length).toBeGreaterThan(0);
      expect(screen.getAllByTestId("command-center-row").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(".pan/work/")).not.toBeInTheDocument();
  });

  it("renders global empty state when no operational rows exist", async () => {
    mockCommandCenterFetch({ runState: [] });

    render(<CommandCenterSurface />);

    await waitFor(() => {
      expect(screen.getByText("No active deliveries")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Feature Delivery" })).toHaveAttribute(
        "href",
        "/mission-control",
      );
    });

    expect(screen.queryByTestId("command-center-human-gates")).not.toBeInTheDocument();
  });

  it("shows loading skeleton with aria-busy", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    render(<CommandCenterSurface />);

    expect(screen.getByTestId("command-center-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("renders run-state error with retry fetch", async () => {
    mockCommandCenterFetch({ runStateOk: false });

    render(<CommandCenterSurface />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("run-state unavailable");
      expect(screen.getByRole("button", { name: "Retry fetch" })).toBeInTheDocument();
    });
  });

  it("exposes human-gate approve and reject CTAs on rows", async () => {
    mockCommandCenterFetch();

    render(<CommandCenterSurface />);

    await waitFor(() => {
      const approve = screen.getAllByRole("link", { name: /Approve /u })[0];
      expect(approve).toHaveAttribute("href", "/mission-control?task=65766_0543_demo-feature");
      expect(screen.getAllByRole("link", { name: /Reject /u })[0]).toBeInTheDocument();
    });

    fireEvent.focus(screen.getAllByRole("link", { name: /Approve /u })[0]!);
    expect(document.activeElement?.textContent).toMatch(/Approve/u);
  });
});
