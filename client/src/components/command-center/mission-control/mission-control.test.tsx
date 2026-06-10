import type React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import {
  countStageRetryTransitions,
  detectRetryLimitFailure,
} from "@/services/run-state-shared";
import type { StageCell, TaskRunStateEnvelope } from "@/services/run-state-shared";
import { artifactDisplayLabel } from "./ArtifactsByStage";
import { MissionControlModule } from "./MissionControlModule";
import { showNotImplementedToast } from "./remediation";
import { RetryLimitBanner } from "./RetryLimitBanner";
import { RunContextHeader } from "./RunContextHeader";
import { StageDetailPanel } from "./StageDetailPanel";
import { StageMachineGrid, StageCellCard } from "./StageMachineGrid";

const mockRunState: TaskRunStateEnvelope[] = [
  {
    taskId: "61498_0655_command-center-feature-delivery-mission-control-run-detail",
    featureId: "command-center-feature-delivery-mission-control-run-detail",
    decodedTimestamp: "2026-06-09 06:55 UTC",
    runDir: ".pan/work/172966_06-09-26/61498_0655_command-center-feature-delivery-mission-control-run-detail",
    stages: [
      { name: "intake", ownerPersona: "intake-analyst", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "complete" },
      { name: "plan", ownerPersona: "tech-lead", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "complete" },
      { name: "implement", ownerPersona: "coder", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "failed" },
      { name: "review", ownerPersona: "reviewer", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "test", ownerPersona: "qa-tester", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "report", ownerPersona: "tech-writer", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "compliance", ownerPersona: "supervisor", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "ship", ownerPersona: "supervisor", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "index", ownerPersona: "librarian", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
      { name: "complete", ownerPersona: "librarian", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "pending" },
    ],
    runEvents: [
      {
        timestamp: "2026-06-09T12:00:00.000Z",
        event: "retry_limit_halt",
        message:
          "gate: retry_limit_halt failing_stage: implement retry_count: 3 exceeded loopback budget",
        stageId: "implement",
      },
      {
        timestamp: "2026-06-09T11:00:00.000Z",
        event: "must_fix",
        message: "review routed back to implement",
        stageId: "implement",
        retryBadge: true,
      },
      {
        timestamp: "2026-06-09T10:00:00.000Z",
        event: "must_fix",
        message: "second implement retry",
        stageId: "implement",
        retryBadge: true,
      },
      {
        timestamp: "2026-06-09T09:00:00.000Z",
        event: "must_fix",
        message: "first implement retry",
        stageId: "implement",
        retryBadge: true,
      },
    ],
  },
];

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/mission-control",
  useRouter: () => ({ push: vi.fn() }),
}));

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

function mockFetch(options: { fileOk?: boolean } = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/run-state")) {
      return new Response(stringifyCompactJson(mockRunState), { status: 200 });
    }
    if (url.includes("/api/config")) {
      return new Response(stringifyCompactJson({ designStepsDefault: false }), { status: 200 });
    }
    if (url.includes("/api/file")) {
      const ok = options.fileOk ?? false;
      if (!ok) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(stringifyCompactJson({ content: "artifact body" }), { status: 200 });
    }
    return new Response(stringifyCompactJson({}), { status: 404 });
  });
}

describe("run-state retry helpers", () => {
  it("counts per-stage retry transitions", () => {
    expect(
      countStageRetryTransitions(mockRunState[0].runEvents, "implement"),
    ).toBe(3);
  });

  it("detects retry-limit failure summary", () => {
    const summary = detectRetryLimitFailure(mockRunState[0].runEvents);
    expect(summary).not.toBeNull();
    expect(summary?.failingStage).toBe("implement");
    expect(summary?.retryCount).toBe(3);
  });
});

describe("RetryLimitBanner", () => {
  it("renders remediation strip actions", () => {
    const summary = detectRetryLimitFailure(mockRunState[0].runEvents)!;
    render(<RetryLimitBanner summary={summary} />);
    expect(screen.getByTestId("retry-limit-banner")).toBeInTheDocument();
    expect(screen.getByTestId("retry-remediation-strip")).toBeInTheDocument();
    expect(screen.getByTestId("remediation-retry-stage")).toBeInTheDocument();
    expect(screen.getByTestId("remediation-run-quick-fix")).toBeInTheDocument();
  });
});

const failedImplementStage: StageCell = {
  name: "implement",
  ownerPersona: "coder",
  humanGate: "",
  nextHumanAction: "",
  nextCommand: "",
  humanAttention: "",
  status: "failed",
};

const longOutputEvents = [
  {
    timestamp: "2026-06-09T10:00:00.000Z",
    event: "stage_output",
    message: "A".repeat(400),
    stageId: "implement",
  },
  {
    timestamp: "2026-06-09T11:00:00.000Z",
    event: "must_fix",
    message: "Implement stage failed after review loop.",
    stageId: "implement",
  },
];

describe("artifactDisplayLabel", () => {
  it("maps design QA report filename to operator label", () => {
    expect(artifactDisplayLabel(".pan/work/run/design-qa-report.md")).toBe("Design QA report");
  });
});

describe("RunContextHeader", () => {
  it("shows humanized feature title and hides raw task id by default", () => {
    render(
      <RunContextHeader
        task={mockRunState[0]}
        nowMs={Date.parse("2026-06-09T12:00:00.000Z")}
        isPolling={false}
        onOpenRunLogs={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Command Center Feature Delivery Mission Control Run Detail",
    );
    expect(screen.queryByTestId("run-context-technical-details")).not.toBeInTheDocument();
  });

  it("reveals task id behind technical details disclosure", () => {
    render(
      <RunContextHeader
        task={mockRunState[0]}
        nowMs={Date.parse("2026-06-09T12:00:00.000Z")}
        isPolling={false}
        onOpenRunLogs={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("toggle-technical-details"));
    expect(screen.getByTestId("run-context-technical-details")).toHaveTextContent(
      mockRunState[0].taskId,
    );
  });
});

describe("StageCellCard", () => {
  it("suppresses gate prose and commands on mission-control chrome", () => {
    const stage: StageCell = {
      name: "implement",
      ownerPersona: "coder",
      humanGate: "human_approval",
      nextHumanAction: "Approve plan",
      nextCommand: "pnpm -w exec pan advance --artifact .pan/work/run/plan.md",
      humanAttention: "Waiting on operator",
      status: "active",
    };

    render(
      <StageCellCard
        stage={stage}
        runEvents={[]}
        nowMs={Date.now()}
        showMissionControlChrome
        onActivate={() => undefined}
      />,
    );

    expect(screen.queryByText(/Gate:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pnpm/)).not.toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
  });
});

describe("StageDetailPanel", () => {
  const nowMs = Date.parse("2026-06-09T12:00:00.000Z");

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders persona, status, and failed-stage error excerpt", () => {
    render(
      <StageDetailPanel
        stage={failedImplementStage}
        runEvents={longOutputEvents}
        nowMs={nowMs}
      />,
    );

    expect(screen.getByTestId("stage-detail-panel")).toBeInTheDocument();
    expect(screen.getByText("coder")).toBeInTheDocument();
    expect(screen.getByTestId("stage-detail-error")).toHaveTextContent(
      "Implement stage failed after review loop.",
    );
  });

  it("expands truncated stage output on disclosure click", () => {
    render(
      <StageDetailPanel
        stage={failedImplementStage}
        runEvents={longOutputEvents}
        nowMs={nowMs}
      />,
    );

    const output = screen.getByTestId("expand-stage-output");
    expect(output).toBeInTheDocument();
    fireEvent.click(output);
    expect(screen.getByText("Collapse stage output")).toBeInTheDocument();
  });

  it("summarizes internal runner events for operators", () => {
    const internalEvents = [
      {
        timestamp: "2026-06-09T10:00:00.000Z",
        event: "cursor.runner.escalation",
        message: "cursor.runner.escalation: success",
        stageId: "implement",
      },
    ];

    render(
      <StageDetailPanel
        stage={failedImplementStage}
        runEvents={internalEvents}
        nowMs={nowMs}
      />,
    );

    const panel = screen.getByTestId("stage-detail-panel");
    expect(panel).not.toHaveTextContent("cursor.runner");
    expect(panel).toHaveTextContent("Model escalation");
  });

  it("copies visible stage output to clipboard", async () => {
    render(
      <StageDetailPanel
        stage={failedImplementStage}
        runEvents={longOutputEvents}
        nowMs={nowMs}
      />,
    );

    fireEvent.click(screen.getByTestId("copy-stage-output"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      expect(screen.getByText("Copied stage output")).toBeInTheDocument();
    });
  });
});

describe("StageMachineGrid", () => {
  it("omits mission-control retry badges on the pipeline grid default chrome", () => {
    render(
      <StageMachineGrid
        tasks={mockRunState}
        selectedTaskId={mockRunState[0].taskId}
        nowMs={Date.parse("2026-06-09T12:00:00.000Z")}
        onSelectTask={() => undefined}
        onOpenStageDrawer={() => undefined}
      />,
    );

    expect(screen.queryByTestId("retry-badge-implement")).not.toBeInTheDocument();
  });
});

describe("showNotImplementedToast", () => {
  it("dispatches toast event with action name", () => {
    const handler = vi.fn();
    window.addEventListener("mission-control-toast", handler);
    showNotImplementedToast("Retry stage");
    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(event.detail.message).toContain("Action not available yet");
    expect(event.detail.message).toContain("Retry stage");
    window.removeEventListener("mission-control-toast", handler);
  });
});

const FD_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
  "ship",
  "index",
] as const;

describe("MissionControlModule", () => {
  beforeEach(() => {
    mockSearchParams.delete("task");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists FD stages in canonical order on the stage rail", async () => {
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-control-stage-rail")).toBeInTheDocument();
    });

    const rail = screen.getByTestId("mission-control-stage-rail");
    const stageNames = [...rail.querySelectorAll("h4")].map((node) => node.textContent);
    expect(stageNames).toEqual([...FD_STAGE_ORDER]);
  });

  it("pre-selects task from ?task= query when present in envelope", async () => {
    mockSearchParams.set("task", mockRunState[0].taskId);
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("run-context-header")).toHaveTextContent(
        "Command Center Feature Delivery Mission Control Run Detail",
      );
    });
  });

  it("shows retry-limit banner and stage retry badges", async () => {
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-control-module")).toBeInTheDocument();
    });

    expect(screen.getByTestId("retry-limit-banner")).toBeInTheDocument();
    expect(screen.getByTestId("retry-badge-implement")).toHaveTextContent("3");
  });

  it("keeps verbose log drawer closed by default", async () => {
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-control-module")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("verbose-log-drawer")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-run-logs-button")).toBeInTheDocument();
  });

  it("opens verbose log drawer when triggered", async () => {
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("open-run-logs-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("open-run-logs-button"));

    expect(screen.getByTestId("verbose-log-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("run-timeline")).toBeInTheDocument();
  });

  it("marks missing required artifacts as Blocking", async () => {
    mockFetch({ fileOk: false });
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("artifacts-by-stage")).toBeInTheDocument();
    });

    const blockingRow = screen.getByTestId("artifact-row-implementation-report.md");
    expect(blockingRow).toHaveClass("mc-artifact-blocking");
    expect(within(blockingRow).getByText("Missing artifact")).toBeInTheDocument();
    expect(within(blockingRow).getByTestId("preview-artifact-implementation-report.md")).toBeDisabled();
  });

  it("shows stub toast when remediation action is activated", async () => {
    mockFetch();
    render(<MissionControlModule />);

    await waitFor(() => {
      expect(screen.getByTestId("remediation-retry-stage")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("remediation-retry-stage"));

    await waitFor(() => {
      expect(screen.getByTestId("mission-control-toast")).toHaveTextContent(
        "Action not available yet: Retry stage",
      );
    });
  });
});
