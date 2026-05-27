import { describe, expect, it } from "vitest";

import {
  expectedCompletedPhases,
  nextBootstrapAfterRatification,
  validateBootstrapTracking,
} from "./bootstrap-tracking.js";

describe("expectedCompletedPhases", () => {
  it("lists every phase strictly before the current phase", () => {
    expect(expectedCompletedPhases(5)).toEqual(["-1", "0", "1", "2", "3", "4"]);
  });
});

describe("nextBootstrapAfterRatification", () => {
  it("advances all three tracking fields together", () => {
    expect(nextBootstrapAfterRatification(4)).toEqual({
      phase: "5",
      status: "phase-5-in-progress",
      completedPhases: ["-1", "0", "1", "2", "3", "4"],
    });
  });
});

describe("validateBootstrapTracking", () => {
  it("accepts a consistent in-progress phase", () => {
    const result = validateBootstrapTracking({
      phase: "5",
      status: "phase-5-in-progress",
      completedPhases: ["-1", "0", "1", "2", "3", "4"],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects the historical ratified-without-advance defect", () => {
    const result = validateBootstrapTracking({
      phase: "4",
      status: "phase-4-ratified",
      completedPhases: ["-1", "0", "1", "2", "3"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain("not a stable tracking state");
    expect(result.violations.join("\n")).toContain('"5"');
    expect(result.violations.join("\n")).toContain("phase-5-in-progress");
  });

  it("rejects mismatched completed_phases for the current phase", () => {
    const result = validateBootstrapTracking({
      phase: "5",
      status: "phase-5-in-progress",
      completedPhases: ["-1", "0", "1", "2", "3"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join("\n")).toContain('["-1","0","1","2","3","4"]');
  });
});
