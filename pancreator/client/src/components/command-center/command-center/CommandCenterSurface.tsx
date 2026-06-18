"use client";

import { AttentionRegion } from "../shared/AttentionRegion";
import { AttentionBanner } from "../shared/AttentionBanner";
import { formatFailedSourceLabel } from "./command-center-data";
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
      summaryLabel: region,
      emptyCopy: "No data",
      emptyGuidance: "",
      overflowLabel: "",
      iconKey: "Hand",
      totalCount: 0,
      rows: [],
    }
  );
}

export function CommandCenterSurface() {
  const { cards, loading, failedSources, hasLastSuccessfulSnapshot, dataFetchedAtMs, retry } =
    useCommandCenterData();

  const showDegradedBanner = failedSources.length > 0;
  const sourceLabel = formatFailedSourceLabel(failedSources);

  return (
    <div className="command-center-page" data-testid="command-center-page">
      <h1 className="command-center-page-title">Home</h1>

      <div className="command-center-summary-row" data-testid="command-center-summary-row">
        {cards.map((card) => (
          <div key={card.region} className="command-center-summary-item">
            <span className="command-center-summary-label">{card.summaryLabel}</span>
            <span
              className="command-center-summary-count"
              data-testid={`command-center-summary-${card.region}-count`}
            >
              {card.totalCount}
            </span>
          </div>
        ))}
      </div>

      {showDegradedBanner ? (
        <AttentionBanner
          title="Home data is temporarily degraded"
          variant="degraded"
          action={
            <button
              type="button"
              className="command-center-row-cta command-center-degraded-retry"
              onClick={() => void retry()}
            >
              Retry Home refresh
            </button>
          }
        >
          <p>
            Showing the last successful Home snapshot while {sourceLabel} reconnects.
            {hasLastSuccessfulSnapshot && dataFetchedAtMs !== null
              ? (() => {
                  const minutes = Math.max(
                    1,
                    Math.floor((Date.now() - dataFetchedAtMs) / 60000),
                  );
                  return ` Last good refresh was ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago.`;
                })()
              : null}
          </p>
        </AttentionBanner>
      ) : null}

      <div
        className="command-center-attention-shell"
        data-testid={loading ? "command-center-loading" : "command-center-regions"}
        aria-busy={loading || undefined}
      >
        <AttentionRegion
          card={cardByRegion(cards, "human-gates")}
          loading={loading}
          isFirst
        />
        <AttentionRegion card={cardByRegion(cards, "anomalies")} loading={loading} />
        <AttentionRegion card={cardByRegion(cards, "running-now")} loading={loading} />
        <AttentionRegion card={cardByRegion(cards, "recent-outcomes")} loading={loading} />
      </div>
    </div>
  );
}
