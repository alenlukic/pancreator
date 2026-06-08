import type { RunRecord } from "./run-log.js";

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

function fieldMatches(field: CronField, value: number, min: number, max: number): boolean {
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

/** Returns whether `date` matches a 5-field cron expression. */
export function cronMatches(date: Date, cron: string): boolean {
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
    fieldMatches(minute, date.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, date.getUTCHours(), 0, 23) &&
    fieldMatches(day, date.getUTCDate(), 1, 31) &&
    fieldMatches(month, date.getUTCMonth() + 1, 1, 12) &&
    fieldMatches(weekday, date.getUTCDay(), 0, 6)
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

/** Returns the next cron fire at or after `after`, or null when not found within one year. */
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

/** Returns the timestamp of the most recent run record, if any. */
export function lastRunStartedAt(records: readonly RunRecord[]): Date | null {
  if (records.length === 0) {
    return null;
  }
  const latest = records[records.length - 1]!;
  return new Date(latest.startedAt);
}

/** Returns whether `schedule` is due since the last recorded run at `now`. */
export function isAutomationDue(
  schedule: string,
  records: readonly RunRecord[],
  now: Date,
): boolean {
  const lastRun = lastRunStartedAt(records);
  if (lastRun === null) {
    return cronMatches(truncateToMinute(now), schedule);
  }
  const nextFire = nextCronFireAfter(schedule, lastRun);
  if (nextFire === null) {
    return false;
  }
  return nextFire.getTime() <= truncateToMinute(now).getTime();
}
