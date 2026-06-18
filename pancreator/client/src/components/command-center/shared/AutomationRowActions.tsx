"use client";

import type { ReactNode } from "react";

export function AutomationRowActions({
  safeActions,
  overflowActions,
  testId = "automation-row-actions",
}: {
  safeActions: ReactNode;
  overflowActions?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="automation-row-actions" data-testid={testId}>
      <div className="automation-row-actions-safe">{safeActions}</div>
      {overflowActions ? (
        <div className="automation-row-actions-overflow">{overflowActions}</div>
      ) : null}
    </div>
  );
}
