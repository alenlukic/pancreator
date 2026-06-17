"use client";

import type { ReactNode } from "react";
import { StatusPill, type StatusPillValue } from "./StatusPill";

export function RunSummaryHeader({
  title,
  status,
  stageLabel,
  ownerPersona,
  blockingCondition,
  latestReceipt,
  primaryAction,
  meta,
  disclosures,
  testId = "run-summary-header",
}: {
  title: string;
  status: StatusPillValue;
  stageLabel?: string;
  ownerPersona?: string;
  blockingCondition?: string;
  latestReceipt?: string;
  primaryAction?: ReactNode;
  meta?: ReactNode;
  disclosures?: ReactNode;
  testId?: string;
}) {
  return (
    <header className="run-summary-header" data-testid={testId}>
      <div className="run-summary-header-primary">
        <h1 className="run-summary-header-title">{title}</h1>
        <div className="run-summary-header-status-row">
          <StatusPill status={status} />
          {meta}
        </div>
        <div className="run-summary-header-chips" data-testid="run-summary-header-chips">
          {stageLabel ? (
            <span className="run-summary-chip" data-testid="run-summary-stage">
              {stageLabel}
            </span>
          ) : null}
          {ownerPersona ? (
            <span className="run-summary-chip" data-testid="run-summary-owner">
              {ownerPersona}
            </span>
          ) : null}
          {blockingCondition ? (
            <span className="run-summary-chip run-summary-chip-blocking" data-testid="run-summary-blocking">
              {blockingCondition}
            </span>
          ) : null}
        </div>
        {latestReceipt ? (
          <p className="run-summary-latest-receipt" data-testid="run-summary-receipt">
            {latestReceipt}
          </p>
        ) : null}
      </div>
      {primaryAction ? (
        <div className="run-summary-header-action" data-testid="run-summary-primary-action">
          {primaryAction}
        </div>
      ) : null}
      {disclosures ? <div className="run-summary-header-disclosures">{disclosures}</div> : null}
    </header>
  );
}
