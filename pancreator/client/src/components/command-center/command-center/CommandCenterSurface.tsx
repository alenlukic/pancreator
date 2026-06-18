"use client";

import { AttentionRegion } from "../shared/AttentionRegion";
import { AttentionBanner } from "../shared/AttentionBanner";
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
    archiveError,
    isDataStale,
    dataFetchedAtMs,
    retry,
  } = useCommandCenterData();

  const degradedSources = [
    archiveError ? { source: "archive", message: archiveError } : null,
    outcomesError ? { source: "feature-index", message: outcomesError } : null,
    complianceError ? { source: "compliance", message: complianceError } : null,
  ].filter((entry): entry is { source: string; message: string } => entry !== null);

  return (
    <div className="command-center-page" data-testid="command-center-page">
      <h1 className="command-center-page-title">Home</h1>

      {runStateError ? (
        <div className="command-center-error-banner" role="alert">
          <p>{runStateError}</p>
          <button type="button" className="command-center-row-cta" onClick={() => void retry()}>
            Refresh home state
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

      {degradedSources.map((entry) => (
        <AttentionBanner key={entry.source} title={`Degraded data from ${entry.source}`}>
          <p>{entry.message}</p>
          <button type="button" className="command-center-row-cta" onClick={() => void retry()}>
            Refresh home state
          </button>
        </AttentionBanner>
      ))}

      <div
        className="command-center-regions-column"
        data-testid={loading ? "command-center-loading" : "command-center-regions"}
        aria-busy={loading || undefined}
      >
        <AttentionRegion card={cardByRegion(cards, "human-gates")} loading={loading} />
        <AttentionRegion card={cardByRegion(cards, "anomalies")} loading={loading} />
        <AttentionRegion card={cardByRegion(cards, "running-now")} loading={loading} />
        <AttentionRegion card={cardByRegion(cards, "recent-outcomes")} loading={loading} />
      </div>
    </div>
  );
}
