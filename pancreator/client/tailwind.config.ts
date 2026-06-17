import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import { theme as designTheme } from "./src/theme/theme";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        "surface-elevated": "var(--color-surface-elevated)",
        border: "var(--color-border)",
        foreground: "var(--color-text-primary)",
        "foreground-secondary": "var(--color-text-secondary)",
        muted: "var(--color-text-muted)",
        accent: {
          DEFAULT: "var(--color-accent-primary)",
          secondary: "var(--color-accent-secondary)",
        },
        cta: {
          DEFAULT: "var(--color-cta-background)",
          foreground: "var(--color-cta-text)",
        },
        status: {
          error: "var(--color-status-error)",
          "error-bg": "var(--color-status-error-bg)",
          "error-border": "var(--color-status-error-border)",
          warning: "var(--color-status-warning)",
          "warning-bg": "var(--color-status-warning-bg)",
          "warning-border": "var(--color-status-warning-border)",
          success: "var(--color-status-success)",
          "success-bg": "var(--color-status-success-bg)",
          "success-border": "var(--color-status-success-border)",
        },
      },
      borderRadius: {
        sm: designTheme.radii.sm,
        md: designTheme.radii.md,
        lg: designTheme.radii.lg,
        xl: designTheme.radii.xl,
        full: designTheme.radii.full,
      },
      spacing: {
        xs: designTheme.spacing.xs,
        sm: designTheme.spacing.sm,
        md: designTheme.spacing.md,
        lg: designTheme.spacing.lg,
        xl: designTheme.spacing.xl,
        "2xl": designTheme.spacing["2xl"],
      },
      fontFamily: {
        sans: designTheme.typography.fontFamily.sans.split(",").map((part) => part.trim()),
        mono: designTheme.typography.fontFamily.mono.split(",").map((part) => part.trim()),
      },
      fontSize: {
        xs: designTheme.typography.size.xs,
        sm: designTheme.typography.size.sm,
        base: designTheme.typography.size.md,
        lg: designTheme.typography.size.lg,
        xl: designTheme.typography.size.xl,
        "2xl": designTheme.typography.size["2xl"],
        "3xl": designTheme.typography.size["3xl"],
      },
      boxShadow: {
        sm: designTheme.shadow.sm,
        md: designTheme.shadow.md,
        lg: designTheme.shadow.lg,
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
