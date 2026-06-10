import type { RetryLimitFailureSummary } from "@/services/run-state-shared";
import { showNotImplementedToast } from "./remediation";

const REMEDIATION_ACTIONS = [
  { label: "Retry stage", variant: "primary" as const, action: "Retry stage" },
  { label: "Retry with config", variant: "secondary" as const, action: "Retry with config" },
  { label: "Run quick fix", variant: "secondary" as const, action: "Run quick fix" },
  { label: "Mark issue resolved", variant: "secondary" as const, action: "Mark issue resolved" },
  { label: "Cancel run", variant: "destructive" as const, action: "Cancel run" },
];

export function RetryLimitBanner({ summary }: { summary: RetryLimitFailureSummary }) {
  return (
    <section
      className="mc-retry-banner"
      data-testid="retry-limit-banner"
      aria-live="assertive"
    >
      <div className="mc-retry-banner-summary">
        <h2>Retry limit reached</h2>
        <p>{summary.loopHistoryText}</p>
        <p className="mc-retry-banner-meta">
          Stage <strong>{summary.failingStage}</strong> · {summary.retryCount} retries
        </p>
      </div>
      <div className="mc-retry-banner-actions" data-testid="retry-remediation-strip">
        {REMEDIATION_ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            className={`mc-remediation-btn mc-remediation-btn-${item.variant}`}
            data-testid={`remediation-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => showNotImplementedToast(item.action)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
