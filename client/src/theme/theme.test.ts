import { describe, expect, it } from "vitest";
import {
  brand,
  buildThemeStyleBlock,
  CSS_VARIABLE_CONTRACT,
  getCssVariables,
  getThemePalette,
  palette,
  statusPalette,
} from "@/theme/theme";

describe("getThemePalette", () => {
  it("returns light and dark palettes keyed by mode", () => {
    expect(getThemePalette("light").background).toBe("#FBF3E6");
    expect(getThemePalette("dark").background).toBe(brand.inkBlack);
    expect(getThemePalette("light")).toBe(palette.light);
    expect(getThemePalette("dark")).toBe(palette.dark);
  });
});

describe("getCssVariables", () => {
  it("emits the design-system CSS variable contract for each mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const vars = getCssVariables(mode);
      expect(Object.keys(vars).sort()).toEqual([...CSS_VARIABLE_CONTRACT].sort());
      for (const key of CSS_VARIABLE_CONTRACT) {
        expect(vars[key]).toMatch(/^#/);
      }
    }
  });

  it("maps status ramps from the mode palette", () => {
    const light = getCssVariables("light");
    expect(light["--color-status-error"]).toBe(statusPalette.red.light.foreground);
    expect(light["--color-status-error-bg"]).toBe(statusPalette.red.light.background);

    const dark = getCssVariables("dark");
    expect(dark["--color-status-success"]).toBe(statusPalette.green.dark.foreground);
    expect(dark["--color-status-success-bg"]).toBe(statusPalette.green.dark.background);
  });
});

describe("brand tokens", () => {
  it("encodes ratified brand colors", () => {
    expect(brand.inkBlack).toBe("#060313");
    expect(brand.apricotCream).toBe("#EEC584");
    expect(brand.mintLeaf).toBe("#61C9A8");
  });
});

describe("buildThemeStyleBlock", () => {
  it("emits light and dark variable blocks without a globals.css hex dependency", () => {
    const block = buildThemeStyleBlock();
    expect(block).toContain(":root {");
    expect(block).toContain("@media (prefers-color-scheme: dark)");
    for (const key of CSS_VARIABLE_CONTRACT) {
      expect(block).toContain(key);
    }
  });
});

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((pair) => {
    const value = Number.parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("muted text contrast", () => {
  it("clears WCAG AA on elevated surfaces in both themes", () => {
    expect(contrastRatio(palette.dark.textMuted, palette.dark.surfaceElevated)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(palette.light.textMuted, palette.light.surfaceElevated)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
