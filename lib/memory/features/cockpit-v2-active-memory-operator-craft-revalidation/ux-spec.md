---
title: Cockpit v2 active memory operator craft revalidation UX Spec
feature_id: cockpit-v2-active-memory-operator-craft-revalidation
task_id: 77283_0231_cockpit-v2-active-memory-operator-craft-revalidation
program: cockpit-v2
stage: plan
owner: design-engineer
status: draft
design_steps: true
depends_on:
  - cockpit-v2-active-memory-operator-readability
  - cockpit-v2-ux-spec-and-information-architecture
references:
  - kind: lines
    path: lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/spec.md
    range: [99, 185]
    note: Engineering spec acceptance criteria for gates 1, 2, 3, 5, 9, 11 and F-05/F-10 regressions.
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_cockpit-design-audit-validation/cockpit-design-audit.md
    range: [58, 156]
    note: Design audit F-00 through F-11 observations and machine-checkable acceptance.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [206, 249]
    note: Gate-blocking conditions 1–12 for Active memory panel enforcement.
  - kind: lines
    path: lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
    range: [48, 113]
    note: Prior operator-readability panel structure this feature revalidates under tightened gates.
  - kind: lines
    path: client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx
    range: [42, 76]
    note: Reverted HEAD panel structure, test ids, and loading or error shell.
  - kind: lines
    path: client/src/app/globals.css
    range: [554, 562]
    note: Next Action panel solid elevated card chrome to match for Active memory.
---

# Cockpit v2 active memory operator craft revalidation UX Spec

## Overview

This feature revalidates the Pipeline sidebar **Active memory** orientation panel under tightened `design-craft.md` gates so `design-reviewer` can set `design_qa_passes: true` for Feature A. The panel keeps its placement above inbox triage and multi-run surfaces and continues loading from `GET /api/active-memory`. Scope closes audit findings F-00, F-01, F-02, F-04, F-05, F-09, F-10, and F-11: column containment, human-first label hierarchy, copy-only path affordance, concrete refresh CTA, chip-summarized blockers with expand, relative timestamp, and solid elevated card chrome. Sibling panels, Files modal behavior, and `current.md` authoring format remain unchanged.

## Layout and navigation

- **Shell authority** — inherit Cockpit v2 Pipeline sidebar stack: `ActiveMemoryHeader` remains the topmost right-column panel at ≥1024px and in stacked mobile order.
- **Panel structure (top to bottom)** — section heading `Active memory` (`h2`, unchanged) → primary feature label row with copy-only path control → blockers chip list → refresh timestamp → single primary CTA.
- **Primary first-read** — `.active-memory-label` (`data-testid="active-memory-label"`) is the dominant datum; it SHALL display inbox title or semantic feature slug, never a repo path.
- **Path affordance** — when an active feature path exists, expose the full repo-relative path only through a copy-only icon button (`data-testid="active-memory-copy-path"`, `aria-label="Copy inbox path"`). The path SHALL NOT render as visible text in the default collapsed view, including no secondary monospace row.
- **Optional closed disclosure** — implementers MAY add a closed-by-default `<details>` summary `Inbox path` beneath the label row as an alternative to the icon; when used, path text SHALL appear only inside the closed panel body after explicit expansion.
- **Idle layout** — when no active feature is set, show one muted idle sentence; hide path affordance; retain blockers chips and timestamp when present.
- **Breakpoints** — at 1280×900 and 375×812, all content SHALL stay within `.active-memory-header` (`overflow: false`); chip rows wrap inside the panel with `min-width: 0` on flex children.

```
┌─ Active memory ─────────────────────────────┐  solid elevated card
│ Cockpit v2 active memory craft revalidation │  ← primary label (semibold)
│                                    [⎘ copy] │  ← icon-only; path not visible
│ ┌ Blocker one ┐ ┌ Blocker two ┐ ┌ Gate #2 ┐  │  ← chip rows, flex-wrap
│ Refreshed 12 minutes ago                    │  ← relative human time
│ [Open OPERATION.md]                         │  ← sole primary CTA
└──────────────────────────────────────────────┘
```

## Visual design tokens

Reuse Cockpit v2 tokens from `client/src/app/globals.css`. Refine scoped classes under the orientation block only; do not alter inbox triage, multi-run, or stage-status tokens.

| Token / class | Treatment | Use |
|---|---|---|
| `.active-memory-header` | `--surface-elevated`, `1px solid` border (accent 35% mix), `border-radius: 12px`, `box-shadow: 0 8px 24px` midnight-violet 8% mix, `--space-3` padding, `min-width: 0`, `overflow: hidden` | Solid elevated card; gate #9 |
| `.active-memory-label-row` | flex row, `align-items: center`, `gap: var(--space-2)`, `min-width: 0` | Label + copy icon; containment |
| `.active-memory-label` | ui-sans-serif, `0.85rem`, `font-weight: 600`, `--text-primary`, single-line truncate, `title` when >60 chars | First-read human label |
| `.active-memory-copy-path` | icon button, 32×32px hit target, `--text-muted`, hover `--accent` | Copy-only path; no visible path text |
| `.active-memory-blockers` | flex `flex-wrap`, `gap: var(--space-2)`, `margin-top: var(--space-2)`, max-height clamp ~3 chip rows when collapsed | Chip container |
| `.active-memory-blocker-chip` | pill inset, `0.72rem`, `--surface-primary` background, `1px solid` muted border, `border-radius: 999px`, `padding: 0.15rem 0.5rem`, max ~60 chars with ellipsis | One operator-facing blocker label |
| `.active-memory-blockers-toggle` | text button, `0.72rem`, `--accent`, underline on hover, `data-testid="active-memory-blockers-toggle"` | Show all blockers / Show fewer |
| `.active-memory-refreshed` | `--text-muted`, `0.72rem`; wraps `<time id="active-memory-refreshed-at" datetime="…">` | Human-readable refresh time |
| `.active-memory-refresh-link` | `.cockpit-action-button`, `margin-top: var(--space-3)`; sole accent CTA in panel | Open OPERATION.md |

**Typography scale:** panel heading `0.85rem` uppercase accent (existing); primary label `0.85rem` semibold; chip labels `0.72rem`; timestamp `0.72rem` muted.

**Spacing rhythm:** `--space-2` between label row, chip list, and timestamp; `--space-3` before the refresh CTA. All spacing on the 4px `--space-*` scale.

## Interaction requirements

### Active memory header (`data-testid="active-memory-header"`)

- **Data source** — unchanged `GET /api/active-memory` on Pipeline mount. Service SHALL supply `activeFeatureLabel`, optional `activeFeatureSlug`, and `blockerChips: string[]` (parsed from `blockersSummary`); `activeFeaturePath` remains for copy clipboard only, never as first-read display.
- **Primary label resolution** — when `activeFeaturePath` points to an inbox Markdown file, display parsed directive title; when title is missing, display semantic slug from filename. Label SHALL stay ≤60 visible characters with ellipsis and full label in `title` when truncated.
- **Idle state** — when `activeFeaturePath` is null or `(none)`, show exactly: `No active feature — triage inbox or start a run` in `.active-memory-label` with `--text-muted` treatment. Do not show `(none)` or a bare path.
- **Copy path control** — render only when a real active path exists. Icon button copies full repo-relative path via clipboard with 2s Copied tooltip (`aria-live="polite"`). Visible UI SHALL NOT include path characters.
- **Blockers chips** — service SHALL split `blockersSummary` into short operator labels (strip markdown, split on `·`, bullets, or sentence boundaries; cap each chip at ~60 chars). Render each as `.active-memory-blocker-chip`. Do not render multi-sentence source prose as a single paragraph. When more than three chip rows would show in collapsed mode, render `.active-memory-blockers-toggle` labeled **Show all blockers**; activation sets `aria-expanded="true"`, removes height clamp, and changes label to **Show fewer**. Alternatively, the toggle MAY open `current.md` in the Files modal when in-panel expansion would exceed panel bounds. When chips fit within three rows, omit the toggle.
- **Information hierarchy (gate #5)** — `.active-memory-label` SHALL use semibold `--text-primary` at `0.85rem`; timestamp, chips, and copy icon SHALL use muted or inset treatments so the label is visually dominant over all secondary metadata.
- **Refresh timestamp** — when `refreshTimestamp` is present, render `<time id="active-memory-refreshed-at" datetime="{ISO}">` with relative phrasing under 7 days (for example `Refreshed 12 minutes ago`, `Refreshed yesterday`) and locale date/time for older values. Visible text SHALL NOT include raw ISO. When absent, show muted `Refresh timestamp unavailable`.
- **Refresh procedure CTA** — button label **Open OPERATION.md** (locked). Retain `data-testid="active-memory-refresh-procedure"`. Click opens `OPERATION.md` in Files modal via existing `onOpenRefreshProcedure` handoff. When timestamp element exists, button SHALL set `aria-describedby="active-memory-refreshed-at"`. This is the sole accent-primary action in the panel (Von Restorff).
- **Loading** — shared skeleton with `aria-busy="true"` on section (unchanged).
- **Error** — shared inline error with retry (unchanged).
- **Success / steady** — populated label, chips, timestamp, and CTA without horizontal overflow or layout shift beyond chip wrap on expand.
- **Motion** — chip expand/collapse ≤200ms; honor `prefers-reduced-motion` (instant toggle).

### Regression boundaries

- Do not change inbox triage, multi-run table, module tabs, or main-column Pipeline behavior.
- Do not change `lib/memory/active/current.md` authoring format; parsing and summarization only.
- Preserve P10 read-only default when opening paths from this panel.

## Accessibility minimums

WCAG 2.2 Level AA for the Active memory panel surfaces touched by this feature.

| Criterion | Requirement |
|---|---|
| **1.4.3** | 4.5:1 contrast on primary label, chip text, CTA, and expand toggle |
| **1.4.11** | 3:1 non-text contrast on focus rings, solid border, and CTA boundaries |
| **2.1.1** | Copy icon, expand toggle, and refresh CTA fully keyboard operable |
| **2.4.6** | Primary label describes the active feature; CTA names verb plus concrete file |
| **2.4.7** | 2px `--accent` `:focus-visible` outline with 2px offset on all interactive controls |
| **4.1.2** | Copy button exposes `aria-label`; expand toggle exposes `aria-expanded`; timestamp uses semantic `<time datetime>`; CTA `aria-describedby` links to timestamp when present |

**Motion:** expand/collapse ≤200ms; instant when `prefers-reduced-motion: reduce`.

```yaml
contract:
  id: cockpit-v2-active-memory-operator-craft-revalidation.ux.no-raw-path-default-view
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When GET /api/active-memory returns a non-null activeFeaturePath, the
    default collapsed view of .active-memory-header SHALL display a human-readable
    inbox title or feature slug as first-read text and SHALL NOT contain
    lib/inbox/in/ as visible text; the full path SHALL be reachable only via
    a copy-only icon control or a closed-by-default disclosure.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
      range: [56, 62]
      note: Primary label and copy-only path affordance.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [213, 219]
      note: Gate-blocking condition #2 raw-data exposure.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Primary label reads cockpit-v2-active-memory-operator-craft-revalidation; copy icon present; DOM probe containsLibInbox false."
            rationale: Human label dominates; path is copy-only; F-01 and gate #2 pass.
        bad:
          - text: "active-memory-path paragraph shows full lib/inbox/in/... path as visible monospace text."
            rationale: Raw path is first-read content; gate #2 fails.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-craft-revalidation.ux.no-raw-path-default-view
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6"]
```

```yaml
contract:
  id: cockpit-v2-active-memory-operator-craft-revalidation.ux.solid-chrome-and-containment
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
    symbol: "Visual design tokens"
  owner: design-engineer
  description: |
    When .active-memory-header renders at 1280px by 900px and 375px by 812px,
    computed border-style SHALL NOT be dashed, the panel SHALL use solid elevated
    card chrome matching adjacent sidebar panels, and a DOM containment probe
    SHALL report overflow false within the parent column.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
      range: [72, 74]
      note: Solid elevated header token definition.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [213, 214]
      note: Gate-blocking condition #1 containment failure.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Header has solid 1px border, surface-elevated background, subtle shadow; no horizontal bleed at 1280px."
            rationale: Shipped card chrome and containment satisfy F-00 and F-09.
        bad:
          - text: "Header borderStyle dashed, boxShadow none, content bleeds past sidebar column."
            rationale: Wireframe chrome and overflow fail gates #1 and #9.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-craft-revalidation.ux.solid-chrome-and-containment
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md#Visual-design-tokens
    pancreator.wcag-criteria: ["1.4.11"]
```

```yaml
contract:
  id: cockpit-v2-active-memory-operator-craft-revalidation.ux.blockers-chips-cta-timestamp
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    Blockers SHALL render as .active-memory-blocker-chip elements or compact
    bullets, not a multi-sentence prose paragraph; when content exceeds three
    visible chip rows an accessible expand toggle with
    data-testid active-memory-blockers-toggle SHALL appear; the refresh CTA
    label SHALL be Open OPERATION.md with aria-describedby referencing the
    time element; visible timestamp text SHALL be human-readable with ISO only
    in the time datetime attribute.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md
      range: [94, 100]
      note: Blockers chips, expand toggle, CTA, and timestamp interactions.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [220, 246]
      note: Gate-blocking conditions #3 and #11.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Three blocker chips visible; Show all blockers toggle when clamped; button Open OPERATION.md; footer Refreshed 12 minutes ago in time datetime=ISO."
            rationale: Chips, expand, concrete CTA, and relative time satisfy F-02, F-05, F-10, F-11.
        bad:
          - text: "Single 238-char blockers paragraph; Refresh procedure CTA; Refreshed 2026-06-09T01:15:41.381Z visible without time element."
            rationale: Prose dump, banned CTA, and raw ISO fail multiple gates.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-craft-revalidation.ux.blockers-chips-cta-timestamp
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-craft-revalidation/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.1.1", "2.4.6", "4.1.2"]
```
