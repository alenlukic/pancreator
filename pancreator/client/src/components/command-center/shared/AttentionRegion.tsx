"use client";

import Link from "next/link";
import { AttentionBanner } from "./AttentionBanner";
import { CommandCenterRow } from "../command-center/CommandCenterRow";
import type { CommandCenterCardModel } from "../command-center/command-center-types";
import { COMMAND_CENTER_STALE_DATA_MS } from "../command-center/command-center-types";

export function AttentionRegion({
  card,
  loading = false,
}: {
  card: CommandCenterCardModel;
  loading?: boolean;
}) {
  const showDataAge =
    card.dataAgeMs !== undefined && card.dataAgeMs > COMMAND_CENTER_STALE_DATA_MS && !loading;

  return (
    <section
      className="attention-region"
      data-testid={card.testId}
      aria-labelledby={`${card.testId}-title`}
    >
      <header className="attention-region-header">
        <h2 className="attention-region-title" id={`${card.testId}-title`}>
          {card.title}
          <span className="attention-region-count" data-testid={`${card.testId}-count`}>
            {card.rows.length}
          </span>
        </h2>
        {showDataAge ? (
          <span className="attention-region-data-age" data-testid={`${card.testId}-data-age`}>
            Data age {Math.floor(card.dataAgeMs! / 1000)}s
          </span>
        ) : null}
        {card.overflowHref && card.rows.length >= 5 ? (
          <Link
            href={card.overflowHref}
            className="command-center-row-cta attention-region-overflow"
          >
            View all
          </Link>
        ) : null}
      </header>

      {card.degradedSource ? (
        <AttentionBanner title={`Degraded data from ${card.degradedSource}`}>
          <p>
            Attention data from <strong>{card.degradedSource}</strong> failed to refresh.
          </p>
          <button type="button" className="command-center-row-cta">
            Refresh home state
          </button>
        </AttentionBanner>
      ) : null}

      <div className="attention-region-body">
        {loading ? (
          <div className="command-center-skeleton" aria-hidden="true">
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
          </div>
        ) : card.rows.length === 0 ? (
          <div className="attention-region-empty">
            <p>{card.emptyCopy}</p>
            {card.emptyNextStep ? (
              <Link href={card.emptyNextStep.href} className="command-center-row-cta">
                {card.emptyNextStep.label}
              </Link>
            ) : null}
          </div>
        ) : (
          card.rows.map((row) => <CommandCenterRow key={row.id} row={row} />)
        )}
      </div>
    </section>
  );
}
