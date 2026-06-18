import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityReceiptFeed } from "./ActivityReceiptFeed";
import { AttentionBanner } from "./AttentionBanner";
import { AttentionRegion } from "./AttentionRegion";
import { MetadataDisclosure } from "./MetadataDisclosure";
import { RunSummaryHeader } from "./RunSummaryHeader";
import { SemanticStatusCard } from "./SemanticStatusCard";

describe("MetadataDisclosure", () => {
  it("keeps content closed by default", () => {
    render(
      <MetadataDisclosure label="metadata">
        <p>Hidden content</p>
      </MetadataDisclosure>,
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show metadata" }));
    expect(screen.getByText("Hidden content")).toBeInTheDocument();
  });
});

describe("ActivityReceiptFeed", () => {
  it("renders receipt fields including fallback without artifact link", () => {
    render(
      <ActivityReceiptFeed
        receipts={[
          {
            id: "r1",
            actor: "operator",
            verb: "paused",
            object: "Hourly coder",
            timestamp: "2026-06-16T12:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("operator")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
    expect(screen.getByText("Hourly coder")).toBeInTheDocument();
  });
});

describe("RunSummaryHeader", () => {
  it("shows stage, owner, blocking condition, and receipt before disclosures", () => {
    render(
      <RunSummaryHeader
        title="Demo Feature"
        status="Running"
        stageLabel="plan stage"
        ownerPersona="tech-lead"
        blockingCondition="Ratify plan"
        latestReceipt="Plan stage completed"
      />,
    );
    expect(screen.getByTestId("run-summary-stage")).toHaveTextContent("plan stage");
    expect(screen.getByTestId("run-summary-owner")).toHaveTextContent("tech-lead");
    expect(screen.getByTestId("run-summary-blocking")).toHaveTextContent("Ratify plan");
    expect(screen.getByTestId("run-summary-receipt")).toHaveTextContent("Plan stage completed");
  });
});

describe("SemanticStatusCard", () => {
  it("renders posture, consequence, and next step", () => {
    render(
      <SemanticStatusCard
        title="Compliance posture degraded"
        consequence="Two blocking findings remain open."
        nextStep="Re-run compliance audit for json-formatting."
      />,
    );
    expect(screen.getByText("Compliance posture degraded")).toBeInTheDocument();
    expect(screen.getByText(/Two blocking findings/)).toBeInTheDocument();
  });
});

describe("AttentionBanner", () => {
  it("renders the default layout without degraded chrome", () => {
    render(
      <AttentionBanner title="Healthy attention">
        <p>All sources connected.</p>
      </AttentionBanner>,
    );
    expect(screen.getByRole("status", { name: "Healthy attention" })).toBeInTheDocument();
    expect(screen.getByText("All sources connected.")).toBeInTheDocument();
  });
});

describe("AttentionRegion", () => {
  it("shows count chip and empty state", () => {
    render(
      <AttentionRegion
        card={{
          region: "human-gates",
          testId: "command-center-human-gates",
          title: "Blocked on human",
          summaryLabel: "Blocked on human",
          emptyCopy: "No approval requests yet.",
          emptyGuidance:
            "Approval requests appear after a Feature Delivery run reaches a human gate.",
          overflowLabel: "Open all approval requests",
          iconKey: "Hand",
          totalCount: 0,
          rows: [],
        }}
      />,
    );
    expect(screen.getByTestId("command-center-human-gates-count")).toHaveTextContent("0");
    expect(screen.getByText("No approval requests yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Approval requests appear after a Feature Delivery run reaches a human gate.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Feature Delivery" })).not.toBeInTheDocument();
  });

  it("shows mapped overflow label and relative freshness above threshold", () => {
    render(
      <AttentionRegion
        card={{
          region: "anomalies",
          testId: "command-center-anomalies",
          title: "Anomalies",
          summaryLabel: "Anomalies",
          emptyCopy: "No delivery anomalies.",
          emptyGuidance: "Failed or hanging runs appear here when delivery health degrades.",
          overflowLabel: "Open all anomalies",
          iconKey: "TriangleAlert",
          totalCount: 6,
          rows: Array.from({ length: 5 }, (_, index) => ({
            id: `row-${index}`,
            label: `Anomaly ${index}`,
            status: "Failed" as const,
            severity: "Critical" as const,
            ageIso: "2026-06-02T12:00:00.000Z",
            ageLabel: "5m ago",
            primaryCta: { label: "Open failed run", href: "/mission-control" },
            overflow: {},
          })),
          overflowHref: "/compliance",
          dataAgeMs: 120_000,
        }}
      />,
    );

    expect(screen.getByTestId("command-center-anomalies-count")).toHaveTextContent("6");
    expect(screen.getByRole("link", { name: "Open all anomalies" })).toBeInTheDocument();
    expect(screen.getByTestId("command-center-anomalies-freshness")).toHaveTextContent(
      "Updated 2m ago",
    );
    expect(screen.queryByText(/Data age \d+s/u)).not.toBeInTheDocument();
  });
});
