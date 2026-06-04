import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/components/DashboardPage";
import { stringifyCompactJson } from "@/lib/json-io";

const mockRunState = [
  {
    taskId: "65766_0543_demo-feature",
    decodedTimestamp: "2026-06-02 05:43 UTC",
    sourceWarning: "pan status unavailable",
    stages: [
      {
        name: "intake",
        ownerPersona: "intake-analyst",
        humanGate: "human_approval",
        nextHumanAction: "",
        nextCommand: "",
        status: "complete",
      },
      {
        name: "plan",
        ownerPersona: "tech-lead",
        humanGate: "human_approval",
        nextHumanAction: "Ratify the plan before advancing.",
        nextCommand: "pnpm -w exec pan advance 65766_0543_demo-feature --artifact touch-set.json",
        status: "active",
      },
      {
        name: "implement",
        ownerPersona: "coder",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "review",
        ownerPersona: "reviewer",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "test",
        ownerPersona: "qa-tester",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "report",
        ownerPersona: "tech-writer",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "ship",
        ownerPersona: "supervisor",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "index",
        ownerPersona: "librarian",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
        status: "pending",
      },
      {
        name: "complete",
        ownerPersona: "librarian",
        humanGate: "",
        nextHumanAction: "",
        nextCommand: "",
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

type MockFetchOptions = {
  runState?: unknown[];
  listEntries?: unknown[];
  fileContent?: string;
  postCalls?: { path: string; content: string }[];
};

function mockFetchForDashboard(options: MockFetchOptions = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/run-state")) {
      return new Response(stringifyCompactJson(options.runState ?? []), { status: 200 });
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
      return new Response(
        stringifyCompactJson({ content: options.fileContent ?? "modal content" }),
        { status: 200 },
      );
    }
    return new Response(stringifyCompactJson({}), { status: 404 });
  });
}

async function openSampleFileInModal() {
  fireEvent.click(screen.getByTestId("tab-files"));
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
  });

  it("renders navigation for the five repository domains", async () => {
    mockFetchForDashboard({});

    render(<DashboardPage />);

    expect(screen.getByTestId("domain-inbox")).toBeInTheDocument();
    expect(screen.getByTestId("domain-memory")).toBeInTheDocument();
    expect(screen.getByTestId("domain-personas")).toBeInTheDocument();
    expect(screen.getByTestId("domain-work")).toBeInTheDocument();
    expect(screen.getByTestId("domain-packages")).toBeInTheDocument();
    expect(screen.getByTestId("domain-inbox")).toHaveTextContent("lib/inbox/");
    expect(screen.getByTestId("domain-memory")).toHaveTextContent("lib/memory/");
    expect(screen.getByTestId("domain-personas")).toHaveTextContent("lib/personas/");
    expect(screen.getByTestId("domain-work")).toHaveTextContent("work/");
    expect(screen.getByTestId("domain-packages")).toHaveTextContent("lib/internal/packages/");
  });

  it("defaults to the cockpit tab with a 9-stage grid when active tasks exist", async () => {
    mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("tab-cockpit")).toHaveClass("dashboard-tab-active");
      expect(screen.getByTestId("stage-grid")).toBeInTheDocument();
      expect(screen.getByText("65766_0543_demo-feature (2026-06-02 05:43 UTC)")).toBeInTheDocument();
      expect(screen.getByTestId("stage-cell-intake")).toHaveTextContent("Gate: human_approval");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("tech-lead");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("Ratify the plan");
      expect(screen.getByTestId("stage-cell-plan")).toHaveTextContent("pnpm -w exec pan advance");
    });

    expect(screen.getByTestId("stage-cell-implement")).not.toHaveTextContent("pnpm -w exec pan advance");
  });

  it("renders an explicit empty state when no active tasks exist", async () => {
    mockFetchForDashboard({ runState: [] });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-empty")).toHaveTextContent("No active feature-delivery tasks");
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

  it("does not render the mtime activity feed on the default cockpit view", async () => {
    const fetchMock = mockFetchForDashboard({ runState: mockRunState });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("cockpit-view")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/activity"))).toBe(false);
    expect(screen.queryByTestId("activity-feed")).not.toBeInTheDocument();
  });

  it("shows the file browser only on the files tab", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: "lib/memory/sample.md", name: "sample.md", kind: "file" }],
    });

    render(<DashboardPage />);

    expect(screen.queryByText("sample.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-files"));

    await waitFor(() => {
      expect(screen.getByText("sample.md")).toBeInTheDocument();
    });
  });

  it("opens the inline modal with file content from the files tab", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: "lib/memory/sample.md", name: "sample.md", kind: "file" }],
    });

    render(<DashboardPage />);
    await openSampleFileInModal();

    expect(screen.getByDisplayValue("modal content")).toBeInTheDocument();
  });

  it("opens the file modal in read-only mode with an edit affordance", async () => {
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [{ path: "lib/memory/sample.md", name: "sample.md", kind: "file" }],
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
      listEntries: [{ path: "lib/memory/sample.md", name: "sample.md", kind: "file" }],
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
      listEntries: [{ path: "lib/memory/sample.md", name: "sample.md", kind: "file" }],
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
        path: "lib/memory/sample.md",
        content: "modified line",
      });
    });
  });

  it("blocks confirm-save for guarded pipeline-owned paths", async () => {
    const postCalls: { path: string; content: string }[] = [];
    mockFetchForDashboard({
      runState: mockRunState,
      listEntries: [
        {
          path: "work/172973_06-02-26/demo/handoff.md",
          name: "handoff.md",
          kind: "file",
        },
      ],
      fileContent: "pipeline handoff",
      postCalls,
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("tab-files"));

    await waitFor(() => {
      expect(screen.getByText("handoff.md")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("handoff.md"));

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-button"));
    fireEvent.change(screen.getByDisplayValue("pipeline handoff"), {
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
        "Write blocked: work/172973_06-02-26/demo/handoff.md is a pipeline-owned file.",
      );
    });

    expect(postCalls).toHaveLength(0);
    expect(within(modal).queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("drills into directories instead of opening them as files", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/run-state")) {
        return new Response(stringifyCompactJson(mockRunState), { status: 200 });
      }
      if (url.includes("/api/list?path=lib%2Fmemory%2Ffeatures")) {
        return new Response(
          stringifyCompactJson({
            entries: [{ path: "lib/memory/features/spec.md", name: "spec.md", kind: "file" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/list?path=lib%2Fmemory")) {
        return new Response(
          stringifyCompactJson({
            entries: [{ path: "lib/memory/features", name: "features", kind: "directory" }],
          }),
          { status: 200 },
        );
      }
      return new Response(stringifyCompactJson({ entries: [] }), { status: 200 });
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId("tab-files"));
    fireEvent.click(screen.getByTestId("domain-memory").querySelector("button")!);

    await waitFor(() => {
      expect(screen.getByText("features")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("features"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/list?path=lib%2Fmemory%2Ffeatures"));
      expect(screen.getByText("spec.md")).toBeInTheDocument();
    });
  });
});
