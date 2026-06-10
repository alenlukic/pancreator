"use client";

import { CommandCenterRow } from "./CommandCenterRow";
import type { CommandCenterCardModel } from "./command-center-types";

export function CommandCenterCard({
  card,
  loading = false,
}: {
  card: CommandCenterCardModel;
  loading?: boolean;
}) {
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
      </header>
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
