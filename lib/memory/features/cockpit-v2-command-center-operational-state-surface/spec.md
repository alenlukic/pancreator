---
title: Cockpit v2 Command Center operational state surface Engineering Spec
feature_id: cockpit-v2-command-center-operational-state-surface
task_id: 50770_0953_cockpit-v2-command-center-operational-state-surface
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
depends_on:
  - cockpit-v2-shell-theme-foundation
  - cockpit-v2-ux-philosophy-information-architecture-and-user-stories
blocks:
  - cockpit-v2-compliance-recovery
  - cockpit-v2-quick-fix
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines six required outcomes, five acceptance checks, explicit out-of-scope boundaries, a touch set, and ratified ux-spec §4.1 plus prior Pipeline command-center art without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates card regions, row pattern, urgency ranking, empty state, loading and error behavior, and Pipeline-module migration outcomes with machine-checkable acceptance criteria.
  - The canonical ux-spec authority path is lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md; contract cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.command-center-operational-state applies at design review.
  - Prior cockpit-v2-pipeline-command-center-and-human-gate-queue shipped Next Action panel and human gate queue inside the superseded three-module Pipeline shell; this Feature migrates those patterns into the Command Center default landing without restoring Pipeline as the default module tab.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [38, 42]
    note: Source directive Problem section states missing operational state at a glance and Pipeline content to migrate.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [44, 46]
    note: Source directive Goal section names ux-spec §4.1, run-state API, and shell dependency.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [48, 55]
    note: Source directive Required outcomes enumerate card regions, row pattern, urgency, empty state, loading, and migration.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [57, 63]
    note: Source directive Acceptance criteria anchor llm-judge contract, visibility, CTA rules, tests, and P9 preservation.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [65, 70]
    note: Source directive Out of scope excludes mission control detail, quick fix backend, compliance recovery view, and activity log stream.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63491_0621_cockpit-v2-command-center.md
    range: [77, 84]
    note: Source directive Touch set lists command-center, pipeline, DashboardPage, run-state service, API route, and client tests.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [105, 121]
    note: Ratified status, severity, and action taxonomies plus Command Center §4.1 card regions and row pattern.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [185, 225]
    note: llm-judge contract command-center-operational-state with threshold 0.75.
  - kind: lines
    path: lib/memory/features/cockpit-v2-pipeline-command-center-and-human-gate-queue/spec.md
    range: [133, 144]
    note: Prior human gate queue behavior to migrate from Pipeline module.
  - kind: lines
    path: lib/memory/features/cockpit-v2-pipeline-command-center-and-human-gate-queue/delivery-report.md
    range: [34, 67]
    note: Prior Next Action panel, gate banner, and run-state field split shipped in Pipeline shell.
  - kind: lines
    path: lib/memory/features/surface-opt-p9-dashboard-operator-cockpit/spec.md
    range: [119, 137]
    note: P9 GET /api/run-state envelope and stage-cell contract that this Feature SHALL preserve.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [278, 603]
    note: Shared Command Center severity, status pill, gate queue, and hanging-task helpers.
  - kind: lines
    path: client/src/components/cockpit/layout/surface-config.ts
    range: [23, 30]
    note: Command Center registered as first-slice default surface at route /command-center.
  - kind: lines
    path: client/src/components/cockpit/pipeline/HumanGateBanner.tsx
    range: [12, 52]
    note: Prior global human gate queue UI to refactor into Needs you card rows.
  - kind: lines
    path: client/src/components/cockpit/pipeline/NextActionPanel.tsx
    range: [1, 40]
    note: Prior next-action copy and artifact links to surface via row overflow, not primary line text.
---

# Spec

This Feature SHALL deliver the Cockpit v2 Command Center as the default operator
landing surface so operators see active runs, human gates, failures, compliance
violations, hanging tasks, recent automations, and recent activity without
opening chat or raw logs. The Feature SHALL implement ux-spec §4.1 and contract
`cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.command-center-operational-state`,
compose atop `GET /api/run-state` without replacing P9 aggregation, mount inside
the ten-surface shell from `cockpit-v2-shell-theme-foundation`, and migrate
human gate queue and next-action patterns from the superseded Pipeline module
without restoring three-module tabs as the default navigation model.

## Acceptance criteria

### Card regions and layout

- When Command Center renders with operational data, the surface SHALL display
  six card regions on `--surface-elevated` backgrounds in this order: **Needs
  you**, **Running now**, **Compliance issues**, **Hanging tasks**, **Recent
  automations**, and **Recent activity**.
- When a card region has zero rows, the card SHALL render region-specific empty
  copy instead of hiding the card header.
- When the operator loads Command Center at route `/` or `/command-center`, the
  ten-surface shell SHALL treat Command Center as the active default landing per
  `surface-config.ts`.

### Row pattern and progressive disclosure

- When a card row renders, the row SHALL show a human-readable feature label,
  status pill, severity chip, relative age, and exactly one primary CTA using
  verb-plus-object labels from the ux-spec action taxonomy.
- When a row needs secondary actions, the row SHALL expose them through an
  overflow menu or closed-by-default technical details disclosure and SHALL NOT
  show more than one accent primary CTA on the row.
- When a row would display a repository path, task id, or ISO timestamp, the
  row SHALL hide that value from the primary line and SHALL expose it only via
  overflow actions such as **Copy path** or **Copy run command**.

### Needs you region

- When at least one active run has a stage with `humanGate` equal to
  `human_approval` and status `active` or `ready`, the **Needs you** card SHALL
  list every matching gate across all non-terminal runs from `GET /api/run-state`.
- When a run stage hits retry-limit failure, the **Needs you** card SHALL list
  that run with Critical severity and primary CTA **Open mission control**.
- When **Needs you** rows render, each row primary CTA SHALL deep-link to FD
  Mission Control for the owning task.

### Running now, compliance, hanging, automations, and activity regions

- When a non-terminal run has an active stage that is not waiting on
  `human_approval`, the **Running now** card SHALL list that run with status
  pill and primary CTA **Open mission control**.
- When the latest compliance audit exposes open findings, the **Compliance
  issues** card SHALL list each finding with severity and primary CTA **Run
  quick fix** for missing-artifact issues or **Re-run compliance check** for
  other open violations; CTAs MAY deep-link to `/compliance` until
  `cockpit-v2-quick-fix` ships invocation.
- When `classifyHangingTask` marks a run stale or long-running, the **Hanging
  tasks** card SHALL list that run with Warning or higher severity and primary
  CTA **Open mission control**.
- When recent automation runs exist, the **Recent automations** card SHALL list
  failed runs before healthy runs and SHALL use primary CTA **Retry automation
  run** or **Open automations** as appropriate.
- When recent pipeline or automation events exist, the **Recent activity** card
  SHALL list preview events sorted by severity then recency with primary CTA
  **Open activity log**.

### Urgency ranking

- When multiple rows appear within one card, rows with Blocking or Critical
  severity SHALL sort above Info and Warning rows.
- When **Needs you** and **Hanging tasks** both contain rows, retry-limit
  failures, human gates, missing artifacts, and failed automations SHALL appear
  before long-running informational rows across the full page scan order.

### Empty, loading, and error states

- When `GET /api/run-state` returns zero non-terminal tasks and no compliance,
  automation, or activity preview rows, Command Center SHALL render a guided
  empty state with primary CTA **Start feature delivery** linking to the Work
  Intake kickoff route.
- When run-state data is loading, Command Center SHALL render skeleton placeholders
  within 400 ms and SHALL set `aria-busy="true"` on the card grid.
- When run-state fetch fails, Command Center SHALL render an inline error banner
  with a **Retry fetch** action that re-invokes data loading without a full page
  reload.

### Pipeline migration and shell integration

- When implement stage completes, human gate queue logic from
  `HumanGateBanner.tsx` and next-action overflow patterns from
  `NextActionPanel.tsx` SHALL reside under
  `client/src/components/cockpit/command-center/` or shared client-safe helpers
  consumed by Command Center rows.
- When the ten-surface shell renders, Command Center SHALL NOT require the
  superseded three-module Pipeline tab as the default module; Pipeline-specific
  grid, timeline, inbox triage, and config panels MAY remain in
  `client/src/components/cockpit/pipeline/` for legacy routes but SHALL NOT
  duplicate the Command Center card regions as the primary orientation surface.
- When `DashboardPage.tsx` or the `(cockpit)` app routes mount Command Center,
  the page SHALL render `CommandCenterSurface` inside the shell layout from
  `cockpit-v2-shell-theme-foundation`.

### Run-state data layer

- When Command Center loads operational rows, the client SHALL consume existing
  `GET /api/run-state` aggregation and SHALL NOT replace or fork the P9 envelope
  schema.
- When shared helpers in `run-state-shared.ts` classify gates, hanging tasks, or
  severities, Command Center and Pipeline consumers SHALL import those helpers
  rather than duplicating classification logic.

### Design contract and tests

- When design review runs contract
  `cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.command-center-operational-state`,
  the llm-judge panel SHALL score at least 0.75.
- When `pnpm --filter client test` executes, Command Center component and data
  tests under `client/src/components/cockpit/command-center/` SHALL pass.

## Out of scope

- FD Mission Control run detail, stage rail, retry-limit banner, and artifact
  drawer; the `cockpit-v2-fd-mission-control` inbox item owns that surface per
  source directive.
- Quick fix invocation backend and diff acceptance flow; Command Center CTAs
  MAY stub or deep-link until `cockpit-v2-quick-fix` ships per source directive.
- Full Compliance + Recovery grouped list view; the
  `cockpit-v2-compliance-recovery` inbox item owns that surface per source
  directive.
- Real-time Activity Log stream, filters, and virtualization; the
  `cockpit-v2-activity-log` inbox item owns that surface per source directive.
- Replacing `GET /api/run-state`, mutating pipeline APIs, or changing
  `state.json` and `run.log.jsonl` schemas.
- Restoring the superseded three-module CockpitShell tabs as the default operator
  landing when the ten-surface shell is available.

## Open questions

_(none — directive, ratified ux-spec §4.1, and prior Pipeline command-center art supply sufficient scope for plan-stage delegation)_
