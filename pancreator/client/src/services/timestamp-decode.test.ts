import { describe, expect, it } from "vitest";
import { decodeCountdownTimestamp } from "./timestamp-decode";

describe("decodeCountdownTimestamp", () => {
  it("decodes a canonical run fixture", () => {
    const decoded = decodeCountdownTimestamp("172996_05-10-26", "38670_1315_demo-feature");
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.utcLabel).toBe("2026-05-10 13:15 UTC");
    }
  });

  it("decodes legacy dashboard demo fixtures", () => {
    const decoded = decodeCountdownTimestamp("172973_06-02-26", "65766_0543_demo-feature");
    expect(decoded.ok, decoded.ok ? "" : decoded.diagnostic).toBe(true);
    if (decoded.ok) {
      expect(decoded.utcLabel).toBe("2026-06-02 05:43 UTC");
    }
  });
});
