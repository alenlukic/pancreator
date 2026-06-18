"use client";

import Link from "next/link";
import { CommandCenterRow } from "./CommandCenterRow";
import type { CommandCenterCardModel } from "./command-center-types";
import { COMMAND_CENTER_MAX_ROWS_PER_REGION } from "./command-center-types";
import { formatSectionFreshness } from "./command-center-data";

export function CommandCenterCard({
  card,
  loading = false,
}: {
  card: CommandCenterCardModel;
  loading?: boolean;
}) {
  const freshnessLabel =
    card.dataAgeMs !== undefined ? formatSectionFreshness(card.dataAgeMs) : "";
  const showFreshness = freshnessLabel.length > 0 && !loading;
  const showOverflow =
    card.overflowHref !== undefined && card.totalCount > COMMAND_CENTER_MAX_ROWS_PER_REGION;

  return (
    <section
      className="command-center-card"
      data-testid={card.testId}
      aria-labelledby={`${card.testId}-title`}
    >
      <header className="command-center-card-header">
        <h2 className="command-center-card-title" id={`${card.testId}-title`}>
          {card.title}
          <span className="command-center-card-count"> · {card.totalCount}</span>
        </h2>
        {showFreshness ? (
          <span className="command-center-data-age-badge" data-testid={`${card.testId}-data-age`}>
            {freshnessLabel}
          </span>
        ) : null}
        {showOverflow ? (
          <Link href={card.overflowHref!} className="command-center-row-cta command-center-card-overflow">
            {card.overflowLabel}
          </Link>
        ) : null}
      </header>

      <div className="command-center-card-body">
        {loading ? (
          <div className="command-center-skeleton" aria-hidden="true">
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
          </div>
        ) : card.rows.length === 0 ? (
          <div className="command-center-empty">
            <p>{card.emptyCopy}</p>
            <p>{card.emptyGuidance}</p>
          </div>
        ) : (
          card.rows.map((row) => <CommandCenterRow key={row.id} row={row} />)
        )}
      </div>
    </section>
  );
}
