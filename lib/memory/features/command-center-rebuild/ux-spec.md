---
title: Command Center rebuild UX Spec
feature_id: command-center-rebuild
task_id: 52276_0928_command-center-rebuild
program: command-center
stage: plan
owner: design-engineer
status: draft
design_steps: true
references:
  - kind: lines
    path: lib/memory/features/command-center-rebuild/spec.md
    range: [96, 227]
    note: Engineering spec scope, acceptance criteria, and verification gates.
  - kind: lines
    path: lib/personas/design-engineer.md
    range: [93, 180]
    note: Design-engineer output contract and conformance gates for ux-spec.md.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [52, 267]
    note: Taste profile, measurable craft standards, and gate-blocking conditions.
  - kind: lines
    path: lib/memory/handbook/engineering/design/control-surface-ux.md
    range: [45, 128]
    note: Operator orientation, truthfulness, triage, receipt, and gate obligations.
  - kind: lines
    path: lib/memory/features/command-center-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [86, 183]
    note: Prior Command Center program IA, token, and control-surface patterns to preserve where still applicable.
---

# Command Center rebuild UX Spec

## Overview

Command Center rebuild is a calm, truthful supervision console that lets one operator understand urgency, intervene on human gates, recover failed work, manage automations, and audit recent mutations without leaving the shell. The experience prioritizes six destinations: Home for orientation, Feature Delivery for active-run supervision, Compliance + Recovery for failure triage, Automations for lifecycle control, Activity Log for receipts, and Cmd-K for fast navigation plus mirrored frequent actions. Every surface favors human-readable labels, one dominant next action per region, dense but breathable cards, and clear degraded, loading, empty, and error states so the UI feels production-ready rather than scaffolded.

## Layout And Navigation

- **Shell structure**: persistent left rail, main content column, and optional right detail panel on wide viewports; the rail collapses behind a menu below 1024px; detail content stacks below the main flow on compact screens. Main content is the declared primary column at every breakpoint.
- **Navigation set**: ship only `Home`, `Feature Delivery`, `Compliance + Recovery`, `Automations`, `Activity Log`, and `Cmd-K`. No placeholder destinations, no "coming soon" chrome, and no orphaned surface without a stated operator job.
- **Home composition**: four first-read orientation regions in urgency order: `Human Gates`, `Anomalies`, `Running Now`, `Recent Outcomes`. Each region is a solid elevated card with a count, up to five ranked rows, and one overflow navigation action.
- **Feature Delivery composition**: split view with run list on the left, selected run mission-control panel in the main column, and optional artifact or log drawer on the right. Human-gate actions remain in context and do not force a route change.
- **Compliance + Recovery composition**: severity-grouped failure cards above a recovery worklist. Missing-artifact and stale-run issues surface before informational results.
- **Automations composition**: registry list with row controls, create or edit drawer, and history inset. Lifecycle actions sit adjacent to the automation they affect.
- **Activity Log composition**: bounded feed with receipt rows, filter chips, and one details drawer. The default row stays summary-first and never dumps raw source prose.
- **Cmd-K composition**: first group for destinations, second group for the 10 most frequent actions, third group for the currently selected object when context exists. Every launcher action is mirrored by a visible surface control.
- **Spacing rhythm**: repeated panel layouts use `space-1` 4px, `space-2` 8px, `space-3` 12px, `space-4` 16px, `space-6` 24px, and `space-8` 32px. Sibling cards and rows share the same padding token within a region.

## Visual Design Tokens

- **Surface tokens**: `surface.canvas`, `surface.panel`, `surface.panelElevated`, `surface.inset`, and `border.subtle`. Orientation panels and list groups use solid elevated surfaces only; dashed or placeholder borders are forbidden in shipped views.
- **Text tokens**: `text.primary`, `text.secondary`, `text.muted`, `text.inverse`. Primary row labels stay operator-readable and roughly 60 characters or less.
- **Accent and status tokens**: `accent.primary`, `accent.primaryText`, `status.blocking`, `status.warning`, `status.success`, and matching subdued backgrounds. Accent fill is reserved for one primary action per region and active navigation state.
- **Type scale**: `type.label` for pills and metadata, `type.body` for row copy, `type.bodyStrong` for first-read labels, `type.title` for card headings, and `type.display` for page titles. A single surface uses no more than five distinct sizes.
- **Radius and shadow**: `radius.md` for rows and pills, `radius.lg` for cards and drawers, `shadow.sm` for inset regions, and `shadow.md` for floating overlays.
- **Row pattern**: Mobbin-fidelity operational rows use one human-readable primary line, one muted metadata line, one accent primary CTA, and an overflow menu for secondary actions. Visible raw paths, raw IDs, and raw ISO timestamps are banned from the default row body; copy-only actions or a closed technical disclosure may expose them.

## Interaction Requirements

- **Home**: `Human Gates`, `Anomalies`, `Running Now`, and `Recent Outcomes` use the same reconciled state as the rail attention indicator. Staleness older than 60 seconds shows a data-age badge. Reconciliation failure shows a degraded-data banner naming the failed source instead of silently reusing stale lists.
- **Home row actions**: gate rows expose `Approve <object>`, `Reject <object>`, or `Revise <object>` in two clicks from the announcing surface; anomaly and running rows use `Open run detail`; recent outcomes use `Open shipped feature`.
- **Feature Delivery**: each run row shows title, stage, urgency, relative age, and one primary action. The selected run view includes stage rail, retry context, intervention strip, artifact groups, and a calm-by-default log drawer.
- **Intervention levers**: reversible actions offer undo for at least 10 seconds when supported; destructive actions use one confirmation step naming the blast radius. `Pause <run>`, `Steer <run>`, and `Abort <run>` are visually separated from safe actions.
- **Compliance + Recovery**: failure rows summarize the violated rule and effect, not the full underlying prose. Missing-artifact issues use `Run recovery for <object>` as primary; broader failures use `Re-run compliance audit`. Each open issue includes at least one review path and one recovery path.
- **Automations**: list rows support `Enable <automation>`, `Disable <automation>`, `Edit <automation>`, `Pause <automation>`, `Re-enable <automation>`, and `Open run history` through adjacent controls. Create and edit flows use a stepper with strong defaults so the operator does not assemble raw scheduler fields.
- **Activity Log**: every state mutation renders a receipt row with actor, verb, object, relative time, and artifact or diff link. Receipts sort by severity then recency and deep-link back to the owning surface.
- **Cmd-K**: keyboard launcher opens within 200ms, filters as the operator types, and keeps destructive actions out of the default top results unless the query explicitly matches them.
- **States**: every owned surface defines empty, loading, hover, focus, active, selected, disabled, success, and error states. Empty states always suggest one next step. Loading feedback appears within 400ms. Error states preserve context and provide a named retry action.
- **Motion**: transitions stay within 120ms to 240ms, honor `prefers-reduced-motion`, and use at most one attention nudge for a newly blocking item with no looping animation.
- **Containment and hierarchy**: content must stay inside its container at supported breakpoints, aligned surfaces share a baseline or edge, and each region has one visually dominant first-read element so sidebars never compete equally with the main column.

## Accessibility Minimums

- Meet WCAG 2.2 AA for text contrast (`1.4.3`) and non-text contrast (`1.4.11`) across rail, cards, chips, focus rings, and button boundaries.
- Keep all navigation, row actions, drawers, dialogs, and launcher flows keyboard operable (`2.1.1`) with visible focus indication (`2.4.7`) and predictable focus order (`2.4.3`).
- Use text plus icon or pill state, never color alone, for urgency, blocking, success, or disabled states.
- Truncate long labels with an accessible full-value affordance rather than overflow or uncontrolled wrap.
- Ensure dialogs and drawers preserve focus context, trap focus when modal, and announce completion or exit states through polite live regions where needed (`4.1.2`).

## Craft Gates

- Every orientation panel and list row clears the raw-data exposure gate by showing human-readable labels first and hiding technical values behind copy-only or closed-by-default disclosures.
- Every region contains exactly one accent-filled primary CTA; secondary actions move to text buttons or overflow to avoid choice overload and accent sprawl.
- Every shipped card uses polished elevated surfaces with consistent padding, radius, and shadow; wireframe chrome and flat placeholder blocks are gate-blocking defects.
- Every mutation label uses an imperative verb plus a concrete object, such as `Approve plan for command-center-rebuild` or `Pause automation nightly-curation`.
- Every panel that can be empty, loading, or erroring specifies all three states with an operator-guiding next step.

```yaml
contract:
  id: command-center-rebuild.ux.home-orientation-truthfulness
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-rebuild/ux-spec.md
    symbol: "Interaction Requirements"
  owner: design-engineer
  description: |
    When the Home surface renders with mixed active, blocked, archived, and shipped
    work, the UI SHALL show exactly four urgency-ordered orientation regions, SHALL
    exclude archived or shipped items from operator-attention rows, SHALL expose one
    primary verb-plus-object action per row, and SHALL avoid visible raw paths, raw
    IDs, or raw timestamps in the default row body.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-rebuild/ux-spec.md
      range: [62, 63]
      note: Home orientation, action, and raw-data requirements.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Human Gates card shows one row with Approve plan for search-redesign and a hidden copy-path action in overflow."
            rationale: Truthful orientation with a clear next step.
        bad:
          - text: "Archived run appears in Needs You beside a visible .pan/work path and three equal buttons."
            rationale: Violates truthfulness, raw-data, and choice-overload gates.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: command-center-rebuild.ux.home-orientation-truthfulness
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-rebuild/ux-spec.md#Interaction-Requirements
    pancreator.wcag-criteria: ["1.4.3", "2.4.3", "2.4.7"]
```

```yaml
contract:
  id: command-center-rebuild.ux.mission-control-and-receipts
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/command-center-rebuild/ux-spec.md
    symbol: "Interaction Requirements"
  owner: design-engineer
  description: |
    When the operator opens Feature Delivery, Compliance + Recovery, or Automations,
    the selected object SHALL keep its intervention controls adjacent to the object
    they affect, every operation that may exceed 400ms SHALL show loading feedback,
    destructive actions SHALL require one blast-radius confirmation, and successful
    state mutations SHALL produce a receipt row in Activity Log with actor, verb,
    object, relative time, and artifact or diff link.
  references:
    - kind: lines
      path: /lib/memory/features/command-center-rebuild/ux-spec.md
      range: [64, 68]
      note: Intervention, loading, confirmation, and receipt requirements.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Pause nightly-curation opens one confirmation dialog, then Activity Log records Paused nightly-curation with a diff link."
            rationale: Adjacent control, explicit confirmation, and auditable receipt.
        bad:
          - text: "Disable automation succeeds silently after a delayed spinnerless click and no audit row appears."
            rationale: Violates feedback-latency and receipt obligations.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: command-center-rebuild.ux.mission-control-and-receipts
    pancreator.applies_to: artifact-symbol:/lib/memory/features/command-center-rebuild/ux-spec.md#Interaction-Requirements
    pancreator.wcag-criteria: ["2.1.1", "2.4.7", "4.1.2"]
```
