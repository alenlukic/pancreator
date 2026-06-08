import { AutomationValidationError } from "./errors.js";

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

const CRON_FIELD_PATTERN = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)+)(?:\/\d+)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushError(errors: string[], fieldPath: string, message: string): void {
  errors.push(`${fieldPath}: ${message}`);
}

function isValidCronField(field: string): boolean {
  if (field === "*") {
    return true;
  }
  return CRON_FIELD_PATTERN.test(field);
}

/** Validates a 5-field cron expression. */
export function isValidCronExpression(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/u);
  if (parts.length !== 5) {
    return false;
  }
  return parts.every(isValidCronField);
}

/** Maps a stored cron string to a human-readable label. */
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

function validateTrigger(trigger: unknown, errors: string[]): void {
  if (!isRecord(trigger)) {
    pushError(errors, "trigger", "must be an object");
    return;
  }

  const kind = trigger.kind;
  if (kind !== "agent" && kind !== "pan") {
    pushError(errors, "trigger.kind", "must be \"agent\" or \"pan\"");
    return;
  }

  if (kind === "agent") {
    if (typeof trigger.persona !== "string" || trigger.persona.trim() === "") {
      pushError(errors, "trigger.persona", "must be a non-empty string");
    }
    if (typeof trigger.prompt !== "string" || trigger.prompt.trim() === "") {
      pushError(errors, "trigger.prompt", "must be a non-empty string");
    }
    return;
  }

  if (typeof trigger.subcommand !== "string" || trigger.subcommand.trim() === "") {
    pushError(errors, "trigger.subcommand", "must be a non-empty string");
  }
}

function validatePolicy(policy: unknown, errors: string[]): void {
  if (!isRecord(policy)) {
    pushError(errors, "policy", "must be an object");
    return;
  }

  if (typeof policy.maxConcurrent !== "number" || !Number.isFinite(policy.maxConcurrent)) {
    pushError(errors, "policy.maxConcurrent", "must be a number");
  } else if (policy.maxConcurrent < 1) {
    pushError(errors, "policy.maxConcurrent", "must be at least 1");
  }

  if (typeof policy.timeoutMinutes !== "number" || !Number.isFinite(policy.timeoutMinutes)) {
    pushError(errors, "policy.timeoutMinutes", "must be a number");
  } else if (policy.timeoutMinutes < 1) {
    pushError(errors, "policy.timeoutMinutes", "must be at least 1");
  }
}

/** Validates a parsed automation document against schema v1. */
export function validateAutomationDocument(value: unknown): AutomationRecord {
  const errors: string[] = [];

  if (!isRecord(value)) {
    throw new AutomationValidationError(["root: must be an object"]);
  }

  if (value.schemaVersion !== 1) {
    pushError(errors, "schemaVersion", "must be 1");
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    pushError(errors, "id", "must be a non-empty string");
  }

  if (typeof value.name !== "string" || value.name.trim() === "") {
    pushError(errors, "name", "must be a non-empty string");
  }

  if (typeof value.enabled !== "boolean") {
    pushError(errors, "enabled", "must be a boolean");
  }

  if (typeof value.schedule !== "string" || value.schedule.trim() === "") {
    pushError(errors, "schedule", "must be a non-empty string");
  } else if (!isValidCronExpression(value.schedule)) {
    pushError(errors, "schedule", "must be a valid 5-field cron expression");
  }

  validateTrigger(value.trigger, errors);
  validatePolicy(value.policy, errors);

  if (errors.length > 0) {
    throw new AutomationValidationError(errors);
  }

  return value as AutomationRecord;
}

/** Converts a validated record into a list summary. */
export function toAutomationSummary(record: AutomationRecord): AutomationSummary {
  const summary: AutomationSummary = {
    id: record.id,
    name: record.name,
    enabled: record.enabled,
    schedule: record.schedule,
    scheduleLabel: formatScheduleLabel(record.schedule),
    status: record.enabled ? "scheduled" : "paused",
    triggerKind: record.trigger.kind,
  };

  if (record.trigger.kind === "agent") {
    summary.persona = record.trigger.persona;
  }

  return summary;
}
