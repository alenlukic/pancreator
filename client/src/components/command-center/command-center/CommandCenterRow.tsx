"use client";

import Link from "next/link";
import { SeverityChip } from "../shared/SeverityChip";
import { StatusPill } from "../shared/StatusPill";
import { CommandCenterRowOverflow } from "./CommandCenterRowOverflow";
import type { CommandCenterRowModel } from "./command-center-types";

export function CommandCenterRow({ row }: { row: CommandCenterRowModel }) {
  const ctaClass = "command-center-row-cta-quiet";

  return (
    <article className="command-center-row" data-testid="command-center-row">
      <div className="command-center-row-main">
        <p className="command-center-row-label" title={row.label}>
          {row.label}
        </p>
        <div className="command-center-row-meta">
          <StatusPill status={row.status} />
          <SeverityChip severity={row.severity} />
          <time className="command-center-row-age" dateTime={row.ageIso}>
            {row.ageLabel}
          </time>
          {row.metaHint ? (
            <span className="command-center-row-meta-hint">{row.metaHint}</span>
          ) : null}
        </div>
      </div>
      <div className="command-center-row-actions">
        {row.primaryCta.href ? (
          <Link href={row.primaryCta.href} className={ctaClass}>
            {row.primaryCta.label}
          </Link>
        ) : (
          <button
            type="button"
            className={ctaClass}
            disabled={row.primaryCta.disabled}
            onClick={row.primaryCta.onClick}
          >
            {row.primaryCta.label}
          </button>
        )}
        {row.secondaryCta?.href ? (
          <Link href={row.secondaryCta.href} className="command-center-row-cta-secondary">
            {row.secondaryCta.label}
          </Link>
        ) : null}
        <CommandCenterRowOverflow {...row.overflow} />
      </div>
    </article>
  );
}
