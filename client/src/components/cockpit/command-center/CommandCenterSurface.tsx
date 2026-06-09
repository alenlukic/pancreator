"use client";

import Link from "next/link";
import { ComplianceIssuesCard } from "./cards/ComplianceIssuesCard";
import { HangingTasksCard } from "./cards/HangingTasksCard";
import { NeedsYouCard } from "./cards/NeedsYouCard";
import { RecentActivityCard } from "./cards/RecentActivityCard";
import { RecentAutomationsCard } from "./cards/RecentAutomationsCard";
import { RunningNowCard } from "./cards/RunningNowCard";
import type { CommandCenterCardModel } from "./command-center-types";
import { useCommandCenterData } from "./useCommandCenterData";

function cardByRegion(
  cards: CommandCenterCardModel[],
  region: CommandCenterCardModel["region"],
): CommandCenterCardModel {
  return (
    cards.find((card) => card.region === region) ?? {
      region,
      testId: `command-center-${region}`,
      title: region,
      emptyCopy: "No data",
      rows: [],
    }
  );
}

export function CommandCenterSurface() {
  const {
    cards,
    loading,
    runStateError,
    complianceError,
    automationError,
    isGlobalEmpty,
    retry,
  } = useCommandCenterData();

  if (isGlobalEmpty) {
    return (
      <div className="command-center-page" data-testid="command-center-page">
        <h1 className="command-center-page-title">Command Center</h1>
        <div className="command-center-page-empty">
          <h2>No active deliveries</h2>
          <p>Start a feature-delivery run from Work Intake when you are ready to kick off.</p>
          <Link href="/work-intake" className="command-center-row-cta">
            Start feature delivery
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="command-center-page" data-testid="command-center-page">
      <h1 className="command-center-page-title">Command Center</h1>

      {runStateError ? (
        <div className="command-center-error-banner" role="alert">
          <p>{runStateError}</p>
          <button type="button" className="command-center-row-cta" onClick={() => void retry()}>
            Retry fetch
          </button>
        </div>
      ) : null}

      <div
        className="command-center-grid"
        data-testid={loading ? "command-center-loading" : "command-center-grid"}
        aria-busy={loading || undefined}
      >
        <div className="command-center-grid-full">
          <NeedsYouCard card={cardByRegion(cards, "needs-you")} loading={loading} />
        </div>
        <div className="command-center-grid-two-col">
          <RunningNowCard card={cardByRegion(cards, "running-now")} loading={loading} />
          <ComplianceIssuesCard
            card={cardByRegion(cards, "compliance-issues")}
            loading={loading}
          />
          <HangingTasksCard card={cardByRegion(cards, "hanging-tasks")} loading={loading} />
          <RecentAutomationsCard
            card={cardByRegion(cards, "recent-automations")}
            loading={loading}
          />
        </div>
        <div className="command-center-grid-full">
          <RecentActivityCard card={cardByRegion(cards, "recent-activity")} loading={loading} />
        </div>
      </div>

      {complianceError ? (
        <p className="command-center-inline-error" role="status">
          {complianceError}
        </p>
      ) : null}
      {automationError ? (
        <p className="command-center-inline-error" role="status">
          {automationError}
        </p>
      ) : null}
    </div>
  );
}
