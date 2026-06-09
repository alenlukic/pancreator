import type React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/components/DashboardPage";
import MissionControlPage from "@/app/(cockpit)/mission-control/page";
import CommandCenterPage from "@/app/(cockpit)/command-center/page";
import { stringifyCompactJson } from "@/lib/json-io";
import { formatActiveMemoryRefreshTime } from "@/services/run-state-shared";

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

const mockMissionControlSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockMissionControlSearchParams,
  usePathname: () => "/mission-control",
  useRouter: () => ({ push: vi.fn() }),
}));

const mockRunState = [
  {
    taskId: "65766_0543_demo-feature",
    featureId: "demo-feature",
    decodedTimestamp: "2026-06-02 05:43 UTC",
    runDir: ".pan/work/172973_06-02-26/65766_0543_demo-feature",
    inboxSource: "lib/inbox/in/demo.md",
    sourceWarning: "pan status unavailable",
    stages: [
      {
        name: "intake",
        ownerPersona: "intake-analyst",
        humanGate: "human_approval",
        nextHumanAction: "",
        nextCommand: "",
        humanAttention: "Intake ratified",
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
      },
      {
        timestamp: "2026-06-01T10:00:00.000Z",
        event: "intake-analyst",
        message: "intake-analyst · intake: success",
      },
    ],
  },
];

const mockActiveMemory = {
  activeFeaturePath: "lib/inbox/in/demo-orientation.md",
  activeFeatureLabel: "Demo orientation",
  activeFeatureSlug: "demo-orientation",
  blockersSummary: "Blocker one · Blocker two",
  blockerChips: ["Blocker one", "Blocker two"],
  refreshTimestamp: "2026-06-08T10:07:29.699Z",
};

function probeActiveMemoryHeader(header: HTMLElement) {
  const style = window.getComputedStyle(header);
  const text = header.textContent ?? "";
  const parent = header.parentElement;
  const headerRect = header.getBoundingClientRect();
  const parentRect = parent?.getBoundingClientRect();
  return {
    containsLibInbox: text.includes("lib/inbox/in/"),
    borderStyle: style.borderStyle,
    overflow:
      parentRect !== null &&
      parentRect !== undefined &&
      (headerRect.right > parentRect.right + 1 || headerRect.left < parentRect.left - 1),
  };
}

const mockInboxEntries = [
  {
    path: "lib/inbox/in/demo-orientation.md",
    title: "Demo orientation",
    slug: "demo-orientation",
    ageHours: 3,
  },
];

function orientationFetchResponse(url: string): Response | null {
  if (url.includes("/api/active-memory")) {
    return new Response(stringifyCompactJson(mockActiveMemory), { status: 200 });
  }
  if (url.includes("/api/inbox")) {
    return new Response(stringifyCompactJson({ entries: mockInboxEntries }), { status: 200 });
  }
  return null;
}

const mockRunStateSecondTask = {
  taskId: "88888_1200_other-feature",
  featureId: "other-feature",
  decodedTimestamp: "2026-06-02 12:00 UTC",
  runDir: ".pan/work/172973_06-02-26/88888_1200_other-feature",
  inboxSource: "lib/inbox/in/other.md",
  stages: mockRunState[0].stages.map((stage) =>
    stage.name === "plan"
      ? {
          ...stage,
          humanGate: "",
          nextHumanAction: "",
          nextCommand: "",
          status: "active",
        }
      : stage.status === "active"
        ? { ...stage, status: "pending" }
        : stage,
  ),
  runEvents: [
    {
      timestamp: "2026-06-01T08:00:00.000Z",
      event: "tech-lead",
      message: "tech-lead · plan: success",
    },
  ],
};

const mockConfig = {
  invocationMode: "sdk",
  designStepsDefault: false,
  stageRemediation: true,
  sdkSampling: {
    enabled: true,
    ratePercent: 10,
    scope: "feature-delivery",
  },
  activeEscalationConfig: "auto",
  personaEscalationBadges: [{ persona: "coder", tierLabel: "composer-2.5[fast=false]" }],
};

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

const mockAutomationRecord = {
  schemaVersion: 1,
  id: "hourly-coder",
  name: "Hourly coder",
  enabled: true,
  schedule: "0 * * * *",
  trigger: {
    kind: "agent",
    persona: "coder",
    prompt: "Review open tasks.",
  },
  policy: {
    maxConcurrent: 1,
    timeoutMinutes: 60,
  },
};

const mockPersonas = ["coder", "tech-lead"];

type MockFetchOptions = {
  runState?: unknown[];
  config?: unknown;
  activeMemory?: unknown;
  inboxEntries?: unknown[];
  listEntries?: unknown[];
  fileContent?: string;
  fileOk?: boolean;
  postCalls?: { path: string; content: string }[];
  executeCalls?: string[];
  executeResult?: unknown;
  automations?: unknown[];
  automationRecord?: unknown;
  personas?: string[];
  automationPutCalls?: unknown[];
  automationPostCalls?: unknown[];
  automationRunCalls?: string[];
  automationRuns?: Record<string, unknown[]>;
  complianceDescriptors?: unknown[];
  complianceRunResult?: unknown;
  testRunSseBody?: string;
};

function mockFetchForDashboard(options: MockFetchOptions = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/run-state")) {
      return new Response(stringifyCompactJson(options.runState ?? []), { status: 200 });
    }
    if (url.includes("/api/active-memory")) {
      return new Response(stringifyCompactJson(options.activeMemory ?? mockActiveMemory), { status: 200 });
    }
    if (url.includes("/api/inbox")) {
      return new Response(
        stringifyCompactJson({ entries: options.inboxEntries ?? mockInboxEntries }),
        { status: 200 },
      );
    }
    if (url.includes("/api/config")) {
      return new Response(stringifyCompactJson(options.config ?? mockConfig), { status: 200 });
    }
    if (url.includes("/api/execute") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { command: string };
      options.executeCalls?.push(body.command);
      return new Response(
        stringifyCompactJson(
          options.executeResult ?? {
            stdout: "ok",
            stderr: "",
            exitCode: 0,
          },
        ),
        { status: 200 },
      );
    }
    if (url.includes("/api/list")) {
      return new Response(stringifyCompactJson({ entries: options.listEntries ?? [] }), { status: 200 });
    }
    if (url.includes("/api/file") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { path: string; content: string };
      options.postCalls?.push(body);
      return new Response(stringifyCompactJson({}), { status: 200 });
    }
    if (url.includes("/api/file")) {
      const ok = options.fileOk ?? true;
      if (!ok) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(
        stringifyCompactJson({ content: options.fileContent ?? "modal content" }),
        { status: 200 },
      );
    }
    if (url.match(/\/api\/automations\/[^/]+\/run$/u) && init?.method === "POST") {
      const automationId = url.split("/").at(-2) ?? "";
      options.automationRunCalls?.push(automationId);
      return new Response(
        stringifyCompactJson({
          outcomes: [{ automationId, runId: "run-test", status: "success" }],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/automations") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as unknown;
      options.automationPostCalls?.push(body);
      return new Response(stringifyCompactJson(mockAutomations[0]), { status: 201 });
    }
    if (url.includes("/api/automations") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as unknown;
      options.automationPutCalls?.push(body);
      return new Response(
        stringifyCompactJson({
          ...mockAutomations[0],
          enabled: (body as { enabled?: boolean }).enabled ?? true,
          status: (body as { enabled?: boolean }).enabled ? "scheduled" : "paused",
        }),
        { status: 200 },
      );
    }
    if (url.match(/\/api\/automations\/[^/]+\/runs$/u)) {
      const automationId = url.split("/").at(-2) ?? "";
      const runs = options.automationRuns?.[automationId] ?? [];
      return new Response(stringifyCompactJson({ runs }), { status: 200 });
    }
    if (url.includes("/api/automations?id=")) {
      return new Response(stringifyCompactJson(options.automationRecord ?? mockAutomationRecord), {
        status: 200,
      });
    }
    if (url.includes("/api/automations")) {
      return new Response(
        stringifyCompactJson({
          automations: options.automations ?? mockAutomations,
          personas: options.personas ?? mockPersonas,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/compliance-run") && init?.method === "POST") {
      return new Response(
        stringifyCompactJson(
          options.complianceRunResult ?? {
            status: "pass",
            exitCode: 0,
            results: [{ id: "json-formatting", pass: true, severity: "high", blocks: false }],
          },
        ),
        { status: 200 },
      );
    }
    if (url.includes("/api/compliance-run")) {
      return new Response(
        stringifyCompactJson({
          descriptors: options.complianceDescriptors ?? [
            {
              id: "json-formatting",
              severity: "high",
              triggerModes: ["operator-on-demand"],
              descriptorPath: "tests/compliance/json-formatting.yaml",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/test-run") && init?.method === "POST") {
      const body =
        options.testRunSseBody ??
        'data: {"stream":"stdout","line":"vitest output"}\n\nevent: exit\ndata: {"exitCode":0}\n\n';
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(stringifyCompactJson({}), { status: 404 });
  });
}

async function openSampleFileInModal() {
  fireEvent.click(screen.getByTestId("module-tab-files"));
  await waitFor(() => {
    expect(screen.getByText("sample.md")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("sample.md"));
  await waitFor(() => {
    expect(screen.getByTestId("file-modal")).toBeInTheDocument();
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the Pipeline module with CockpitShell tabs", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-shell")).toBeInTheDocument();
      expect(screen.getByTestId("module-tab-pipeline")).toHaveClass("cockpit-module-tab-active");
      expect(screen.getByTestId("pipeline-module")).toBeInTheDocument();
    });
  });

  it("renders Next Action panel with run directory and command actions", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      const panel = screen.getByTestId("next-action-panel");
      expect(panel).toHaveTextContent("Demo Feature");
      expect(panel).toHaveTextContent(".pan/work/172973_06-02-26/65766_0543_demo-feature/");
      expect(panel).toHaveTextContent("Ratify the plan before advancing.");
      expect(panel).toHaveTextContent("pnpm -w exec pan advance");
      expect(within(panel).getByTestId("copy-command-button")).toBeEnabled();
      expect(screen.getByTestId("open-next-prompt-button")).toBeInTheDocument();
      expect(screen.getByTestId("open-run-folder-button")).toBeInTheDocument();
    });
  });

  it("copies nextCommand and shows Copied feedback", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(within(screen.getByTestId("next-action-panel")).getByTestId("copy-command-button")).toBeEnabled();
    });

    fireEvent.click(within(screen.getByTestId("next-action-panel")).getByTestId("copy-command-button"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "pnpm -w exec pan advance 65766_0543_demo-feature --artifact touch-set.json",
      );
      expect(screen.getByText("Copied")).toHaveAttribute("aria-live", "polite");
    });
  });

  it("renders human gate queue banner and supports dismiss persistence in Next Action", async () => {
    mockFetchForDashboard({ runState: mockRunState, fileOk: false });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("human-gate-banner")).toBeInTheDocument();
      expect(screen.getByTestId("human-gate-queue")).toHaveTextContent("plan");
    });

    fireEvent.click(screen.getByTestId("dismiss-gate-65766_0543_demo-feature-plan"));

    await waitFor(() => {
      expect(screen.queryByTestId("human-gate-banner")).not.toBeInTheDocument();
      expect(screen.getByTestId("next-action-dismissed-gates")).toBeInTheDocument();
    });
  });

  it("renders read-only runtime configuration panel", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      const panel = screen.getByTestId("config-readonly-panel");
      expect(panel).toHaveAttribute("aria-readonly", "true");
      expect(screen.getByTestId("config-invocation-mode")).toHaveTextContent("sdk");
      expect(screen.getByTestId("config-stage-remediation")).toHaveTextContent("true");
      expect(screen.getByTestId("config-sdk-sampling")).toHaveTextContent("10% · feature-delivery");
      expect(screen.getByTestId("config-escalation-badges")).toHaveTextContent("coder");
    });
  });

  it("defaults to the pipeline module with a 10-stage grid including compliance", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("stage-grid")).toBeInTheDocument();
      expect(screen.getByTestId("task-cockpit-65766_0543_demo-feature")).toHaveTextContent(
        "65766_0543_demo-feature (2026-06-02 05:43 UTC)",
      );
      expect(screen.getByTestId("stage-cell-intake")).toHaveTextContent("Intake ratified");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("tech-lead");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("Ratify the plan");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("pnpm -w exec pan advance");
      expect(screen.getByTestId("stage-cell-compliance")).toBeInTheDocument();
    });

    expect(screen.getByTestId("stage-cell-implement")).not.toHaveTextContent("pnpm -w exec pan advance");
  });

  it("renders an explicit empty state when no active tasks exist", async () => {
    mockFetchForDashboard({ runState: [] });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("next-action-panel")).toHaveTextContent("No active feature-delivery tasks");
    });
  });

  it("renders reverse-chronological run-event timeline entries", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      const timeline = screen.getByTestId("run-timeline");
      const headings = [...timeline.querySelectorAll("h4")].map((node) => node.textContent);
      expect(headings).toEqual(["tech-lead", "intake-analyst"]);
    });
  });

  it("does not render the mtime activity feed on the default pipeline view", async () => {
    const fetchMock = mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("pipeline-module")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/activity"))).toBe(false);
    expect(screen.queryByTestId("activity-feed")).not.toBeInTheDocument();
  });

  it("shows the file browser only on the files module tab", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: ".pan/work/sample.md", name: "sample.md", kind: "file" }],
    });

    render(<DashboardPage />);

    expect(screen.queryByText("sample.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("module-tab-files"));

    await waitFor(() => {
      expect(screen.getByText("sample.md")).toBeInTheDocument();
    });
  });

  it("opens next-prompt from Next Action in a read-only file modal", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      fileContent: "next prompt body",
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("open-next-prompt-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("open-next-prompt-button"));

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
      expect(screen.getByDisplayValue("next prompt body")).toBeInTheDocument();
      expect(screen.getByTestId("readonly-indicator")).toHaveTextContent("Read-only");
    });
  });

  it("opens the inline modal with file content from the files tab", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: ".pan/work/sample.md", name: "sample.md", kind: "file" }],
    });

    render(<DashboardPage />);
    await openSampleFileInModal();

    expect(screen.getByDisplayValue("modal content")).toBeInTheDocument();
  });

  it("opens the file modal in read-only mode with an edit affordance", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: ".pan/work/sample.md", name: "sample.md", kind: "file" }],
    });

    render(<DashboardPage />);
    await openSampleFileInModal();

    const textarea = screen.getByDisplayValue("modal content");
    expect(textarea).toHaveAttribute("readOnly");
    expect(screen.getByTestId("readonly-indicator")).toHaveTextContent("Read-only");
    expect(screen.getByTestId("edit-button")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("keeps save disabled when draft matches content", async () => {
    const postCalls: { path: string; content: string }[] = [];
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: ".pan/work/sample.md", name: "sample.md", kind: "file" }],
      fileContent: "unchanged content",
      postCalls,
    });

    render(<DashboardPage />);
    await openSampleFileInModal();

    fireEvent.click(screen.getByTestId("edit-button"));

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);

    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirm-save")).not.toBeInTheDocument();
    expect(postCalls).toHaveLength(0);
  });

  it("shows diff review before any file write occurs", async () => {
    const postCalls: { path: string; content: string }[] = [];
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: ".pan/work/sample.md", name: "sample.md", kind: "file" }],
      fileContent: "original line",
      postCalls,
    });

    render(<DashboardPage />);
    await openSampleFileInModal();

    fireEvent.click(screen.getByTestId("edit-button"));
    const textarea = screen.getByDisplayValue("original line");
    fireEvent.change(textarea, { target: { value: "modified line" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-save")).toBeInTheDocument();
      expect(screen.getByTestId("cancel-save")).toBeInTheDocument();
    });

    expect(postCalls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("confirm-save"));

    await waitFor(() => {
      expect(postCalls).toHaveLength(1);
      expect(postCalls[0]).toEqual({
        path: ".pan/work/sample.md",
        content: "modified line",
      });
    });
  });

  it("blocks confirm-save for guarded pipeline-owned paths opened from Next Action", async () => {
    const postCalls: { path: string; content: string }[] = [];
    mockFetchForDashboard({
      runState: mockRunState,
      fileContent: "pipeline next prompt",
      postCalls,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("open-next-prompt-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("open-next-prompt-button"));

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-button"));
    fireEvent.change(screen.getByDisplayValue("pipeline next prompt"), {
      target: { value: "unsafe edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-save")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("confirm-save"));

    const modal = screen.getByTestId("file-modal");

    await waitFor(() => {
      expect(within(modal).getByTestId("write-guard-error")).toHaveTextContent(
        "Write blocked: .pan/work/172973_06-02-26/65766_0543_demo-feature/next-prompt.md is a pipeline-owned file.",
      );
    });

    expect(postCalls).toHaveLength(0);
    expect(within(modal).queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("starts live polling while a task has an active stage", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetchForDashboard({ runState: mockRunState });
      render(<DashboardPage />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("live-refresh-indicator")).toBeInTheDocument();

      const initialCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/run-state"),
      ).length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7500);
        await Promise.resolve();
      });

      const pollCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/run-state"),
      ).length;
      expect(pollCalls).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops live polling when no task has an active stage", async () => {
    const terminalRunState = [
      {
        ...mockRunState[0],
        stages: mockRunState[0].stages.map((stage) =>
          stage.status === "active" ? { ...stage, status: "complete" } : stage,
        ),
      },
    ];
    mockFetchForDashboard({ runState: terminalRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("live-refresh-indicator")).not.toBeInTheDocument();
    });
  });

  it("appends new timeline events on poll without discarding prior entries", async () => {
    vi.useFakeTimers();
    let pollCount = 0;
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const orientation = orientationFetchResponse(url);
      if (orientation !== null) {
        return orientation;
      }
      if (url.includes("/api/run-state")) {
        pollCount += 1;
        const runEvents =
          pollCount <= 1
            ? mockRunState[0].runEvents
            : [
                {
                  timestamp: "2026-06-02T13:00:00.000Z",
                  event: "coder",
                  message: "coder · implement: success",
                },
                ...mockRunState[0].runEvents,
              ];
        return new Response(stringifyCompactJson([{ ...mockRunState[0], runEvents }]), {
          status: 200,
        });
      }
      if (url.includes("/api/config")) {
        return new Response(stringifyCompactJson(mockConfig), { status: 200 });
      }
      if (url.includes("/api/file")) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(stringifyCompactJson({}), { status: 404 });
    });

    try {
      render(<DashboardPage />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("run-timeline")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7500);
        await Promise.resolve();
      });

      const timeline = screen.getByTestId("run-timeline");
      const headings = [...timeline.querySelectorAll("h4")].map((node) => node.textContent);
      expect(headings[0]).toContain("coder");
      expect(headings).toHaveLength(3);
    } finally {
      vi.useRealTimers();
      fetchMock.mockRestore();
    }
  });

  it("opens artifact drawer with present and missing rows", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const orientation = orientationFetchResponse(url);
      if (orientation !== null) {
        return orientation;
      }
      if (url.includes("/api/run-state")) {
        return new Response(stringifyCompactJson(mockRunState), { status: 200 });
      }
      if (url.includes("/api/config")) {
        return new Response(stringifyCompactJson(mockConfig), { status: 200 });
      }
      if (url.includes("/api/file?path=%2Ework%2F172973_06-02-26%2F65766_0543_demo-feature%2Fplan.md")) {
        return new Response(stringifyCompactJson({ content: "plan body" }), { status: 200 });
      }
      if (url.includes("/api/file")) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(stringifyCompactJson({}), { status: 404 });
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("stage-cell-plan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("stage-cell-plan"));

    await waitFor(() => {
      const drawer = screen.getByTestId("artifact-drawer");
      expect(within(drawer).getByText("plan.md")).toBeInTheDocument();
      expect(within(drawer).getAllByText("Missing").length).toBeGreaterThan(0);
    });

    fetchMock.mockRestore();
  });

  it("opens drawer artifacts in the read-only Files modal", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const orientation = orientationFetchResponse(url);
      if (orientation !== null) {
        return orientation;
      }
      if (url.includes("/api/run-state")) {
        return new Response(stringifyCompactJson(mockRunState), { status: 200 });
      }
      if (url.includes("/api/config")) {
        return new Response(stringifyCompactJson(mockConfig), { status: 200 });
      }
      if (url.includes("/api/file") && url.includes("65766_0543_demo-feature")) {
        return new Response(stringifyCompactJson({ content: "plan from drawer" }), { status: 200 });
      }
      if (url.includes("/api/file")) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(stringifyCompactJson({}), { status: 404 });
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("stage-cell-plan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("stage-cell-plan"));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-drawer")).toBeInTheDocument();
    });

    const drawer = screen.getByTestId("artifact-drawer");
    await waitFor(() => {
      const planButton = within(drawer).getByText("plan.md").closest("button");
      expect(planButton).not.toBeNull();
      expect(planButton).not.toBeDisabled();
    });
    fireEvent.click(within(drawer).getByText("plan.md"));

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
      expect(screen.getByDisplayValue("plan from drawer")).toBeInTheDocument();
      expect(screen.getByTestId("readonly-indicator")).toHaveTextContent("Read-only");
    });

    fetchMock.mockRestore();
  });

  it("renders telemetry badges on timeline events and active-cell chip", async () => {
    const telemetryRunState = [
      {
        ...mockRunState[0],
        runEvents: [
          {
            timestamp: "2026-06-02T12:00:00.000Z",
            event: "cursor.runner.escalation",
            message: "escalation logged",
            name: "cursor.runner.escalation",
            stageId: "plan",
            escalationLabel: "composer-2.5[fast=false]",
          },
          ...mockRunState[0].runEvents,
        ],
      },
    ];
    mockFetchForDashboard({ runState: telemetryRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      const planCell = screen.getByTestId("stage-cell-plan");
      expect(within(planCell).getByText("composer-2.5[fast=false]")).toBeInTheDocument();
      const timeline = screen.getByTestId("run-timeline");
      expect(within(timeline).getByText("composer-2.5[fast=false]")).toBeInTheDocument();
    });
  });

  it("omits elapsed time on active cells without matching run-log timestamps", async () => {
    const noTimestampRunState = [
      {
        ...mockRunState[0],
        runEvents: [
          {
            timestamp: "2026-06-01T10:00:00.000Z",
            event: "intake-analyst",
            message: "intake only",
            stageId: "intake",
          },
        ],
      },
    ];
    mockFetchForDashboard({ runState: noTimestampRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      const planCell = screen.getByTestId("stage-cell-plan");
      expect(planCell.querySelector(".stage-elapsed-time")).not.toBeInTheDocument();
    });
  });

  it("drills into directories instead of opening them as files", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const orientation = orientationFetchResponse(url);
      if (orientation !== null) {
        return orientation;
      }
      if (url.includes("/api/run-state")) {
        return new Response(stringifyCompactJson(mockRunState), { status: 200 });
      }
      if (url.includes("/api/config")) {
        return new Response(stringifyCompactJson(mockConfig), { status: 200 });
      }
      if (url.includes("/api/list")) {
        if (url.includes("172973_06-02-26") && url.includes("65766_0543_demo-feature")) {
          return new Response(stringifyCompactJson({ entries: [] }), { status: 200 });
        }
        if (url.includes("172973_06-02-26")) {
          return new Response(
            stringifyCompactJson({
              entries: [
                {
                  path: ".pan/work/172973_06-02-26/65766_0543_demo-feature",
                  name: "65766_0543_demo-feature",
                  kind: "directory",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes(".pan%2Fwork") || url.includes("path=.pan/work")) {
          return new Response(
            stringifyCompactJson({
              entries: [{ path: ".pan/work/172973_06-02-26", name: "172973_06-02-26", kind: "directory" }],
            }),
            { status: 200 },
          );
        }
      }
      return new Response(stringifyCompactJson({ entries: [] }), { status: 200 });
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-files"));

    await waitFor(() => {
      expect(screen.getByText("172973_06-02-26")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("172973_06-02-26"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/list\?path=.*172973_06-02-26/),
      );
      expect(screen.getByText("65766_0543_demo-feature")).toBeInTheDocument();
    });
  });

  it("renders active memory header fields from the orientation API", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("active-memory-header")).toBeInTheDocument();
      expect(screen.getByTestId("active-memory-label")).toHaveTextContent("Demo orientation");
      expect(screen.queryByTestId("active-memory-path")).not.toBeInTheDocument();
      expect(screen.getByTestId("active-memory-copy-path")).toBeInTheDocument();
      expect(screen.getAllByText("Blocker one")[0]).toBeInTheDocument();
      expect(screen.getByTestId("active-memory-refreshed")).not.toHaveTextContent("2026-06-08T10:07:29.699Z");
      expect(screen.getByTestId("active-memory-refresh-procedure")).toHaveTextContent("Open OPERATION.md");
    });
  });

  it("hides inbox paths and enforces craft gates on the active memory header", async () => {
    const recentTimestamp = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    mockFetchForDashboard({
      runState: mockRunState,
      activeMemory: {
        activeFeaturePath: "lib/inbox/in/demo-orientation.md",
        activeFeatureLabel: "Demo orientation",
        activeFeatureSlug: "demo-orientation",
        blockersSummary: "One · Two · Three",
        blockerChips: ["One", "Two", "Three", "Four", "Five"],
        refreshTimestamp: recentTimestamp,
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      const header = screen.getByTestId("active-memory-header");
      const probe = probeActiveMemoryHeader(header);
      expect(probe.containsLibInbox).toBe(false);
      expect(probe.borderStyle).not.toBe("dashed");
      expect(probe.overflow).toBe(false);

      const label = screen.getByTestId("active-memory-label");
      expect(label).toHaveClass("active-memory-label");
      expect(label).not.toHaveClass("active-memory-label-idle");
      expect(label.textContent).toBe("Demo orientation");

      const cta = screen.getByTestId("active-memory-refresh-procedure");
      expect(cta).toHaveTextContent("Open OPERATION.md");
      expect(cta).toHaveAttribute("aria-describedby", "active-memory-refreshed-at");

      const time = screen.getByTestId("active-memory-refreshed").querySelector("time");
      expect(time).toHaveAttribute("datetime", recentTimestamp);
      expect(time?.textContent).toMatch(/Refreshed \d+ minutes ago/u);
      expect(time?.textContent).not.toMatch(/T\d{2}:/u);

      expect(screen.getByTestId("active-memory-blockers-toggle")).toBeInTheDocument();
      expect(header.querySelectorAll(".active-memory-blocker-chip")).toHaveLength(3);
      expect(screen.queryByText("Four")).not.toBeInTheDocument();
    });
  });

  it("expands blocker chips when the toggle is activated", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      activeMemory: {
        ...mockActiveMemory,
        blockerChips: ["One", "Two", "Three", "Four", "Five"],
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("active-memory-blockers-toggle")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("active-memory-blockers-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Four")).toBeInTheDocument();
      expect(screen.getByText("Five")).toBeInTheDocument();
      expect(screen.getByTestId("active-memory-blockers-toggle")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("active-memory-blockers")).toHaveAttribute("data-expanded", "true");
    });
  });

  it("shows idle copy when no active feature is set", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      activeMemory: {
        activeFeaturePath: null,
        activeFeatureLabel: null,
        activeFeatureSlug: null,
        blockersSummary: "",
        blockerChips: [],
        refreshTimestamp: null,
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("active-memory-label")).toHaveTextContent(
        "No active feature — triage inbox or start a run",
      );
      expect(screen.queryByTestId("active-memory-copy-path")).not.toBeInTheDocument();
    });
  });

  it("renders inbox triage panel entries", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("inbox-triage-panel")).toBeInTheDocument();
      expect(screen.getByTestId("inbox-row-demo-orientation")).toHaveTextContent("Demo orientation");
      expect(screen.getByTestId("inbox-row-demo-orientation")).toHaveTextContent("3h");
    });
  });

  it("sorts multi-run rows by last event and human gate", async () => {
    mockFetchForDashboard({ runState: [mockRunState[0], mockRunStateSecondTask] });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("multi-run-table")).toBeInTheDocument();
    });

    const rowLabels = [...screen.getAllByTestId(/multi-run-row-/u)].map((row) =>
      row.textContent?.includes("65766_0543_demo-feature") ? "first" : "second",
    );
    expect(rowLabels[0]).toBe("first");

    fireEvent.click(screen.getByTestId("multi-run-sort-human-gate"));

    await waitFor(() => {
      const rowsAfterGateSort = [...screen.getAllByTestId(/multi-run-row-/u)];
      expect(rowsAfterGateSort[0]).toHaveTextContent("65766_0543_demo-feature");
    });
  });

  it("updates selected run context when a multi-run row is selected", async () => {
    mockFetchForDashboard({ runState: [mockRunState[0], mockRunStateSecondTask] });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("multi-run-row-88888_1200_other-feature")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("multi-run-select-88888_1200_other-feature"));

    await waitFor(() => {
      expect(screen.getByTestId("next-action-panel")).toHaveTextContent("88888_1200_other-feature");
      expect(screen.getByTestId("task-cockpit-88888_1200_other-feature")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  it("renders Automations list with enabled Run now and no-selection run-history state", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automations-module")).toBeInTheDocument();
      expect(screen.getByTestId("automation-row-hourly-coder")).toHaveTextContent("Hourly coder");
      expect(screen.getByTestId("automation-row-hourly-coder")).toHaveTextContent("Hourly");
      expect(screen.getByTestId("automation-run-now-hourly-coder")).toBeEnabled();
      expect(screen.getByTestId("automation-run-history-no-selection")).toHaveTextContent(
        "Select an automation to view run history.",
      );
    });
  });

  it("loads run history when an automation row is selected", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      automationRuns: {
        "hourly-coder": [
          {
            runId: "run-1",
            startedAt: "2026-06-08T10:00:00.000Z",
            finishedAt: "2026-06-08T10:01:00.000Z",
            status: "success",
            trigger: "manual",
            stdoutSummary: "done",
            stderrSummary: "",
          },
        ],
      },
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-select-hourly-coder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-select-hourly-coder"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-run-row-run-1")).toBeInTheDocument();
      expect(screen.getByTestId("automation-run-history-refresh")).toBeInTheDocument();
    });
  });

  it("shows no-runs empty state for a selected automation without history", async () => {
    mockFetchForDashboard({ runState: mockRunState, automationRuns: { "hourly-coder": [] } });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-select-hourly-coder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-select-hourly-coder"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-run-history-no-runs")).toHaveTextContent(
        "No runs yet. Run automation now or wait for the next scheduled tick.",
      );
    });
  });

  it("expands run history stdout after Run now and row selection", async () => {
    const automationRunCalls: string[] = [];
    mockFetchForDashboard({
      runState: mockRunState,
      automationRunCalls,
      automationRuns: {
        "hourly-coder": [
          {
            runId: "run-expanded",
            startedAt: "2026-06-08T11:00:00.000Z",
            finishedAt: "2026-06-08T11:01:00.000Z",
            status: "success",
            trigger: "manual",
            stdoutSummary: "manual dispatch ok",
            stderrSummary: "",
          },
        ],
      },
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-run-now-hourly-coder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-run-now-hourly-coder"));

    await waitFor(() => {
      expect(automationRunCalls).toContain("hourly-coder");
      expect(screen.getByTestId("automation-run-row-run-expanded")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-run-expand-run-expanded"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-run-logs-run-expanded")).toHaveTextContent(
        "manual dispatch ok",
      );
    });
  });

  it("requires pause confirmation before disabling an automation", async () => {
    const automationPutCalls: unknown[] = [];
    mockFetchForDashboard({ runState: mockRunState, automationPutCalls });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-overflow-hourly-coder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-overflow-hourly-coder"));
    fireEvent.click(screen.getByTestId("automation-pause-hourly-coder"));
    expect(automationPutCalls).toHaveLength(0);

    fireEvent.click(screen.getByTestId("automation-pause-confirm-hourly-coder"));

    await waitFor(() => {
      expect(automationPutCalls).toHaveLength(1);
      expect(automationPutCalls[0]).toMatchObject({ id: "hourly-coder", enabled: false });
    });
  });

  it("completes the four-step automation wizard with hourly preset save", async () => {
    const automationPostCalls: unknown[] = [];
    mockFetchForDashboard({ runState: mockRunState, automations: [], automationPostCalls });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-automations"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-create-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("automation-create-button"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-wizard")).toBeInTheDocument();
      expect(screen.getByTestId("automation-wizard-schedule")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hourly review" },
    });
    fireEvent.click(screen.getByTestId("automation-wizard-next"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-wizard-persona")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "coder" } });
    fireEvent.click(screen.getByTestId("automation-wizard-next"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-wizard-prompt")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Review open tasks." },
    });
    fireEvent.click(screen.getByTestId("automation-wizard-next"));

    await waitFor(() => {
      expect(screen.getByTestId("automation-wizard-review")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("automation-wizard-save"));

    await waitFor(() => {
      expect(automationPostCalls).toHaveLength(1);
      expect(automationPostCalls[0]).toMatchObject({
        schedule: "0 * * * *",
        enabled: true,
        trigger: {
          kind: "agent",
          persona: "coder",
          prompt: "Review open tasks.",
        },
      });
    });
  });

  it("requires confirmation before mutating execute actions", async () => {
    const executeCalls: string[] = [];
    mockFetchForDashboard({ runState: mockRunState, executeCalls });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("execute-advance-button")).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("execute-advance-button"));

    await waitFor(() => {
      expect(screen.getByTestId("execute-confirm-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("execute-cancel-button"));
    expect(executeCalls).toHaveLength(0);

    fireEvent.click(screen.getByTestId("execute-advance-button"));
    await waitFor(() => {
      expect(screen.getByTestId("execute-confirm-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("execute-confirm-button"));

    await waitFor(() => {
      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toContain("advance");
      expect(screen.getByTestId("execute-result-panel")).toBeInTheDocument();
      expect(screen.getByTestId("execute-exit-code")).toHaveTextContent("0");
    });
  });

  it("renders Maintenance module compliance panel and descriptor table", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-maintenance"));

    await waitFor(() => {
      expect(screen.getByTestId("maintenance-module")).toBeInTheDocument();
      expect(screen.getByTestId("compliance-audit-panel")).toBeInTheDocument();
      expect(screen.getByTestId("compliance-descriptor-json-formatting")).toBeInTheDocument();
      expect(screen.getByTestId("test-suite-picker")).toBeInTheDocument();
    });
  });

  it("runs a selected test suite preset and surfaces exit code in OutputStream", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("module-tab-maintenance"));

    await waitFor(() => {
      expect(screen.getByTestId("test-suite-preset-client")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("test-suite-preset-client"));
    fireEvent.click(screen.getByTestId("test-suite-run-button"));

    await waitFor(() => {
      expect(screen.getByTestId("output-stream-exit-code")).toHaveTextContent("Exit code: 0");
      expect(screen.getByTestId("output-stream-log")).toHaveTextContent("vitest output");
    });
  });

  it("disables pre-close validation when the selected task is not index-adjacent", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("pre-close-validation-panel")).toBeInTheDocument();
      expect(screen.getByTestId("pre-close-run-button")).toBeDisabled();
      expect(screen.getByTestId("pre-close-eligibility-helper")).toBeInTheDocument();
    });
  });

  it("enables pre-close validation when the selected task is in ship stage", async () => {
    const shipStageRunState = [
      {
        ...mockRunState[0],
        stages: mockRunState[0].stages.map((stage) => {
          if (stage.name === "ship") {
            return { ...stage, status: "active" };
          }
          if (stage.status === "active") {
            return { ...stage, status: "complete" };
          }
          return stage;
        }),
      },
    ];
    mockFetchForDashboard({ runState: shipStageRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("pre-close-run-button")).toBeEnabled();
    });
  });
});

const mockMissionControlRunState = [
  {
    taskId: "61498_0655_cockpit-v2-feature-delivery-mission-control-run-detail",
    featureId: "cockpit-v2-feature-delivery-mission-control-run-detail",
    decodedTimestamp: "2026-06-09 06:55 UTC",
    runDir: ".pan/work/172966_06-09-26/61498_0655_cockpit-v2-feature-delivery-mission-control-run-detail",
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

describe("Mission Control surface", () => {
  beforeEach(() => {
    mockMissionControlSearchParams.delete("task");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nine-stage rail with retry badges and retry-limit banner", async () => {
    mockFetchForDashboard({ runState: mockMissionControlRunState });

    render(<MissionControlPage />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-control-module")).toBeInTheDocument();
    });

    expect(screen.getByTestId("mission-control-stage-rail")).toBeInTheDocument();
    expect(screen.getByTestId("stage-cell-intake")).toBeInTheDocument();
    expect(screen.getByTestId("stage-cell-index")).toBeInTheDocument();
    expect(screen.getByTestId("retry-limit-banner")).toBeInTheDocument();
    expect(screen.getByTestId("retry-badge-implement")).toHaveTextContent("3");
  });

  it("deep-links ?task= to the named run in the header", async () => {
    mockMissionControlSearchParams.set(
      "task",
      "61498_0655_cockpit-v2-feature-delivery-mission-control-run-detail",
    );
    mockFetchForDashboard({ runState: mockMissionControlRunState });

    render(<MissionControlPage />);

    await waitFor(() => {
      expect(screen.getByTestId("run-context-header")).toHaveTextContent(
        "61498_0655_cockpit-v2-feature-delivery-mission-control-run-detail",
      );
    });
  });

  it("shows live indicator while polling a non-terminal task", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<MissionControlPage />);

    await waitFor(() => {
      expect(screen.getByTestId("mc-live-indicator")).toBeInTheDocument();
    });
  });

  it("opens artifact preview in read-only Files modal", async () => {
    mockFetchForDashboard({
      runState: mockMissionControlRunState,
      fileContent: "implementation report body",
    });

    render(<MissionControlPage />);

    await waitFor(() => {
      expect(screen.getByTestId("artifacts-by-stage")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("verbose-log-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("preview-artifact-implementation-report.md"));

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
      expect(screen.getByTestId("readonly-indicator")).toHaveTextContent("Read-only");
      expect(screen.getByDisplayValue("implementation report body")).toBeInTheDocument();
    });
  });
});

describe("Command Center default landing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockCommandCenterLandingFetch(options: { runState?: unknown[] } = {}) {
    return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/run-state")) {
        return new Response(stringifyCompactJson(options.runState ?? mockRunState), { status: 200 });
      }
      if (url.includes("/api/automations") && !url.includes("/runs")) {
        return new Response(stringifyCompactJson({ automations: [], personas: [] }), { status: 200 });
      }
      if (url.includes("/api/file")) {
        return new Response(stringifyCompactJson({ error: "missing" }), { status: 404 });
      }
      return new Response(stringifyCompactJson({}), { status: 404 });
    });
  }

  it("renders operational Command Center surface instead of placeholder", async () => {
    mockCommandCenterLandingFetch();

    render(<CommandCenterPage />);

    await waitFor(() => {
      expect(screen.getByTestId("command-center-page")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-needs-you")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-running-now")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-compliance-issues")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-hanging-tasks")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-recent-automations")).toBeInTheDocument();
      expect(screen.getByTestId("command-center-recent-activity")).toBeInTheDocument();
    });

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });

  it("shows guided empty state when no non-terminal runs exist", async () => {
    mockCommandCenterLandingFetch({ runState: [] });

    render(<CommandCenterPage />);

    await waitFor(() => {
      expect(screen.getByText("No active deliveries")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start feature delivery" })).toHaveAttribute(
        "href",
        "/work-intake",
      );
    });
  });
});

describe("formatActiveMemoryRefreshTime", () => {
  const nowMs = Date.parse("2026-06-09T12:00:00.000Z");

  it("formats recent timestamps as relative minutes", () => {
    expect(
      formatActiveMemoryRefreshTime("2026-06-09T11:48:00.000Z", nowMs),
    ).toBe("Refreshed 12 minutes ago");
  });

  it("formats yesterday timestamps without raw ISO", () => {
    const formatted = formatActiveMemoryRefreshTime("2026-06-08T11:00:00.000Z", nowMs);
    expect(formatted).toBe("Refreshed yesterday");
    expect(formatted).not.toContain("T");
  });

  it("formats older timestamps with locale date/time", () => {
    const formatted = formatActiveMemoryRefreshTime("2026-05-01T08:30:00.000Z", nowMs);
    expect(formatted).not.toContain("T");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
