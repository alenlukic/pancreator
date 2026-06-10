import { describe, expect, it } from "vitest";
import {
  COMMAND_CENTER_SURFACES,
  FIRST_SLICE_SURFACES,
  MOBILE_TAB_SURFACES,
  getSurfaceByRoute,
} from "./surface-config";

describe("COMMAND_CENTER_SURFACES", () => {
  it("lists ten operational surfaces", () => {
    expect(COMMAND_CENTER_SURFACES).toHaveLength(10);
    expect(COMMAND_CENTER_SURFACES[0].id).toBe("command-center");
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
