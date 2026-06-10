---
title: Command Center FD Mission Control run detail UX Spec
feature_id: command-center-feature-delivery-mission-control-run-detail
task_id: 50770_0953_command-center-feature-delivery-mission-control-run-detail
program: command-center
stage: plan
owner: design-engineer
status: draft
design_steps: true
depends_on:
  - command-center-shell-theme-foundation
  - command-center-ux-philosophy-information-architecture-and-user-stories
  - command-center-live-run-refresh-and-stage-artifact-drawer
references:
  - kind: lines
    path: lib/memory/features/command-center-feature-delivery-mission-control-run-detail/spec.md
    range: [96, 207]
    note: Engineering acceptance criteria for stage rail, retry banner, detail panel, artifacts, logs, and live refresh.
  - kind: lines
    path: lib/memory/features/command-center-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [131, 133]
    note: Ratified FD Mission Control §4.4 authority for stage rail, retry banner, artifacts, and verbose log drawer.
  - kind: lines
    path: lib/memory/features/command-center-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [86, 99]
    note: Parent Command Center visual tokens and spacing scale.
  - kind: lines
    path: lib/memory/features/command-center-live-run-refresh-and-stage-artifact-drawer/ux-spec.md
    range: [85, 127]
    note: Prior art for live polling, telemetry chips, and P10 artifact modal handoff.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [49, 259]
    note: Taste profile, measurable craft standards, and gate-blocking conditions.
---

# Command Center FD Mission Control run detail UX Spec

## Overview

FD Mission Control is the single-run inspection surface at `/mission-control`. Operators select one feature-delivery run, read stage progress on a horizontal rail, inspect per-stage output and artifacts, respond to retry-limit failures, and open verbose logs only when needed. The default view stays calm: no log drawer, no raw paths, no internal prose dumps. Live polling keeps non-terminal runs current without remounting the shell. This spec instantiates ratified ux-spec §4.4 and binds the blocking `fd-mission-control-stage-rail` contract for design QA.

## Layout and navigation

- **Shell placement** — renders inside `DashboardModuleShell` main column on the FD Mission Control surface (`/mission-control`). Left rail navigation unchanged from parent IA.
- **Vertical stack** — Run context header → optional retry-limit banner → stage rail → two-column workspace (stage detail left, artifacts by stage right). Grid gap `--space-4`; module padding `--space-6`.
- **Breakpoints** — ≥1280px: rail cells flex equally in one row; workspace `3fr / 2fr`. 1024–1279px: rail horizontal scroll; workspace stacks to single column. <1024px: bottom-sheet verbose log drawer (max 70vh); rail remains horizontally scrollable inside bounded container.
- **Task selection** — pre-select task from `?task=` query when present in envelope; otherwise default to first non-terminal task, then first task. Task switcher deferred; Command Center deep links supply `?task=`.
- **Progressive disclosure** — Tier 1: header, rail, selected stage summary. Tier 2: output expand, artifact groups. Tier 3: verbose log drawer via **Open run logs** only.
- **Operator-readable labels** — run title uses feature label from run state, not raw task id. Artifact rows use mapped titles (Engineering spec, Plan, Feature index). Raw ids, paths, and ISO timestamps stay behind closed-by-default **Show technical details** with **Copy task id** or **Copy artifact path**.

## Visual design tokens

Reuse Command Center tokens from parent ux-spec. Scope mission-control classes under `/* command-center mission-control */` in `globals.css`.

| Token / class | Treatment | Use |
|---|---|---|
| `--color-surface-elevated` + `border-radius: 10px` + `box-shadow: sm` | solid card shell | Header, detail panel, artifact groups, stage cells — no dashed wireframe chrome |
| `--space-xs` through `--space-6` | 4px base scale | All gaps and padding; no off-scale one-offs |
| `--color-accent-primary` / `var(--accent)` | accent border + 12% fill | Active stage cell (`.mc-stage-active`), live dot, filter chip active state |
| `--color-status-error` / `#8b2f2f` | border + 8% fill | Failed stage cells, retry badge, retry-limit banner |
| `.mc-current-stage-label` | `0.65rem` uppercase, accent color | Visible only on `active` stage cells |
| `.mc-retry-badge` | pill, error border, count | Retry transition count per stage |
| `--type-title` / `1.1rem` semibold | first-read | Run context title, panel headings |
| `--type-body` / `0.82rem` | meta and body | Persona chip, times, artifact rows |
| `--type-caption` / `0.68–0.72rem` | muted | Live indicator, retry meta, telemetry |
| `.mc-live-indicator` | accent dot + "Live" label | Visible only while polling interval active |
| `.mc-remediation-btn-primary` | accent fill | **Retry stage** only — one primary per remediation strip |
| `.mc-remediation-btn-destructive` | error outline, separated | **Cancel run** with `margin-left: --space-4` from safe actions |

Typography stays within five distinct sizes per screen. Primary labels ≤60 characters.

## Interaction requirements

### Run context header

- Feature title and status pill first-read; relative **Updated** time (no raw ISO).
- Live dot + label while polling; **Open run logs** as header CTA (outline, not accent-filled).
- **Loading** skeleton within 400ms (`aria-busy`). **Empty**: **Start feature delivery** + **Return to command center**. **Error**: **Retry run-state fetch**, retain prior snapshot.

### Retry-limit banner and remediation strip

- **Visibility** — when `detectRetryLimitFailure` returns a summary, render banner above stage rail with `aria-live="assertive"`.
- **Content** — heading "Retry limit reached"; loop history summary ≤60 chars; meta line "Stage **{name}** · {n} retries" — no multi-sentence log dumps.
- **Remediation strip** — buttons **Retry stage** (primary accent), **Retry with config**, **Run quick fix**, **Mark issue resolved** (secondary outline), **Cancel run** (destructive, separated). Stubbed actions show operator-visible toast naming the action (e.g. "Retry stage is not implemented yet").
- **Absent state** — banner region omitted entirely when no retry-limit failure; no placeholder chrome.

### Stage rail

- **Order** — intake, plan, implement, review, test, report, compliance, ship, index (fixed).
- **Active cell** — 2px accent border, 12% accent fill, **Current stage** label (`.mc-current-stage-label`).
- **Failed cell** — `--color-status-error` border and treatment distinct from complete.
- **Retry badge** — count badge on cells with retry transitions in `run.log.jsonl`.
- **Selection** — activating a non-pending cell selects it for stage detail and expands matching artifact group; `pending` cells non-interactive (no false click affordance).
- **Keyboard** — Enter/Space on focused non-pending cell selects stage; `role="navigation"` with `aria-label="Feature delivery stages"`.
- **Mission-control chrome** — retry badges and current-stage accent render only on this rail, not on Pipeline multi-run grid default chrome.

### Stage detail panel

- Capitalized stage name, persona chip, status pill; relative Started/Ended times.
- Failed: Critical chip + newest error excerpt (≤280 chars). Output truncates with **Expand stage output** / **Collapse stage output**.
- **Copy stage output** with inline confirmation. Placeholder: "Select a stage to view detail."

### Artifacts by stage

- **Structure** — accordion per FD stage; selected stage group `open` by default; Blocking severity chip on group header when any required artifact missing.
- **List rows** — Mobbin-fidelity: human-readable artifact title primary line; **Missing artifact** muted label when absent; one primary row action **Preview artifact** (accent when present); **Open in editor** as lower-emphasis secondary — disabled with tooltip when missing.
- **Present row** — **Preview artifact** opens P10 Files modal with read-only default visible (`data-testid="readonly-indicator"`); **Open in editor** enters edit mode only after explicit operator choice in modal flow.
- **Empty group** — "No artifacts for this stage" muted caption.
- **Path disclosure** — full repo path available only behind closed-by-default row overflow **Show technical details** with **Copy artifact path**; never a visible monospace path row in default view.

### Verbose log drawer

- **Default** — closed on first render; mission-control main column fully visible.
- **Open** — **Open run logs** slides right drawer (480px max width ≥1024px; bottom sheet <1024px); focus moves to drawer within 100ms.
- **Filters** — severity chips: all, retry, escalation, deferral; event-type `<select>` with human labels.
- **Body** — `RunEventTimeline` with telemetry badges; virtualized scroll inside bounded container when event count exceeds 50.
- **Close** — **Close run logs**, Escape, or backdrop click; animation ≤200ms `ease-out`; honor `prefers-reduced-motion`.
- **Loading** — skeleton in drawer body within 400ms when opened before events hydrate.

### Live refresh and P9 parity

- Poll `GET /api/run-state` every 5–10s for non-terminal runs with active stage; merge without remounting; hide live indicator when polling stops. `?task=` pre-selects matching envelope. Pipeline re-exports `StageMachineGrid` and `RunEventTimeline` from mission-control without behavior change.

## Accessibility minimums

WCAG 2.2 Level AA on all mission-control surfaces.

| Criterion | Requirement |
|---|---|
| **1.4.3** | 4.5:1 text contrast on elevated cards, banner, and drawer body |
| **1.4.11** | 3:1 non-text contrast on focus rings, active stage border, retry badge |
| **2.1.1** | Keyboard operable rail cells, remediation buttons, drawer filters, artifact rows |
| **2.4.3** | Focus order: header → banner → rail → detail → artifacts → drawer trap |
| **2.4.7** | 2px `--accent` `:focus-visible` outline, 2px offset on all interactive controls |
| **2.4.11** | Drawer does not fully obscure focused **Open run logs** trigger |
| **4.1.2** | Rail `role="navigation"`; drawer `role="dialog"` `aria-modal="true"`; live indicator `aria-live="polite"` |

**Motion** — drawer and backdrop ≤200ms; badge pulse and live dot animation disabled when `prefers-reduced-motion: reduce`.

## Craft standards

Per `lib/memory/handbook/engineering/design-craft.md`: 4px spacing scale; one accent-filled primary CTA per region (**Retry stage** in banner, **Preview artifact** per row, **Start feature delivery** in empty state); no raw paths/ids/timestamps as default content; no internal prose dumps; solid elevated card surfaces; list rows ≤2 visible actions with secondary de-emphasized; content contained at 1280×900 and 375×812.

```yaml
contract:
  id: command-center-feature-delivery-mission-control-run-detail.ux.fd-mission-control-stage-rail
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
    symbol: "Stage rail"
  owner: design-engineer
  description: |
    When FD Mission Control renders a run with a retry-limit failure, the stage rail
    SHALL list all nine FD stages in canonical order, SHALL mark the active stage with
    accent border and current-stage label, SHALL show retry count badges on retried
    stages, SHALL render failed stages with distinct error treatment, and SHALL surface
    an unmistakable retry-limit banner with loop history summary and remediation
    actions including Retry stage and Run quick fix.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
      range: [81, 96]
      note: Retry-limit banner and stage rail interaction requirements.
    - kind: lines
      path: /lib/memory/features/command-center-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
      range: [227, 267]
      note: Parent blocking contract rubric and threshold 0.75.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Implement stage shows retry badge 3; banner offers Retry with config and Run quick fix."
            rationale: Retry-limit visible with remediation path per §4.4.
        bad:
          - text: "Failed stage matches complete styling; no retry banner; monospace run path as title."
            rationale: Silent stall and raw-data exposure violate mission-control philosophy.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: command-center-feature-delivery-mission-control-run-detail.ux.fd-mission-control-stage-rail
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md#Stage-rail
    pancreator.wcag-criteria: ["1.4.3", "2.1.1"]
```

```yaml
contract:
  id: command-center-feature-delivery-mission-control-run-detail.ux.verbose-log-calm-default
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
    symbol: "Verbose log drawer"
  owner: design-engineer
  description: |
    When FD Mission Control first renders, the verbose log drawer SHALL remain closed,
    the default view SHALL show only the run header, stage rail, and workspace panels,
    and Open run logs SHALL be the sole affordance that opens the drawer with
    filter chips and timeline content.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
      range: [112, 119]
      note: Verbose log drawer default-closed and open behavior.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Initial view shows rail and detail only; logs open via Open run logs CTA."
            rationale: Calm default per progressive disclosure tier 1.
        bad:
          - text: "Timeline drawer open by default obscuring stage detail."
            rationale: Violates calm-default acceptance criterion.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: command-center-feature-delivery-mission-control-run-detail.ux.verbose-log-calm-default
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md#Verbose-log-drawer
```

```yaml
contract:
  id: command-center-feature-delivery-mission-control-run-detail.ux.artifacts-p10-readonly
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
    symbol: "Artifacts by stage"
  owner: design-engineer
  description: |
    When an operator activates Preview artifact on a present artifact row, the UI SHALL
    open the P10 Files modal with read-only default visible, SHALL disable preview
    on missing rows with Blocking severity and Missing artifact label, and SHALL NOT
    show raw repo paths as the primary row label.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md
      range: [104, 110]
      note: Artifact row labels, missing state, and P10 modal handoff.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Row shows Engineering spec label; preview opens modal with Read-only indicator."
            rationale: Operator-readable row with safe inspection default.
        bad:
          - text: "Monospace lib/memory path as title; missing row still enables preview."
            rationale: Raw-data exposure and unsafe missing-artifact affordance.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: command-center-feature-delivery-mission-control-run-detail.ux.artifacts-p10-readonly
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-feature-delivery-mission-control-run-detail/ux-spec.md#Artifacts-by-stage
    pancreator.wcag-criteria: ["2.1.1", "4.1.2"]
```
