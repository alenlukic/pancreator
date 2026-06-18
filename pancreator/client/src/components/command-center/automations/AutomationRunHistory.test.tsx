import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@/services/scheduler-runs";
import { AutomationRunHistory } from "./AutomationRunHistory";

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

const errorRun: RunRecord = {
  runId: "run-error",
  startedAt: "2026-06-08T10:00:00.000Z",
  finishedAt: "2026-06-08T10:01:00.000Z",
  status: "error",
  trigger: "manual",
  stdoutSummary: "",
  stderrSummary: "dispatch failed",
  taskId: "65766_0543_demo-feature",
};

describe("AutomationRunHistory", () => {
  it("exposes retry and mission control links on failed enabled runs", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <AutomationRunHistory
        selectedAutomationId="hourly-coder"
        selectedAutomationName="Hourly coder"
        selectedAutomationEnabled
        runs={[errorRun]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId("automation-run-history-refresh")).toHaveTextContent(
      "Refresh run history",
    );
    expect(screen.getByTestId("automation-run-retry-run-error")).toBeInTheDocument();
    expect(screen.queryByText("65766_0543_demo-feature")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("automation-run-expand-run-error"));

    await waitFor(() => {
      const missionControl = screen.getByTestId("automation-run-mission-control-run-error");
      expect(missionControl).toHaveTextContent("Open mission control");
      expect(missionControl).toHaveAttribute(
        "href",
        "/mission-control?task=65766_0543_demo-feature",
      );
    });

    fireEvent.click(screen.getByTestId("automation-run-retry-run-error"));

    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  it("labels dry-run records explicitly", () => {
    const dryRun: RunRecord = {
      runId: "run-dry",
      startedAt: "2026-06-08T10:00:00.000Z",
      finishedAt: "2026-06-08T10:00:00.000Z",
      status: "skipped",
      trigger: "manual",
      executionMode: "dry-run",
      stdoutSummary: "Archive/delete the following items",
      stderrSummary: "Dry-run mode",
    };
    render(
      <AutomationRunHistory
        selectedAutomationId="archiver"
        selectedAutomationName="Archiver"
        selectedAutomationEnabled
        runs={[dryRun]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("run-status-badge-dry run")).toHaveTextContent("dry run");
  });

  it("hides retry when the automation is paused", () => {
    render(
      <AutomationRunHistory
        selectedAutomationId="hourly-coder"
        selectedAutomationName="Hourly coder"
        selectedAutomationEnabled={false}
        runs={[errorRun]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("automation-run-retry-run-error")).not.toBeInTheDocument();
  });
});
