"use client";

import type { ReactNode } from "react";

export type SemanticStatusVariant = "neutral" | "warning" | "success" | "error" | "info";

export function SemanticStatusCard({
  title,
  consequence,
  nextStep,
  actions,
  variant = "neutral",
  testId = "semantic-status-card",
}: {
  title: string;
  consequence?: string;
  nextStep?: string;
  actions?: ReactNode;
  variant?: SemanticStatusVariant;
  testId?: string;
}) {
  return (
    <section
      className={`semantic-status-card semantic-status-card-${variant}`}
      data-testid={testId}
    >
      <h2 className="semantic-status-card-title">{title}</h2>
      {consequence ? <p className="semantic-status-card-consequence">{consequence}</p> : null}
      {nextStep ? <p className="semantic-status-card-next-step">{nextStep}</p> : null}
      {actions ? <div className="semantic-status-card-actions">{actions}</div> : null}
    </section>
  );
}
