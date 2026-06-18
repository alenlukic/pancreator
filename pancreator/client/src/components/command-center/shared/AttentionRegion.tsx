"use client";

import Link from "next/link";
import { CheckCircle2, Hand, LoaderCircle, TriangleAlert } from "lucide-react";
import { CommandCenterRow } from "../command-center/CommandCenterRow";
import type { CommandCenterCardModel, CommandCenterRegionIconKey } from "../command-center/command-center-types";
import { formatSectionFreshness } from "../command-center/command-center-data";
import { COMMAND_CENTER_MAX_ROWS_PER_REGION } from "../command-center/command-center-types";

const REGION_ICONS: Record<
  CommandCenterRegionIconKey,
  typeof Hand
> = {
  Hand,
  TriangleAlert,
  LoaderCircle,
  CheckCircle2,
};

export function AttentionRegion({
  card,
  loading = false,
  isFirst = false,
}: {
  card: CommandCenterCardModel;
  loading?: boolean;
  isFirst?: boolean;
}) {
  const Icon = REGION_ICONS[card.iconKey];
  const freshnessLabel =
    card.dataAgeMs !== undefined ? formatSectionFreshness(card.dataAgeMs) : "";
  const showFreshness = freshnessLabel.length > 0 && !loading;
  const showOverflow =
    card.overflowHref !== undefined && card.totalCount > COMMAND_CENTER_MAX_ROWS_PER_REGION;

  return (
    <section
      className={`attention-region${isFirst ? " attention-region-first" : ""}`}
      data-testid={card.testId}
      aria-labelledby={`${card.testId}-title`}
    >
      <header className="attention-region-header">
        <h2 className="attention-region-title" id={`${card.testId}-title`}>
          <Icon aria-hidden="true" className="attention-region-icon" size={16} />
          {card.title}
          <span className="attention-region-count" data-testid={`${card.testId}-count`}>
            {card.totalCount}
          </span>
        </h2>
        <div className="attention-region-meta">
          {showFreshness ? (
            <span className="attention-region-freshness" data-testid={`${card.testId}-freshness`}>
              {freshnessLabel}
            </span>
          ) : null}
          {showOverflow ? (
            <Link
              href={card.overflowHref!}
              className="attention-region-overflow"
              data-testid={`${card.testId}-overflow`}
            >
              {card.overflowLabel}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="attention-region-body">
        {loading ? (
          <div className="command-center-skeleton" aria-hidden="true">
            <div className="command-center-skeleton-row" />
            <div className="command-center-skeleton-row" />
          </div>
        ) : card.rows.length === 0 ? (
          <div className="attention-region-empty">
            <p className="attention-region-empty-lead">{card.emptyCopy}</p>
            <p className="attention-region-empty-guidance">{card.emptyGuidance}</p>
          </div>
        ) : (
          card.rows.map((row) => <CommandCenterRow key={row.id} row={row} />)
        )}
      </div>
    </section>
  );
}
