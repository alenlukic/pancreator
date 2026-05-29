import { describe, expect, it } from "vitest";
import { cssVariables, palette } from "@/services/theme";

describe("palette", () => {
  it("defines the three design tokens once", () => {
    expect(palette.eggshell).toBe("#F3EFDE");
    expect(palette["midnight-violet"]).toBe("#271F30");
    expect(palette["deep-teal"]).toBe("#4E6E58");
    expect(cssVariables).toContain("--eggshell: #F3EFDE;");
  });
});
