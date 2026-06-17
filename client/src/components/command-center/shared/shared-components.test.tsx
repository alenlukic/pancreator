import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityReceiptFeed } from "./ActivityReceiptFeed";
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

describe("AttentionRegion", () => {
  it("shows count chip and empty state", () => {
    render(
      <AttentionRegion
        card={{
          region: "human-gates",
          testId: "command-center-human-gates",
          title: "Blocked on human",
          emptyCopy: "No human gates waiting",
          rows: [],
          emptyNextStep: { label: "Open Feature Delivery", href: "/mission-control" },
        }}
      />,
    );
    expect(screen.getByTestId("command-center-human-gates-count")).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: "Open Feature Delivery" })).toBeInTheDocument();
  });
});
