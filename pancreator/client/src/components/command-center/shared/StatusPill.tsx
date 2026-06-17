export type StatusPillValue =
  | "Draft"
  | "Ready"
  | "Running"
  | "Waiting for human"
  | "Blocked"
  | "Failed"
  | "Retrying"
  | "Complete"
  | "Cancelled"
  | "Archived";

const STATUS_LABELS: Record<StatusPillValue, string> = {
  Draft: "Draft",
  Ready: "Ready",
  Running: "Running",
  "Waiting for human": "Waiting for human",
  Blocked: "Blocked",
  Failed: "Failed",
  Retrying: "Retrying",
  Complete: "Complete",
  Cancelled: "Cancelled",
  Archived: "Archived",
};

export function StatusPill({ status }: { status: StatusPillValue }) {
  const slug = status.toLowerCase().replace(/\s+/g, "-");
  return (
    <span className={`status-pill status-pill-${slug}`} data-testid={`status-pill-${slug}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
