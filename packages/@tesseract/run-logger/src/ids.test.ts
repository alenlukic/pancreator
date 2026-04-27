import { describe, expect, it } from "vitest";
import { newSpanId, newTraceId, rfc3339UtcMs } from "./ids.js";

describe("newTraceId and newSpanId", () => {
  it("produces expected hex lengths", () => {
    expect(newTraceId()).toHaveLength(32);
    expect(newSpanId()).toHaveLength(16);
  });
});

describe("rfc3339UtcMs", () => {
  it("returns an ISO-8601-like string for the given date", () => {
    const s = rfc3339UtcMs(new Date("2026-01-15T10:00:00.000Z"));
    expect(s).toBe("2026-01-15T10:00:00.000Z");
  });
});
