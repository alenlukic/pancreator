---
title: Cockpit v2 active memory operator readability UX Spec
feature_id: cockpit-v2-active-memory-operator-readability
task_id: 919_2344_cockpit-v2-active-memory-operator-readability
program: cockpit-v2
stage: plan
owner: design-engineer
status: draft
design_steps: true
depends_on:
  - cockpit-v2-ux-spec-and-information-architecture
  - cockpit-v2-active-memory-inbox-triage-multi-run-view
references:
  - kind: lines
    path: lib/memory/features/cockpit-v2-active-memory-operator-readability/spec.md
    range: [119, 189]
    note: Engineering spec acceptance criteria for label, CTA, blockers expand, and timestamp.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [59, 77]
    note: Design audit F-01 and F-02 observations and recommended fixes.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [99, 107]
    note: Design audit F-05 blockers excerpt expand affordance.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [149, 157]
    note: Design audit F-10 locale or relative refresh timestamp.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [128, 147]
    note: Information hierarchy and verb-plus-object CTA standards.
  - kind: lines
    path: lib/memory/features/cockpit-v2-active-memory-inbox-triage-multi-run-view/ux-spec.md
    range: [48, 99]
    note: Shipped sidebar stack and active memory header baseline this feature refines.
  - kind: lines
    path: client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx
    range: [42, 76]
    note: Current panel structure, test ids, and loading or error shell.
  - kind: lines
    path: client/src/services/inbox.ts
    range: [12, 28]
    note: Existing extractTitle and deriveSlugFromFilename helpers for label parsing.
---

# Cockpit v2 active memory operator readability UX Spec

## Overview

This feature refines the Pipeline sidebar **Active memory** panel so operators orient from human-readable feature labels instead of raw repo paths, ISO timestamps, or banned CTA copy. The panel keeps its existing placement above inbox triage and multi-run surfaces and continues loading from `GET /api/active-memory`. Scope is limited to audit findings F-01, F-02, F-05, and F-10: primary label hierarchy, verb-plus-object refresh CTA, accessible blockers expansion, and locale-aware refresh time. Shell layout, Files deep-link behavior for the refresh procedure, and sibling orientation panels remain unchanged.

## Layout and navigation

- **Shell authority** — inherit Cockpit v2 Pipeline sidebar stack from the orientation feature: `ActiveMemoryHeader` remains the topmost right-column panel at ≥1024px and in stacked mobile order.
- **Panel structure (top to bottom)** — section heading `Active memory` (unchanged `h2`) → primary feature label → optional secondary path metadata row → blockers excerpt → refresh timestamp → refresh procedure CTA.
- **Primary first-read** — `.active-memory-label` (or successor `data-testid="active-memory-label"`) is the dominant datum; it SHALL NOT be a repo path.
- **Secondary metadata** — when an active feature path exists, render a compact row beneath the label: truncated monospace path plus `Copy path` button; path SHALL NOT occupy the primary line.
- **Idle layout** — when no active feature is set, replace label and path rows with one muted idle sentence; hide path copy row; retain blockers and timestamp when present.
- **Breakpoints** — at 1280×900 and 375×812, all content SHALL stay within `.active-memory-header` without horizontal overflow; path truncation uses ellipsis; expanded blockers wrap inside the panel.

```
┌─ Active memory ─────────────────────────────┐
│ Cockpit v2 active memory operator readability│  ← primary label (sans-serif)
│ lib/inbox/in/…/945_2344_…md  [Copy path]     │  ← secondary, truncated
│ Blocker one · Blocker two · Blocker thr…     │  ← 3-line clamp
│ [Show full blockers]                         │  ← expand toggle when clamped
│ Refreshed 12 minutes ago                     │  ← relative human time
│ [Open refresh procedure]                     │  ← verb+object CTA
└──────────────────────────────────────────────┘
```

## Visual design tokens

Reuse Cockpit v2 tokens from `client/src/app/globals.css`. Refine scoped classes under the existing orientation block; do not alter stage-status, live-refresh, or inbox triage tokens.

| Token / class | Treatment | Use |
|---|---|---|
| `.active-memory-header` | `--surface-elevated`, `--space-3` padding, bottom border `--text-muted` 25% | Unchanged panel shell |
| `.active-memory-label` | ui-sans-serif, `0.85rem`, `font-weight: 600`, `--text-primary`, single-line truncate with `title` tooltip when >60 chars | Primary human-readable feature name |
| `.active-memory-path-meta` | ui-monospace, `0.72rem`, `--text-muted`, flex row, `gap: var(--space-2)`, `min-width: 0` | Secondary truncated path + copy |
| `.active-memory-blockers` | `--text-primary`, `0.85rem`, max 3 lines via `-webkit-line-clamp: 3` when collapsed | Risks and blockers excerpt |
| `.active-memory-blockers[data-expanded="true"]` | remove line-clamp; allow natural wrap | Expanded in-panel full summary |
| `.active-memory-blockers-toggle` | text button, `0.72rem`, `--accent`, underline on hover | Show full blockers / Show less |
| `.active-memory-refreshed` | `--text-muted`, `0.72rem`; wraps `<time datetime="…">` | Human-readable refresh time |
| `.active-memory-refresh-link` | existing `.cockpit-action-button`; `margin-top: var(--space-3)` | Primary panel CTA |

**Typography scale:** panel heading `0.85rem` uppercase accent (existing); primary label `0.85rem` semibold; body and blockers `0.85rem`; metadata and timestamp `0.72rem` muted.

**Spacing rhythm:** `--space-2` between label, path meta, blockers, and timestamp; `--space-3` before the refresh CTA.

## Interaction requirements

### Active memory header (`data-testid="active-memory-header"`)

- **Data source** — unchanged `GET /api/active-memory` on Pipeline mount. Service SHALL add `activeFeatureLabel` (inbox `#` title or filename-derived slug) and optional `activeFeatureSlug`; `activeFeaturePath` remains for secondary copy only.
- **Primary label resolution** — when `activeFeaturePath` points to an inbox Markdown file, display parsed directive title; when title is missing, display semantic slug from filename (segment after SID/time prefix). Label SHALL stay ≤60 visible characters with ellipsis and full label in `title` when truncated.
- **Idle state** — when `activeFeaturePath` is null or `(none)`, show exactly: `No active feature — triage inbox or start a run` in `.active-memory-label` with `--text-muted` treatment. Do not show `(none)`, a bare path, or an empty primary row.
- **Secondary path row** — render only when a real active path exists. Show repo-relative path truncated with ellipsis; `Copy path` uses existing `CopyCommandButton` with 2s Copied tooltip (`aria-live="polite"`). Row is visually subordinate (smaller, muted monospace).
- **Blockers excerpt** — unchanged summary source from `## Risks and blockers`. When text exceeds three visible lines in collapsed mode, show `.active-memory-blockers-toggle` labeled **Show full blockers**; activating sets `aria-expanded="true"`, removes clamp, and changes label to **Show less**. Toggle SHALL be keyboard operable with visible `:focus-visible` ring. When summary fits within three lines, omit the toggle.
- **Refresh timestamp** — when `refreshTimestamp` is present, render `<time id="active-memory-refreshed-at" datetime="{ISO}">` with relative phrasing for recency under 7 days (for example `Refreshed 12 minutes ago`, `Refreshed yesterday`) and locale date/time for older values via `Intl.DateTimeFormat`. Visible text SHALL NOT include raw ISO. When absent, show muted `Refresh timestamp unavailable`.
- **Refresh procedure CTA** — button label **Open refresh procedure** (locked choice among spec alternatives). Retain `data-testid="active-memory-refresh-procedure"`. Click opens `OPERATION.md` in Files modal via existing `onOpenRefreshProcedure` handoff. When timestamp element exists, button SHALL set `aria-describedby="active-memory-refreshed-at"`.
- **Loading** — shared skeleton with `aria-busy="true"` on section (unchanged).
- **Error** — shared inline error with retry (unchanged).
- **Success / steady** — populated label, optional path meta, blockers, timestamp, and CTA without layout shift beyond text wrap on expand.
- **Motion** — expand/collapse transition ≤200ms opacity or max-height; honor `prefers-reduced-motion` (instant toggle).

### Regression boundaries

- Do not change inbox triage, multi-run table, config panel, or main-column Pipeline behavior.
- Do not change `lib/memory/active/current.md` authoring format; parsing only.
- Preserve P10 read-only default when opening paths from this panel.

## Accessibility minimums

WCAG 2.2 Level AA for the Active memory panel surfaces touched by this feature.

| Criterion | Requirement |
|---|---|
| **1.4.3** | 4.5:1 contrast on primary label, blockers body, CTA, and expand toggle |
| **1.4.11** | 3:1 non-text contrast on focus rings and CTA boundaries |
| **2.1.1** | Expand toggle, copy button, and refresh CTA fully keyboard operable |
| **2.4.6** | Primary label describes the active feature; CTA names the action and target |
| **2.4.7** | 2px `--accent` `:focus-visible` outline with 2px offset on all interactive controls |
| **4.1.2** | Expand toggle exposes `aria-expanded`; timestamp uses semantic `<time datetime>`; CTA `aria-describedby` links to timestamp when present |

**Motion:** expand/collapse ≤200ms; instant when `prefers-reduced-motion: reduce`.

```yaml
contract:
  id: cockpit-v2-active-memory-operator-readability.ux.primary-label-not-raw-path
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When GET /api/active-memory returns a non-null activeFeaturePath, the
    primary label element (data-testid active-memory-label or successor) SHALL
    display a human-readable inbox title or feature slug and SHALL NOT display
    a lib/inbox/in/ repo path as first-read text; the full path MAY appear
    only on a secondary truncated metadata row with a copy affordance.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
      range: [93, 102]
      note: Primary label resolution and secondary path row.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [203, 207]
      note: Gate-blocking condition #2 raw-data exposure.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Primary line reads cockpit-v2-active-memory-readability; secondary row shows truncated lib/inbox/in/... path with Copy path."
            rationale: Human label dominates; raw path is demoted metadata.
        bad:
          - text: "Primary .active-memory-path paragraph shows lib/inbox/in/172967_06-08-26/945_2344_....md verbatim."
            rationale: Raw path is first-read content; F-01 and gate #2 fail.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-readability.ux.primary-label-not-raw-path
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6"]
```

```yaml
contract:
  id: cockpit-v2-active-memory-operator-readability.ux.refresh-cta-and-timestamp
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When the refresh procedure button renders, its visible label SHALL be
    Open refresh procedure (verb plus object) and SHALL NOT be Refresh
    procedure; when refreshTimestamp is present the button SHALL reference
    the timestamp element via aria-describedby and the visible timestamp
    text SHALL be human-readable relative or locale form with ISO only in
    the time datetime attribute.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
      range: [108, 112]
      note: Refresh CTA label and timestamp formatting.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [208, 209]
      note: Gate-blocking condition #3 ambiguous CTA.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Button reads Open refresh procedure with aria-describedby; footer shows Refreshed 12 minutes ago inside time datetime=ISO."
            rationale: Actionable CTA and operator-readable time satisfy F-02 and F-10.
        bad:
          - text: "Button reads Refresh procedure; footer shows Refreshed 2026-06-08T22:53:17.303Z as visible text."
            rationale: Banned label and raw ISO fail gate #2 and #3.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-readability.ux.refresh-cta-and-timestamp
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6", "4.1.2"]
```

```yaml
contract:
  id: cockpit-v2-active-memory-operator-readability.ux.blockers-expand-toggle
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When blockersSummary exceeds three visible lines in collapsed mode, the
    panel SHALL render an accessible expand control labeled Show full blockers
    that toggles aria-expanded, reveals the full summary in-panel, and
    restores Show less on collapse; the control SHALL be keyboard operable
    with a visible focus indicator.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md
      range: [104, 107]
      note: Blockers excerpt expand interaction.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [137, 138]
      note: Long values truncate with accessible full-value affordance.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Clamped excerpt shows Show full blockers; activation expands text and sets aria-expanded true."
            rationale: Operators can read full blockers without leaving the panel; F-05 satisfied.
        bad:
          - text: "Blockers clamp mid-word with no toggle, tooltip, or link."
            rationale: Truncation without disclosure violates hierarchy standard.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-active-memory-operator-readability.ux.blockers-expand-toggle
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-active-memory-operator-readability/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.1.1", "2.4.7", "4.1.2"]
```
