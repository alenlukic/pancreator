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
