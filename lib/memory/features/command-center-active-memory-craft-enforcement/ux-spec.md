---
title: Command Center active memory craft enforcement UX Spec
feature_id: command-center-active-memory-craft-enforcement
task_id: 82780_0100_command-center-active-memory-craft-enforcement
program: command-center
stage: plan
owner: design-engineer
status: draft
design_steps: true
depends_on:
  - command-center-active-memory-operator-readability
  - command-center-ux-spec-and-information-architecture
references:
  - kind: lines
    path: lib/memory/features/command-center-active-memory-craft-enforcement/spec.md
    range: [103, 196]
    note: Engineering spec acceptance criteria for gates #2, #3, #9, #11, #12 and F-05/F-10 retention.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [63, 136]
    note: Design audit F-01, F-02, F-09, F-11, and F-12 observations and recommended fixes.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [213, 249]
    note: Gate-blocking conditions #2, #3, #9, #11, and #12 for orientation panels.
  - kind: lines
    path: lib/memory/features/command-center-active-memory-operator-readability/ux-spec.md
    range: [48, 128]
    note: Prior readability UX baseline; F-05 expand toggle and F-10 relative timestamp SHALL retain.
  - kind: lines
    path: client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx
    range: [174, 205]
    note: Current visible path row, banned CTA label, and dual accent buttons to remediate.
  - kind: lines
    path: client/src/services/active-memory.ts
    range: [100, 118]
    note: summarizeBlockers prose join that F-11 rejects; replace with structured chip items.
  - kind: lines
    path: client/src/app/globals.css
    range: [1082, 1085]
    note: active-memory-header dashed border that gate #9 rejects.
---

# Command Center active memory craft enforcement UX Spec

## Overview

This feature closes design-craft gates #2, #3, #9, #11, and #12 on the Pipeline **Active memory** orientation panel while retaining F-05 expand toggle and F-10 relative timestamp from operator-readability. Operators orient from a human-readable label, slug-only secondary metadata, summarized blocker chips, one accent CTA, and solid card chrome — never visible repo paths, prose dumps, or dashed wireframe borders. Scope is `.active-memory-header` and its snapshot service only.

## Layout and navigation

- **Shell** — `ActiveMemoryHeader` stays topmost in the Pipeline sidebar at ≥1024px and stacked mobile order.
- **Structure** — `h2` Active memory → primary label → optional slug row + copy icon → blocker chips → expand toggle (when needed) → timestamp → **Open OPERATION.md** CTA.
- **Primary first-read** — `.active-memory-label` SHALL NOT be a repo path.
- **Secondary metadata** — slug or inbox title (≤60 chars, ellipsis + `title`) plus copy-only icon; no readable path text in default view.
- **Blockers** — chip row (`.active-memory-blocker-chips`) replaces prose paragraph; one label per chip.
- **Idle** — existing idle sentence; hide slug row and copy icon.
- **Breakpoints** — 1280×900 and 375×812: no horizontal overflow; chips wrap inside the card.

```
┌─ Active memory ─────────────────────────────┐
│ Command Center active memory craft enforcement  │
│ command-center-active-memory-craft…      [⎘]    │
│ [M1 ratified] [Bootstrap Phase 5] [US-9 PoC]│
│ [Show full blockers]                         │
│ Refreshed 17 minutes ago                     │
│ [Open OPERATION.md]                          │
└──────────────────────────────────────────────┘
```

## Visual design tokens

Scoped to `.active-memory-header` only; reuse Command Center tokens from `globals.css`.

| Token / class | Treatment | Use |
|---|---|---|
| `.active-memory-header` | `--surface-elevated`, solid `1px` border, `12px` radius, optional subtle shadow; **no dashed border** | Elevated orientation card |
| `.active-memory-label` | sans `0.85rem` semibold `--text-primary`, truncate | Primary feature name |
| `.active-memory-slug-meta` | flex row, `--space-2` gap | Slug + copy icon row |
| `.active-memory-slug` | sans `0.72rem` `--text-muted`, truncate | Slug only — never path |
| `.active-memory-copy-path` | ghost icon button, 32×32px min target | Copy path; no accent fill |
| `.active-memory-blocker-chip` | pill inset, `0.72rem`, `--space-1`/`--space-2` padding, truncate | One blocker label |
| `.active-memory-refresh-link` | accent `.command-center-action-button` | Sole accent control |
| `.active-memory-source-link` | text link `0.72rem` `--accent` | Open full blockers in Files |

**Type scale:** heading `0.85rem` uppercase; label `0.85rem` semibold; meta/chips/links `0.72rem`. **Spacing:** `--space-2` between rows; `--space-3` before CTA; 4px base scale only.

## Interaction requirements

### Active memory header (`data-testid="active-memory-header"`)

- **Data source** — `GET /api/active-memory`; service adds `blockerItems: string[]`; header renders chips from that field.
- **Primary label** — inbox title or slug on `.active-memory-label`; ≤60 chars with ellipsis + `title`.
- **Slug row** — when path exists: show slug in `.active-memory-slug` only; copy-only icon (locked over disclosure) with `aria-label="Copy inbox path"` and **Copied** tooltip; never render path text.
- **Blockers chips** — parse list items to `blockerItems` (≤60 chars, one sentence each); chip row in collapsed and expanded views; **Show full blockers** toggle when >3 lines; link **View full blockers in Files** to `current.md`.
- **Timestamp** — retain relative/locale `<time>`; no visible ISO.
- **CTA** — locked **Open OPERATION.md**; `aria-describedby` to timestamp when present; opens Files modal.
- **Accent** — exactly one accent `.command-center-action-button` (refresh CTA); copy icon is ghost.
- **States** — loading skeleton (`aria-busy`); error with retry; empty blockers omit chip region; expand ≤200ms, instant under `prefers-reduced-motion`.

### Regression (F-05, F-10)

Retain expand toggle and relative timestamp. Do not change sibling panels or `current.md` authoring format.

## Accessibility minimums

WCAG 2.2 Level AA for the Active memory panel surfaces touched by this feature.

| Criterion | Requirement |
|---|---|
| **1.4.3** | 4.5:1 contrast on primary label, chip text, CTA, expand toggle, and source link |
| **1.4.11** | 3:1 non-text contrast on focus rings, chip boundaries, and CTA borders |
| **2.1.1** | Copy icon, expand toggle, source link, and refresh CTA fully keyboard operable |
| **2.4.6** | Primary label describes the active feature; CTA names imperative verb plus concrete file target |
| **2.4.7** | 2px `--accent` `:focus-visible` outline with 2px offset on all interactive controls |
| **4.1.2** | Copy control exposes `aria-label`; expand toggle exposes `aria-expanded`; timestamp uses semantic `<time datetime>`; CTA `aria-describedby` links to timestamp when present |

**Motion:** expand/collapse ≤200ms; instant when `prefers-reduced-motion: reduce`.

```yaml
contract:
  id: command-center-active-memory-craft-enforcement.ux.no-visible-path-default-view
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When GET /api/active-memory returns a non-null activeFeaturePath and the
    panel renders in default collapsed view at 1280x900 or 375x812, visible
    text nodes inside .active-memory-header SHALL NOT contain lib/inbox/in/
    or any repo-relative path string; the full path SHALL be available only
    through the copy-only icon control that does not render path text.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
      range: [52, 54]
      note: Secondary slug metadata and copy-only affordance.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [215, 219]
      note: Gate-blocking condition #2 raw-data exposure.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Slug row plus copy icon; containsLibInbox false."
            rationale: Path is copy-only.
        bad:
          - text: "Visible lib/inbox/in/... path text in default view."
            rationale: Gate #2 fail.
    panel: { quorum: 2-of-3, judges: [haiku, haiku, sonnet], seed: 42, cost_ceiling_usd: 0.50 }
  metadata:
    pancreator.contract_id: command-center-active-memory-craft-enforcement.ux.no-visible-path-default-view
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6"]
```

```yaml
contract:
  id: command-center-active-memory-craft-enforcement.ux.refresh-cta-open-operation-md
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When the refresh procedure button renders, its visible label SHALL be
    Open OPERATION.md and SHALL NOT be Open refresh procedure, Refresh
    procedure, or any other banned vague label; when refreshTimestamp is
    present the button SHALL reference the timestamp element via
    aria-describedby.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
      range: [78, 80]
      note: Refresh procedure CTA locked label.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [220, 222]
      note: Gate-blocking condition #3 ambiguous CTA.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Button reads Open OPERATION.md with aria-describedby."
            rationale: Gate #3 pass.
        bad:
          - text: "Button reads Open refresh procedure."
            rationale: Banned label.
    panel: { quorum: 2-of-3, judges: [haiku, haiku, sonnet], seed: 42, cost_ceiling_usd: 0.50 }
  metadata:
    pancreator.contract_id: command-center-active-memory-craft-enforcement.ux.refresh-cta-open-operation-md
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6", "4.1.2"]
```

```yaml
contract:
  id: command-center-active-memory-craft-enforcement.ux.solid-elevated-panel-chrome
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
    symbol: "Visual design tokens"
  owner: design-engineer
  description: |
    When .active-memory-header renders in the shipped default state, computed
    borderStyle SHALL NOT be dashed; the panel SHALL use solid elevated card
    chrome with surface-elevated background and a solid border or subtle
    shadow scoped to this header only.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
      range: [66, 66]
      note: active-memory-header solid elevated treatment.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [237, 240]
      note: Gate-blocking condition #9 wireframe composition.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "borderStyle solid on active-memory-header."
            rationale: Gate #9 pass.
        bad:
          - text: "borderStyle dashed."
            rationale: Wireframe chrome fail.
    panel: { quorum: 2-of-3, judges: [haiku, haiku, sonnet], seed: 42, cost_ceiling_usd: 0.50 }
  metadata:
    pancreator.contract_id: command-center-active-memory-craft-enforcement.ux.solid-elevated-panel-chrome
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md#Visual-design-tokens
    pancreator.wcag-criteria: []
```

```yaml
contract:
  id: command-center-active-memory-craft-enforcement.ux.blockers-chip-summarization
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When blockers content is present, .active-memory-blockers SHALL render
    summarized chip rows with at most one sentence and at most 60 characters
    per chip item and SHALL NOT render multi-sentence current.md source prose;
    expanded view SHALL show the same chip structure; a Files link to
    lib/memory/active/current.md SHALL be available for full source text.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
      range: [78, 82]
      note: Blockers chips and Files source link.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [244, 246]
      note: Gate-blocking condition #11 internal prose dump.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Chip row with labels under 60 chars each."
            rationale: Gate #11 pass.
        bad:
          - text: "Multi-sentence prose paragraph, no chips."
            rationale: Prose dump fail.
    panel: { quorum: 2-of-3, judges: [haiku, haiku, sonnet], seed: 42, cost_ceiling_usd: 0.50 }
  metadata:
    pancreator.contract_id: command-center-active-memory-craft-enforcement.ux.blockers-chip-summarization
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: ["2.4.6"]
```

```yaml
contract:
  id: command-center-active-memory-craft-enforcement.ux.single-accent-cta
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
    symbol: "Active memory header"
  owner: design-engineer
  description: |
    When .active-memory-header is inspected, accentButtonCount for elements
    with command-center-action-button accent fill SHALL equal exactly 1 and the
    copy-only path control SHALL use ghost or text-link emphasis without
    accent fill.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md
      range: [84, 85]
      note: Accent hierarchy and ghost copy control.
    - kind: lines
      path: /lib/memory/handbook/engineering/design-craft.md
      range: [247, 249]
      note: Gate-blocking condition #12 accent sprawl.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "accentButtonCount 1; copy icon ghost."
            rationale: Gate #12 pass.
        bad:
          - text: "Two accent-filled command-center-action-button elements."
            rationale: Accent sprawl fail.
    panel: { quorum: 2-of-3, judges: [haiku, haiku, sonnet], seed: 42, cost_ceiling_usd: 0.50 }
  metadata:
    pancreator.contract_id: command-center-active-memory-craft-enforcement.ux.single-accent-cta
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-active-memory-craft-enforcement/ux-spec.md#Active-memory-header
    pancreator.wcag-criteria: []
```
