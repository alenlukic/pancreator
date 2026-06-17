import { describe, expect, it } from "vitest";

import {
  daysToFds,
  FDS_UTC_MS,
  hhmm,
  mmDdYySuffix,
  secondsRemainingInDay,
} from "../../../../tools/migrations/migrate-timestamp-naming.mjs";
import { decodeCountdownTimestamp, parseRunDirParts } from "./timestamp-decode.js";

function encodeId(date: Date, slug: string): { dayBucket: string; taskId: string } {
  const days = daysToFds(date);
  const suffix = mmDdYySuffix(date);
  const dayBucket = `${days}_${suffix}`;
  const sid = secondsRemainingInDay(date);
  const hm = hhmm(date);
  const taskId = `${sid}_${hm}_${slug}`;
  return { dayBucket, taskId };
}

describe("parseRunDirParts", () => {
  it("parses active work and archived run directories", () => {
    expect(parseRunDirParts(".pan/work/172996_05-10-26/38670_1315_demo-feature")).toEqual({
      dayBucket: "172996_05-10-26",
      taskId: "38670_1315_demo-feature",
    });
    expect(parseRunDirParts(".pan/archive/work/172996_05-10-26/38670_1315_demo-feature")).toEqual({
      dayBucket: "172996_05-10-26",
      taskId: "38670_1315_demo-feature",
    });
  });
});

describe("timestamp-decode round-trip", () => {
  const samples: Array<{ label: string; date: Date; slug: string }> = [
    { label: "midnight edge", date: new Date(Date.UTC(2026, 5, 2, 0, 0, 0)), slug: "midnight" },
    { label: "early morning", date: new Date(Date.UTC(2026, 5, 2, 1, 15, 30)), slug: "early" },
    { label: "late morning", date: new Date(Date.UTC(2026, 5, 2, 11, 45, 0)), slug: "late-am" },
    { label: "noon", date: new Date(Date.UTC(2026, 5, 2, 12, 0, 0)), slug: "noon" },
    { label: "afternoon", date: new Date(Date.UTC(2026, 5, 2, 15, 30, 45)), slug: "afternoon" },
    { label: "late day", date: new Date(Date.UTC(2026, 5, 2, 23, 50, 10)), slug: "late-day" },
    { label: "last minute", date: new Date(Date.UTC(2026, 5, 2, 23, 59, 59)), slug: "last-minute" },
    { label: "fds epoch day", date: new Date(FDS_UTC_MS), slug: "fds" },
    { label: "day before fds", date: new Date(FDS_UTC_MS - 86400000), slug: "pre-fds" },
    { label: "winter date", date: new Date(Date.UTC(2025, 11, 31, 18, 5, 0)), slug: "winter" },
  ];

  for (const sample of samples) {
    it(`encode-then-decode is exact for ${sample.label}`, () => {
      const { dayBucket, taskId } = encodeId(sample.date, sample.slug);
      const decoded = decodeCountdownTimestamp(dayBucket, taskId);
      expect(decoded.ok, decoded.ok ? "" : decoded.diagnostic).toBe(true);
      if (!decoded.ok) {
        return;
      }
      const y = sample.date.getUTCFullYear();
      const mo = String(sample.date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(sample.date.getUTCDate()).padStart(2, "0");
      const hh = String(sample.date.getUTCHours()).padStart(2, "0");
      const mm = String(sample.date.getUTCMinutes()).padStart(2, "0");
      expect(decoded.utcLabel).toBe(`${y}-${mo}-${d} ${hh}:${mm} UTC`);
    });
  }
});
