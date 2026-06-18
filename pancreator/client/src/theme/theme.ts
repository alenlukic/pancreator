export const brand = {
  inkBlack: "#060313",
  apricotCream: "#EEC584",
  mintLeaf: "#61C9A8",
} as const;

export const statusPalette = {
  red: {
    name: "Coral Red",
    base: "#D84A4A",
    light: { foreground: "#9F2424", background: "#FCE7E7", border: "#E8A5A5" },
    dark: { foreground: "#FF8A8A", background: "#2A1117", border: "#8F2F3F" },
  },
  yellow: {
    name: "Saffron Amber",
    base: "#B86F00",
    light: { foreground: "#7A4B00", background: "#FFF0CC", border: "#E3B760" },
    dark: { foreground: "#FFD37A", background: "#241805", border: "#9A650D" },
  },
  green: {
    name: "Verdant Mint",
    base: "#1F8F73",
    light: { foreground: "#126B57", background: "#DFF7EF", border: "#8BD9BF" },
    dark: { foreground: "#73DDBB", background: "#092018", border: "#2E9E7E" },
  },
} as const;

export const palette = {
  dark: {
    brand,
    background: brand.inkBlack,
    surface: "#120D20",
    surfaceElevated: "#1B142B",
    border: "#2A213A",
    textPrimary: "#FFF9F0",
    textSecondary: "#B8B0C7",
    textMuted: "#8E8598",
    accentPrimary: brand.mintLeaf,
    accentSecondary: brand.apricotCream,
    ctaBackground: brand.mintLeaf,
    ctaText: brand.inkBlack,
    status: {
      error: statusPalette.red.dark,
      warning: statusPalette.yellow.dark,
      success: statusPalette.green.dark,
    },
  },
  light: {
    brand,
    background: "#FBF3E6",
    surface: "#FFF9F0",
    surfaceElevated: "#FFFFFF",
    border: "#E8D8BE",
    textPrimary: brand.inkBlack,
    textSecondary: "#5C5666",
    textMuted: "#787080",
    accentPrimary: "#1F8F73",
    accentPrimarySoft: brand.mintLeaf,
    accentSecondary: "#A9671D",
    accentSecondarySoft: brand.apricotCream,
    ctaBackground: brand.inkBlack,
    ctaText: "#FFF9F0",
    status: {
      error: statusPalette.red.light,
      warning: statusPalette.yellow.light,
      success: statusPalette.green.light,
    },
  },
} as const;

export type ThemeMode = keyof typeof palette;
export type ThemePalette = (typeof palette)[ThemeMode];

export const theme = {
  colors: palette,
  radii: { sm: "6px", md: "10px", lg: "16px", xl: "24px", full: "999px" },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", "2xl": "48px" },
  typography: {
    fontFamily: {
      sans: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      mono: `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`,
    },
    size: {
      xs: "0.75rem",
      sm: "0.875rem",
      md: "1rem",
      lg: "1.125rem",
      xl: "1.5rem",
      "2xl": "2rem",
      "3xl": "3rem",
    },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  },
  shadow: {
    sm: "0 1px 2px rgb(6 3 19 / 0.08)",
    md: "0 8px 24px rgb(6 3 19 / 0.12)",
    lg: "0 20px 48px rgb(6 3 19 / 0.16)",
  },
} as const;

export type Theme = typeof theme;

export function getThemePalette(mode: ThemeMode): ThemePalette {
  return palette[mode];
}

export function getCssVariables(mode: ThemeMode): Record<string, string> {
  const colors = palette[mode];
  return {
    "--color-background": colors.background,
    "--color-surface": colors.surface,
    "--color-surface-elevated": colors.surfaceElevated,
    "--color-border": colors.border,
    "--color-text-primary": colors.textPrimary,
    "--color-text-secondary": colors.textSecondary,
    "--color-text-muted": colors.textMuted,
    "--color-accent-primary": colors.accentPrimary,
    "--color-accent-secondary": colors.accentSecondary,
    "--color-cta-background": colors.ctaBackground,
    "--color-cta-text": colors.ctaText,
    "--color-status-error": colors.status.error.foreground,
    "--color-status-error-bg": colors.status.error.background,
    "--color-status-error-border": colors.status.error.border,
    "--color-status-warning": colors.status.warning.foreground,
    "--color-status-warning-bg": colors.status.warning.background,
    "--color-status-warning-border": colors.status.warning.border,
    "--color-status-success": colors.status.success.foreground,
    "--color-status-success-bg": colors.status.success.background,
    "--color-status-success-border": colors.status.success.border,
  };
}

/** CSS custom property names emitted by {@link getCssVariables}. */
/** Serializes light and dark CSS custom properties for injection in layout. */
export function buildThemeStyleBlock(): string {
  const formatBlock = (mode: ThemeMode) =>
    Object.entries(getCssVariables(mode))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n");

  return `:root {\n${formatBlock("light")}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${formatBlock("dark")}\n  }\n}`;
}

export const CSS_VARIABLE_CONTRACT = [
  "--color-background",
  "--color-surface",
  "--color-surface-elevated",
  "--color-border",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-accent-primary",
  "--color-accent-secondary",
  "--color-cta-background",
  "--color-cta-text",
  "--color-status-error",
  "--color-status-error-bg",
  "--color-status-error-border",
  "--color-status-warning",
  "--color-status-warning-bg",
  "--color-status-warning-border",
  "--color-status-success",
  "--color-status-success-bg",
  "--color-status-success-border",
] as const;
