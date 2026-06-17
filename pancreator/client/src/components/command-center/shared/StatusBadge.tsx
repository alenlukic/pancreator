export type AutomationStatus = "scheduled" | "paused" | "running" | "error";
export type RunHistoryStatus = "success" | "running" | "error" | "aborted" | "skipped";

export function StatusBadge({ status }: { status: AutomationStatus }) {
  return (
    <span className={`automation-status-badge automation-status-${status}`} data-testid={`status-badge-${status}`}>
      {status}
    </span>
  );
}

export function RunStatusBadge({
  status,
  label,
}: {
  status: RunHistoryStatus;
  label?: string;
}) {
  return (
    <span
      className={`automation-run-status-badge automation-run-status-${status}`}
      data-testid={`run-status-badge-${label ?? status}`}
    >
      {label ?? status}
    </span>
  );
}
