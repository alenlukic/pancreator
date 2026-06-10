"use client";

import Link from "next/link";
import { AttentionBanner } from "../shared/AttentionBanner";
import { CommandCenterCard } from "./CommandCenterCard";
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
    outcomesError,
    isGlobalEmpty,
    isDataStale,
    dataFetchedAtMs,
    retry,
  } = useCommandCenterData();

  if (isGlobalEmpty) {
    return (
      <div className="command-center-page" data-testid="command-center-page">
        <h1 className="command-center-page-title">Home</h1>
        <div className="command-center-page-empty">
          <h2>No active deliveries</h2>
          <p>Open Feature Delivery when you are ready to supervise a run.</p>
          <Link href="/mission-control" className="command-center-row-cta">
            Open Feature Delivery
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="command-center-page" data-testid="command-center-page">
      <h1 className="command-center-page-title">Home</h1>

      {runStateError ? (
        <div className="command-center-error-banner" role="alert">
          <p>{runStateError}</p>
          <button type="button" className="command-center-row-cta" onClick={() => void retry()}>
            Retry fetch
          </button>
        </div>
      ) : null}

      {isDataStale && dataFetchedAtMs !== null ? (
        <AttentionBanner title="Attention data is stale">
          <p>
            Last successful refresh was {Math.floor((Date.now() - dataFetchedAtMs) / 1000)} seconds
            ago. Active work revalidates every 10 seconds.
          </p>
        </AttentionBanner>
      ) : null}

      <div
        className="command-center-grid command-center-grid-four"
        data-testid={loading ? "command-center-loading" : "command-center-grid"}
        aria-busy={loading || undefined}
      >
        <CommandCenterCard card={cardByRegion(cards, "human-gates")} loading={loading} />
        <CommandCenterCard card={cardByRegion(cards, "anomalies")} loading={loading} />
        <CommandCenterCard card={cardByRegion(cards, "running-now")} loading={loading} />
        <CommandCenterCard card={cardByRegion(cards, "recent-outcomes")} loading={loading} />
      </div>

      {complianceError ? (
        <AttentionBanner title="Degraded data from compliance">
          <p>{complianceError}</p>
        </AttentionBanner>
      ) : null}
      {outcomesError ? (
        <AttentionBanner title="Degraded data from feature-index">
          <p>{outcomesError}</p>
        </AttentionBanner>
      ) : null}
    </div>
  );
}
