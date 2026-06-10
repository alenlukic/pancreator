import { describe, expect, it } from "vitest";
import {
  COCKPIT_SURFACES,
  FIRST_SLICE_SURFACES,
  MOBILE_TAB_SURFACES,
  getSurfaceByRoute,
} from "./surface-config";

describe("COCKPIT_SURFACES", () => {
  it("lists ten operational surfaces", () => {
    expect(COCKPIT_SURFACES).toHaveLength(10);
    expect(COCKPIT_SURFACES[0].id).toBe("command-center");
  });

  it("marks six first-slice surfaces for mobile chrome", () => {
    expect(FIRST_SLICE_SURFACES).toHaveLength(6);
    expect(FIRST_SLICE_SURFACES.every((surface) => surface.firstSlice)).toBe(true);
  });

  it("orders mobile tabs per ux-spec sequence", () => {
    expect(MOBILE_TAB_SURFACES.map((surface) => surface.id)).toEqual([
      "command-center",
      "mission-control",
      "work-intake",
      "compliance",
      "activity-log",
      "automations",
    ]);
  });
});

describe("getSurfaceByRoute", () => {
  it("resolves command center for root and explicit route", () => {
    expect(getSurfaceByRoute("/")?.id).toBe("command-center");
    expect(getSurfaceByRoute("/command-center")?.id).toBe("command-center");
  });
});
