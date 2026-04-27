import { randomBytes } from "node:crypto";

/** Returns a 32-hex character trace id (16 bytes). */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** Returns a 16-hex character span id (8 bytes). */
export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** Returns an RFC 3339 UTC string with millisecond precision (same as `Date#toISOString()`). */
export function rfc3339UtcMs(d: Date = new Date()): string {
  return d.toISOString();
}
