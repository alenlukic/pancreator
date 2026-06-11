import { describe, expect, it } from "vitest";
import {
  COMMAND_CENTER_SURFACES,
  FIRST_SLICE_SURFACES,
  MOBILE_TAB_SURFACES,
  getSurfaceByRoute,
} from "./surface-config";

describe("COMMAND_CENTER_SURFACES", () => {
  it("lists five shipped route destinations", () => {
    expect(COMMAND_CENTER_SURFACES).toHaveLength(5);
    expect(COMMAND_CENTER_SURFACES[0].id).toBe("command-center");
    expect(COMMAND_CENTER_SURFACES.every((surface) => surface.firstSlice)).toBe(true);
    expect(COMMAND_CENTER_SURFACES.every((surface) => surface.operatorJob.length > 0)).toBe(true);
  });

  it("marks all shipped route destinations as first-slice", () => {
    expect(FIRST_SLICE_SURFACES).toHaveLength(5);
    expect(FIRST_SLICE_SURFACES.every((surface) => surface.firstSlice)).toBe(true);
  });

  it("orders mobile tabs across shipped destinations", () => {
    expect(MOBILE_TAB_SURFACES.map((surface) => surface.id)).toEqual([
      "command-center",
      "mission-control",
      "compliance",
      "automations",
      "activity-log",
    ]);
  });

  it("uses text-backed icon labels instead of unicode glyphs", () => {
    expect(COMMAND_CENTER_SURFACES.every((surface) => /^[A-Z]{2}$/u.test(surface.iconLabel))).toBe(
      true,
    );
  });
});

describe("getSurfaceByRoute", () => {
  it("resolves Home for root and explicit route", () => {
    expect(getSurfaceByRoute("/")?.id).toBe("command-center");
    expect(getSurfaceByRoute("/command-center")?.id).toBe("command-center");
    expect(getSurfaceByRoute("/command-center")?.label).toBe("Home");
  });
});
