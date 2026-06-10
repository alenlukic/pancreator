"use client";

import Link from "next/link";
import { AttentionBanner } from "../shared/AttentionBanner";
import { CommandCenterRow } from "./CommandCenterRow";
import type { CommandCenterCardModel } from "./command-center-types";
import { COMMAND_CENTER_STALE_DATA_MS } from "./command-center-types";

export function CommandCenterCard({
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
      className="command-center-card"
      data-testid={card.testId}
      aria-labelledby={`${card.testId}-title`}
    >
      <header className="command-center-card-header">
        <h2 className="command-center-card-title" id={`${card.testId}-title`}>
          {card.title}
          {card.rows.length > 0 ? (
            <span className="command-center-card-count"> · {card.rows.length}</span>
          ) : null}
        </h2>
        {showDataAge ? (
          <span className="command-center-data-age-badge" data-testid={`${card.testId}-data-age`}>
            Data age {Math.floor(card.dataAgeMs! / 1000)}s
          </span>
        ) : null}
        {card.overflowHref && card.rows.length >= 5 ? (
          <Link href={card.overflowHref} className="command-center-card-overflow">
            View all
          </Link>
        ) : null}
      </header>

      {card.degradedSource ? (
        <AttentionBanner title={`Degraded data from ${card.degradedSource}`}>
          <p>
            Attention data from <strong>{card.degradedSource}</strong> failed to refresh. Rows may be
            stale until you retry.
          </p>
        </AttentionBanner>
      ) : null}

      <div className="command-center-card-body">
        {loading ? (
          <div className="command-center-skeleton" aria-hidden="true">
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
          </div>
        ) : card.rows.length === 0 ? (
          <p className="command-center-empty">{card.emptyCopy}</p>
        ) : (
          card.rows.map((row) => <CommandCenterRow key={row.id} row={row} />)
        )}
      </div>
    </section>
  );
}
