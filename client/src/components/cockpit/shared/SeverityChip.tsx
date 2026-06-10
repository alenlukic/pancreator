export type SeverityChipValue = "Info" | "Warning" | "Needs attention" | "Blocking" | "Critical";

const SEVERITY_LABELS: Record<SeverityChipValue, string> = {
  Info: "Info",
  Warning: "Warning",
  "Needs attention": "Needs attention",
  Blocking: "Blocking",
  Critical: "Critical",
};

export function SeverityChip({ severity }: { severity: SeverityChipValue }) {
  const slug = severity.toLowerCase().replace(/\s+/g, "-");
  return (
    <span className={`severity-chip severity-chip-${slug}`} data-testid={`severity-chip-${slug}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
