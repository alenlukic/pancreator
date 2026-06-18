/** Browser-safe automation helpers; server I/O lives in `automations.ts`. */

export type AgentTrigger = {
  kind: "agent";
  persona: string;
  prompt: string;
};

export type PanTrigger = {
  kind: "pan";
  subcommand: string;
};

export type AutomationTrigger = AgentTrigger | PanTrigger;

export type AutomationPolicy = {
  maxConcurrent: number;
  timeoutMinutes: number;
};

export type AutomationRecord = {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  trigger: AutomationTrigger;
  policy: AutomationPolicy;
};

export type AutomationSummary = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  scheduleLabel: string;
  status: "scheduled" | "paused";
  triggerKind: "agent" | "pan";
  persona?: string;
};

export type CronPreset = {
  id: string;
  label: string;
  cron: string;
};

export const CRON_PRESETS: CronPreset[] = [
  { id: "hourly", label: "Hourly", cron: "0 * * * *" },
  { id: "daily", label: "Daily at midnight", cron: "0 0 * * *" },
  { id: "weekly", label: "Weekly on Monday", cron: "0 0 * * 1" },
  { id: "custom", label: "Custom", cron: "" },
];

const CRON_FIELD_PATTERN = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)+)(?:\/\d+)?$/u;

function isValidCronField(field: string): boolean {
  if (field === "*") {
    return true;
  }
  return CRON_FIELD_PATTERN.test(field);
}

export function isValidCronExpression(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/u);
  if (parts.length !== 5) {
    return false;
  }
  return parts.every(isValidCronField);
}

export function formatScheduleLabel(schedule: string): string {
  const normalized = schedule.trim();
  if (normalized === "0 * * * *") {
    return "Hourly";
  }
  if (normalized === "0 0 * * *") {
    return "Daily at midnight";
  }
  if (normalized === "0 0 * * 1") {
    return "Weekly on Monday";
  }
  return normalized;
}

export function humanScheduleLabel(schedule: string): string {
  return formatScheduleLabel(schedule);
}

export function deriveAutomationId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function defaultAgentAutomationDraft(name = ""): AutomationRecord {
  const id = deriveAutomationId(name);
  return {
    schemaVersion: 1,
    id,
    name,
    enabled: true,
    schedule: CRON_PRESETS[0]?.cron ?? "0 * * * *",
    trigger: {
      kind: "agent",
      persona: "",
      prompt: "",
    },
    policy: {
      maxConcurrent: 1,
      timeoutMinutes: 60,
    },
  };
}

type CronField = {
  kind: "any" | "value" | "range" | "step" | "list";
  values?: number[];
  min?: number;
  max?: number;
  step?: number;
};

function parseCronField(field: string, min: number, max: number): CronField {
  if (field === "*") {
    return { kind: "any" };
  }
  if (field.includes(",")) {
    const values = field.split(",").map((part) => Number.parseInt(part, 10));
    return { kind: "list", values };
  }
  if (field.includes("/")) {
    const [base, stepText] = field.split("/");
    const step = Number.parseInt(stepText ?? "1", 10);
    if (base === "*") {
      return { kind: "step", min, max, step };
    }
    const start = Number.parseInt(base ?? "0", 10);
    return { kind: "step", min: start, max, step };
  }
  if (field.includes("-")) {
    const [startText, endText] = field.split("-");
    return {
      kind: "range",
      min: Number.parseInt(startText ?? "0", 10),
      max: Number.parseInt(endText ?? "0", 10),
    };
  }
  return { kind: "value", values: [Number.parseInt(field, 10)] };
}

function cronFieldMatches(field: CronField, value: number, min: number, max: number): boolean {
  switch (field.kind) {
    case "any":
      return true;
    case "value":
    case "list":
      return field.values?.includes(value) ?? false;
    case "range":
      return value >= (field.min ?? min) && value <= (field.max ?? max);
    case "step": {
      const start = field.min ?? min;
      const step = field.step ?? 1;
      for (let candidate = start; candidate <= max; candidate += step) {
        if (candidate === value) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function cronMatches(date: Date, cron: string): boolean {
  const parts = cron.trim().split(/\s+/u);
  if (parts.length !== 5) {
    return false;
  }
  const minute = parseCronField(parts[0] ?? "*", 0, 59);
  const hour = parseCronField(parts[1] ?? "*", 0, 23);
  const day = parseCronField(parts[2] ?? "*", 1, 31);
  const month = parseCronField(parts[3] ?? "*", 1, 12);
  const weekday = parseCronField(parts[4] ?? "*", 0, 6);

  return (
    cronFieldMatches(minute, date.getUTCMinutes(), 0, 59) &&
    cronFieldMatches(hour, date.getUTCHours(), 0, 23) &&
    cronFieldMatches(day, date.getUTCDate(), 1, 31) &&
    cronFieldMatches(month, date.getUTCMonth() + 1, 1, 12) &&
    cronFieldMatches(weekday, date.getUTCDay(), 0, 6)
  );
}

function truncateToMinute(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      0,
      0,
    ),
  );
}

export function nextCronFireAfter(cron: string, after: Date): Date | null {
  const start = truncateToMinute(new Date(after.getTime() + 60_000));
  const limit = start.getTime() + 366 * 24 * 60 * 60_000;
  for (let cursor = start.getTime(); cursor <= limit; cursor += 60_000) {
    const candidate = new Date(cursor);
    if (cronMatches(candidate, cron)) {
      return candidate;
    }
  }
  return null;
}

export function formatNextRunLabel(schedule: string, nowMs: number = Date.now()): string {
  if (!isValidCronExpression(schedule)) {
    return "—";
  }
  const next = nextCronFireAfter(schedule, new Date(nowMs));
  if (next === null) {
    return "No upcoming run";
  }
  const deltaMs = next.getTime() - nowMs;
  if (deltaMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(deltaMs / (60 * 60 * 1000));
    if (hours < 1) {
      const minutes = Math.max(1, Math.floor(deltaMs / (60 * 1000)));
      return `in ${minutes}m`;
    }
    return `in ${hours}h`;
  }
  return next.toISOString().slice(0, 16).replace("T", " ");
}

export function previewNextRunLabel(schedule: string, nowMs: number = Date.now()): string {
  const nextLabel = formatNextRunLabel(schedule, nowMs);
  if (nextLabel === "—" || nextLabel === "No upcoming run") {
    return nextLabel;
  }
  return nextLabel.startsWith("in ") ? nextLabel : `at ${nextLabel}`;
}

export type AutomationStatusFilter = "all" | "failed" | "paused";

export function filterAutomationSummaries(
  automations: AutomationSummary[],
  searchText: string,
  statusFilter: AutomationStatusFilter,
  latestRunsByAutomationId: Record<string, { status: string } | undefined>,
): AutomationSummary[] {
  const normalizedSearch = searchText.trim().toLowerCase();
  return automations.filter((automation) => {
    const latestRun = latestRunsByAutomationId[automation.id];
    const isFailed = automation.enabled && latestRun?.status === "error";
    const isPaused = !automation.enabled;

    if (statusFilter === "failed" && !isFailed) {
      return false;
    }
    if (statusFilter === "paused" && !isPaused) {
      return false;
    }
    if (normalizedSearch === "") {
      return true;
    }
    const haystack = [
      automation.name,
      automation.persona ?? "",
      automation.scheduleLabel,
      humanScheduleLabel(automation.schedule),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}
