/** UTC instant for FDS — mirrors `lib/internal/tools/migrate-timestamp-naming.mjs`. */
export const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);

/** Seconds-until-midnight domain (SID). */
export const SID_SECONDS = 86400;

const DAY_BUCKET_RE = /^(\d+)_(\d{2})-(\d{2})-(\d{2})$/u;
const TASK_ID_PREFIX_RE = /^(\d+)_(\d{4})_/u;

export function fdsDayStartMsFromDays(days: number): number {
  return FDS_UTC_MS - days * 86400000;
}

export function mmDdYySuffixFromMs(dayStartMs: number): string {
  const d = new Date(dayStartMs);
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mo}-${day}-${yy}`;
}

export function hhmmFromUtcParts(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

export function secondsRemainingFromUtcParts(h: number, m: number, s: number): number {
  if (h === 23 && m === 59 && s === 60) {
    return 0;
  }
  const secSinceMidnight = h * 3600 + m * 60 + s;
  return SID_SECONDS - secSinceMidnight;
}

export function utcPartsFromSecondsRemaining(secondsRemaining: number): {
  h: number;
  m: number;
  s: number;
} {
  if (secondsRemaining === 0) {
    return { h: 23, m: 59, s: 60 };
  }
  const secSinceMidnight = SID_SECONDS - secondsRemaining;
  const h = Math.floor(secSinceMidnight / 3600);
  const m = Math.floor((secSinceMidnight % 3600) / 60);
  const s = secSinceMidnight % 60;
  return { h, m, s };
}

export type CountdownDecodeResult =
  | { ok: true; utcLabel: string; instantMs: number }
  | { ok: false; diagnostic: string };

/** Inverts `<days>_<MM-DD-YY>` + `<seconds>_<HHMM>_<slug>` into `YYYY-MM-DD HH:MM UTC`. */
export function decodeCountdownTimestamp(dayBucket: string, taskId: string): CountdownDecodeResult {
  const dayMatch = dayBucket.match(DAY_BUCKET_RE);
  if (dayMatch === null) {
    return { ok: false, diagnostic: `day bucket does not match countdown pattern: ${dayBucket}` };
  }
  const days = Number(dayMatch[1]);
  if (!Number.isFinite(days) || days < 0) {
    return { ok: false, diagnostic: `invalid days token in day bucket: ${dayBucket}` };
  }

  const taskMatch = taskId.match(TASK_ID_PREFIX_RE);
  if (taskMatch === null) {
    return { ok: false, diagnostic: `task id does not match countdown prefix: ${taskId}` };
  }
  const secondsRemaining = Number(taskMatch[1]);
  const hhmmToken = taskMatch[2];
  if (!Number.isFinite(secondsRemaining) || secondsRemaining < 0 || secondsRemaining > SID_SECONDS) {
    return { ok: false, diagnostic: `invalid seconds token in task id: ${taskId}` };
  }

  let dayStartMs: number;
  try {
    dayStartMs = fdsDayStartMsFromDays(days);
  } catch {
    return { ok: false, diagnostic: `day bucket days token is out of range: ${dayBucket}` };
  }
  if (dayStartMs < 0) {
    return { ok: false, diagnostic: `decoded calendar day is before epoch: ${dayBucket}` };
  }

  const expectedSuffix = mmDdYySuffixFromMs(dayStartMs);
  const bucketSuffix = `${dayMatch[2]}-${dayMatch[3]}-${dayMatch[4]}`;
  if (expectedSuffix !== bucketSuffix) {
    return {
      ok: false,
      diagnostic: `day bucket date suffix mismatch: expected ${expectedSuffix}, got ${bucketSuffix}`,
    };
  }

  const { h, m, s } = utcPartsFromSecondsRemaining(secondsRemaining);
  const hhmmFromParts = hhmmFromUtcParts(h, m);
  if (hhmmFromParts !== hhmmToken) {
    return {
      ok: false,
      diagnostic: `HHMM token mismatch: task id has ${hhmmToken}, decoded ${hhmmFromParts} from SID ${secondsRemaining}`,
    };
  }

  const instantMs = dayStartMs + h * 3600000 + m * 60000 + s * 1000;
  const instant = new Date(instantMs);
  const y = instant.getUTCFullYear();
  const mo = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const d = String(instant.getUTCDate()).padStart(2, "0");
  const hh = String(instant.getUTCHours()).padStart(2, "0");
  const mm = String(instant.getUTCMinutes()).padStart(2, "0");
  const utcLabel = `${y}-${mo}-${d} ${hh}:${mm} UTC`;
  return { ok: true, utcLabel, instantMs };
}

/** Parses `.pan/work/<day>/<taskId>` or `.pan/archive/work/<day>/<taskId>` run directories. */
export function parseRunDirParts(runDirRel: string): { dayBucket: string; taskId: string } | null {
  const parts = runDirRel.replace(/\\/gu, "/").split("/").filter((p) => p.length > 0);
  if (parts.length === 4 && parts[0] === ".pan" && parts[1] === "work") {
    return { dayBucket: parts[2]!, taskId: parts[3]! };
  }
  if (parts.length === 5 && parts[0] === ".pan" && parts[1] === "archive" && parts[2] === "work") {
    return { dayBucket: parts[3]!, taskId: parts[4]! };
  }
  return null;
}
