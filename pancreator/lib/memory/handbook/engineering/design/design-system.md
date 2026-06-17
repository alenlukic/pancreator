---
title: Design System Token Canon
slug: engineering-design-system
stability: experimental
bootstrap-only: false
phase: 2
owners: [design-engineer, design-reviewer, sme-design]
purpose: |
  The canonical design-token source for every Pancreator operator surface.
  Agents that author, implement, or review UI SHALL derive every color, radius,
  spacing, typography, and shadow value from the token tables on this page.
  Hard-coded values that bypass these tokens are craft defects per the
  design-craft gate-blocking conditions.
references:
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [171, 186]
    contentHash: 9c6c2ef
    note: "Design-craft color, contrast, and motion standards that these tokens satisfy."
  - kind: lines
    path: lib/memory/handbook/engineering/index.md
    range: [50, 57]
    contentHash: f1aa3dc
    note: "Engineering standards corpus that routes design-system intents to this page."
external:
  - https://www.w3.org/WAI/standards-guidelines/wcag/
  - https://www.designtokens.org/
related:
  - /lib/memory/handbook/engineering/design-craft.md
  - /lib/memory/handbook/engineering/design/component-standard.md
  - /lib/memory/handbook/engineering/design/control-surface-ux.md
---

# Design System Token Canon

This page is the single token source for operator-facing UI in this repository.
The operator ratified the brand palette, status ramps, and scale tables below.
When an agent implements or reviews a surface under `client/`, the agent SHALL
resolve every visual value to a token on this page. If a needed value has no
token, then the authoring agent SHALL propose a token addition on this page in
the same change set rather than inline a one-off value.

## Canonical theme module

The `client` app SHALL expose one theme module at `client/src/theme/theme.ts`
that encodes the tables below verbatim as `const` objects. The theme module
SHALL export a `getCssVariables(mode)` function that emits the CSS custom
properties named in §CSS variable contract. Components SHALL consume tokens
through CSS custom properties or through the typed theme export; components
SHALL NOT restate hex values.

## Brand palette

| Token | Value | Role |
|---|---|---|
| `brand.inkBlack` | `#060313` | Dark-mode background; light-mode primary text and CTA background. |
| `brand.apricotCream` | `#EEC584` | Secondary accent. |
| `brand.mintLeaf` | `#61C9A8` | Primary accent; dark-mode CTA background. |

## Status palette

Each status color carries a `base` plus light-mode and dark-mode triples of
`foreground`, `background`, and `border`.

| Status | Name | Base | Light fg / bg / border | Dark fg / bg / border |
|---|---|---|---|---|
| `red` | Coral Red | `#D84A4A` | `#9F2424` / `#FCE7E7` / `#E8A5A5` | `#FF8A8A` / `#2A1117` / `#8F2F3F` |
| `yellow` | Saffron Amber | `#B86F00` | `#7A4B00` / `#FFF0CC` / `#E3B760` | `#FFD37A` / `#241805` / `#9A650D` |
| `green` | Verdant Mint | `#1F8F73` | `#126B57` / `#DFF7EF` / `#8BD9BF` | `#73DDBB` / `#092018` / `#2E9E7E` |

Status colors map to semantic roles: `red` → `status.error`, `yellow` →
`status.warning`, `green` → `status.success`. A surface SHALL NOT use a status
color for decoration unrelated to its semantic role.

## Mode palettes

### Dark mode

| Token | Value |
|---|---|
| `background` | `brand.inkBlack` (`#060313`) |
| `surface` | `#120D20` |
| `surfaceElevated` | `#1B142B` |
| `border` | `#2A213A` |
| `textPrimary` | `#FFF9F0` |
| `textSecondary` | `#B8B0C7` |
| `textMuted` | `#847B93` |
| `accentPrimary` | `brand.mintLeaf` (`#61C9A8`) |
| `accentSecondary` | `brand.apricotCream` (`#EEC584`) |
| `ctaBackground` | `brand.mintLeaf` (`#61C9A8`) |
| `ctaText` | `brand.inkBlack` (`#060313`) |
| `status.error` | `statusPalette.red.dark` |
| `status.warning` | `statusPalette.yellow.dark` |
| `status.success` | `statusPalette.green.dark` |

### Light mode

| Token | Value |
|---|---|
| `background` | `#FBF3E6` |
| `surface` | `#FFF9F0` |
| `surfaceElevated` | `#FFFFFF` |
| `border` | `#E8D8BE` |
| `textPrimary` | `brand.inkBlack` (`#060313`) |
| `textSecondary` | `#5C5666` |
| `textMuted` | `#8A8192` |
| `accentPrimary` | `#1F8F73` |
| `accentPrimarySoft` | `brand.mintLeaf` (`#61C9A8`) |
| `accentSecondary` | `#A9671D` |
| `accentSecondarySoft` | `brand.apricotCream` (`#EEC584`) |
| `ctaBackground` | `brand.inkBlack` (`#060313`) |
| `ctaText` | `#FFF9F0` |
| `status.error` | `statusPalette.red.light` |
| `status.warning` | `statusPalette.yellow.light` |
| `status.success` | `statusPalette.green.light` |

## Scale tables

### Radii

| Token | Value |
|---|---|
| `radii.sm` | `6px` |
| `radii.md` | `10px` |
| `radii.lg` | `16px` |
| `radii.xl` | `24px` |
| `radii.full` | `999px` |

### Spacing

| Token | Value |
|---|---|
| `spacing.xs` | `4px` |
| `spacing.sm` | `8px` |
| `spacing.md` | `16px` |
| `spacing.lg` | `24px` |
| `spacing.xl` | `32px` |
| `spacing.2xl` | `48px` |

Spacing values derive from the 4px base unit mandated by the design-craft
spacing standard. A layout SHALL NOT introduce a spacing value outside this
table without adding a token here first.

### Typography

| Token | Value |
|---|---|
| `fontFamily.sans` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `fontFamily.mono` | `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace` |
| `size.xs` | `0.75rem` |
| `size.sm` | `0.875rem` |
| `size.md` | `1rem` |
| `size.lg` | `1.125rem` |
| `size.xl` | `1.5rem` |
| `size.2xl` | `2rem` |
| `size.3xl` | `3rem` |
| `weight.regular` | `400` |
| `weight.medium` | `500` |
| `weight.semibold` | `600` |
| `weight.bold` | `700` |

One screen SHALL use at most 5 distinct type sizes from this scale per the
design-craft typography standard.

### Shadows

| Token | Value |
|---|---|
| `shadow.sm` | `0 1px 2px rgb(6 3 19 / 0.08)` |
| `shadow.md` | `0 8px 24px rgb(6 3 19 / 0.12)` |
| `shadow.lg` | `0 20px 48px rgb(6 3 19 / 0.16)` |

## CSS variable contract

`getCssVariables(mode)` SHALL emit exactly the following custom properties,
resolved from the mode palette: `--color-background`, `--color-surface`,
`--color-surface-elevated`, `--color-border`, `--color-text-primary`,
`--color-text-secondary`, `--color-text-muted`, `--color-accent-primary`,
`--color-accent-secondary`, `--color-cta-background`, `--color-cta-text`, and
the nine status properties `--color-status-{error,warning,success}` plus their
`-bg` and `-border` suffixes. Stylesheets and Tailwind theme configuration
SHALL reference these custom properties instead of restating hex values.

## Mode parity rules

1. Every surface SHALL render correctly in both light and dark mode; a change
   that styles one mode SHALL style the other mode in the same change set.
2. Text on `background`, `surface`, and `surfaceElevated` SHALL meet WCAG 2.2
   AA contrast of at least 4.5:1 (3:1 for text at or above 24px) in both modes.
3. Status `foreground` on its paired status `background` SHALL meet at least
   4.5:1 contrast in both modes.
4. The accent treatment SHALL follow the one-primary-per-region rule from the
   design-craft controls standard in both modes.

## Enforcement

1. `design-reviewer` SHALL treat a hard-coded color, radius, spacing, type, or
   shadow value that has a matching token as an off-system defect (`P1`,
   `consistency`).
2. `design-reviewer` SHALL treat use of a palette outside this page (for
   example the retired eggshell/midnight-violet/deep-teal palette) as a `P0`
   `visual_polish` defect that forces `design_qa_passes: false`.
3. `reviewer` SHALL flag any `client/` change that introduces a hex literal
   outside `client/src/theme/` as a `must fix` finding.

## Stability

This page is an engineering-standards seed and remains `experimental` until the
Command Center rebuild ships against it and token-conformance checks exist.
