import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AutomationSummary } from "@/services/automations-client";
import type { RunRecord } from "@/services/scheduler-runs";
import { AutomationListView } from "./AutomationListView";

const baseAutomations: AutomationSummary[] = [
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
  {
    id: "paused-review",
    name: "Paused review",
    enabled: false,
    schedule: "0 0 * * *",
    scheduleLabel: "Daily at midnight",
    status: "paused",
    triggerKind: "agent",
    persona: "reviewer",
  },
  {
    id: "failed-dispatch",
    name: "Failed dispatch",
    enabled: true,
    schedule: "0 0 * * 1",
    scheduleLabel: "Weekly on Monday",
    status: "scheduled",
    triggerKind: "agent",
    persona: "coder",
  },
];

const latestRuns: Record<string, RunRecord | undefined> = {
  "failed-dispatch": {
    runId: "run-error",
    startedAt: "2026-06-08T10:00:00.000Z",
    finishedAt: "2026-06-08T10:01:00.000Z",
    status: "error",
    trigger: "manual",
    stdoutSummary: "",
    stderrSummary: "boom",
  },
};

function renderList(overrides: Partial<Parameters<typeof AutomationListView>[0]> = {}) {
  const onToggleEnabled = vi.fn().mockResolvedValue(undefined);
  render(
    <AutomationListView
      automations={baseAutomations}
      selectedAutomationId={null}
      latestRunsByAutomationId={latestRuns}
      runningAutomationIds={new Set()}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onToggleEnabled={onToggleEnabled}
      onDelete={vi.fn()}
      onRunNow={vi.fn()}
      {...overrides}
    />,
  );
  return { onToggleEnabled };
}

describe("AutomationListView", () => {
  it("filters rows by search text without reloading", () => {
    renderList();
    fireEvent.change(screen.getByTestId("automations-list-search"), {
      target: { value: "paused" },
    });
    expect(screen.getByTestId("automation-row-paused-review")).toBeInTheDocument();
    expect(screen.queryByTestId("automation-row-hourly-coder")).not.toBeInTheDocument();
  });

  it("combines Failed filter with search text", () => {
    renderList();
    fireEvent.click(screen.getByTestId("automations-filter-failed"));
    fireEvent.change(screen.getByTestId("automations-list-search"), {
      target: { value: "dispatch" },
    });
    expect(screen.getByTestId("automation-row-failed-dispatch")).toBeInTheDocument();
    expect(screen.queryByTestId("automation-row-hourly-coder")).not.toBeInTheDocument();
  });

  it("shows paused and failed row treatments", () => {
    renderList();
    expect(screen.getByTestId("automation-row-paused-review")).toHaveClass("automation-row-paused");
    expect(screen.getByTestId("automation-row-failed-dispatch")).toHaveClass("automation-row-failed");
  });

  it("pauses an enabled automation without extra confirmation", async () => {
    const { onToggleEnabled } = renderList();
    fireEvent.click(screen.getByTestId("automation-toggle-hourly-coder"));

    await waitFor(() => {
      expect(onToggleEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ id: "hourly-coder" }),
        false,
      );
    });
    expect(screen.queryByTestId("automation-pause-confirm")).not.toBeInTheDocument();
  });

  it("resumes a paused automation without confirm", async () => {
    const { onToggleEnabled } = renderList();
    fireEvent.click(screen.getByTestId("automation-toggle-paused-review"));

    await waitFor(() => {
      expect(onToggleEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ id: "paused-review" }),
        true,
      );
    });
    expect(screen.queryByTestId("automation-pause-confirm")).not.toBeInTheDocument();
  });
});
