---
title: Cockpit v2 Automations list and run history under ten-surface shell Engineering Spec
feature_id: cockpit-v2-automations-list-and-run-history-under-ten-surface-shell
task_id: 25237_1659_cockpit-v2-automations-list-and-run-history-under-ten-surface-shell
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
depends_on:
  - cockpit-v2-app-shell-navigation-rail-and-operator-theme-tokens
  - cockpit-v2-automation-registry-and-management-ui
  - cockpit-v2-local-scheduler-tick-and-run-history
  - cockpit-v2-ux-philosophy-information-architecture-and-user-stories
blocks:
  - cockpit-v2-activity-log
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines five required outcomes, four acceptance checks, explicit out-of-scope boundaries, a touch set, ratified ux-spec §4.11, and shipped registry plus scheduler dependencies without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates automations list, create wizard, run history, pause/disable, and shell migration outcomes with machine-checkable acceptance criteria.
  - The canonical shell dependency slug is cockpit-v2-app-shell-navigation-rail-and-operator-theme-tokens rather than the program shorthand cockpit-v2-shell-theme-foundation cited in the directive depends_on field.
  - The ten-surface route client/src/app/(cockpit)/automations/page.tsx currently renders CockpitSurfacePlaceholder; AutomationsModule still mounts inside the superseded three-module CockpitShell tab on DashboardPage.
  - Pause/disable guarded confirm satisfies ux-spec §4.11 in this Feature; Activity Log event emission for pause actions defers to cockpit-v2-activity-log per the directive Out of scope section.
  - Retry automation run SHALL invoke POST /api/automations/[id]/run for failed or eligible runs; open related artifacts SHALL deep-link run.taskId to FD Mission Control or Repo Explorer when present.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [44, 47]
    note: Source directive Problem section states AutomationsModule lives in the superseded three-module shell.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [48, 51]
    note: Source directive Goal section names ten-surface re-home and shipped registry plus scheduler APIs.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [52, 58]
    note: Source directive Required outcomes enumerate list, wizard, history, pause, and shell integration.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [60, 65]
    note: Source directive Acceptance criteria anchor API usage, failed-row styling, wizard fields, and scheduler preservation.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [67, 71]
    note: Source directive Out of scope excludes complex templates, activity log emission, and Command Center card redesign.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63489_0621_cockpit-v2-automations-shell-history.md
    range: [78, 84]
    note: Source directive Touch set lists automations components, AutomationsModule refactor, API routes, and client tests.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [159, 161]
    note: Ratified Automations / Cron §4.11 list, wizard, history, retry, and pause confirm requirements.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [82, 84]
    note: Prior-art supersession maps Automations module tab to Automations ten-surface route.
  - kind: lines
    path: lib/memory/features/cockpit-v2-automation-registry-and-management-ui/delivery-report.md
    range: [1, 6]
    note: Shipped registry CRUD, AutomationsModule list, wizard, and API routes under /api/automations.
  - kind: lines
    path: lib/memory/features/cockpit-v2-local-scheduler-tick-and-run-history/delivery-report.md
    range: [1, 6]
    note: Shipped tick CLI, JSONL run history, Run now route, and expandable run log excerpts.
  - kind: lines
    path: client/src/app/(cockpit)/automations/page.tsx
    range: [1, 8]
    note: Current ten-surface Automations route renders placeholder pending migration.
  - kind: lines
    path: client/src/components/cockpit/layout/CockpitShell.tsx
    range: [44, 47]
    note: Superseded three-module Automations tab still selects AutomationsModule on DashboardPage.
  - kind: lines
    path: client/src/components/cockpit/automations/AutomationsModule.tsx
    range: [239, 272]
    note: Prior-art two-column list plus run-history layout to migrate into ten-surface shell.
  - kind: lines
    path: client/src/components/cockpit/layout/surface-config.ts
    range: [105, 113]
    note: Automations surface registered at route /automations with firstSlice true in left rail.
  - kind: lines
    path: lib/internal/packages/@pancreator/scheduler/src/due.ts
    range: [98, 104]
    note: Prior-art nextCronFireAfter primitive for preview-next-run labels.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [666, 684]
    note: Prior-art formatLastEventTime helper for relative last-run labels.
  - kind: lines
    path: client/src/app/api/automations/[id]/run/route.ts
    range: [1, 20]
    note: Prior-art Run now and retry dispatch route consumed by browser fetch only.
---

# Spec

This Feature SHALL re-home Cockpit v2 automations list, create wizard, and run
history into the ten-surface shell at route `/automations` per ratified ux-spec
§4.11. The Feature SHALL consume shipped registry CRUD and scheduler run-history
APIs from `cockpit-v2-automation-registry-and-management-ui` and
`cockpit-v2-local-scheduler-tick-and-run-history` without changing tick
execution or JSONL schemas. The Feature SHALL replace the
`CockpitSurfacePlaceholder` on the Automations route, SHALL migrate
`AutomationsModule` out of the superseded three-module `CockpitShell` tab, and
SHALL preserve Command Center recent-automations data reuse without redesigning
that card region.

## Acceptance criteria

### Ten-surface shell integration

- When an operator navigates to `/automations`, the ten-surface shell SHALL render
  `AutomationsSurface` (or a thin wrapper around migrated `AutomationsModule`)
  inside `client/src/app/(cockpit)/automations/page.tsx` instead of
  `CockpitSurfacePlaceholder`.
- When the left navigation rail renders, the Automations surface entry SHALL
  show `aria-current="page"` while route `/automations` is active per ux-spec
  accessibility minimums.
- When an operator selects the superseded three-module Automations tab on
  `DashboardPage`, the client SHALL navigate to `/automations` or SHALL render
  a deep-link banner that sends the operator to the ten-surface Automations
  route as the default navigation target.
- When Automations content mounts in the ten-surface shell, layout chrome SHALL
  use existing `cockpit-v2-app-shell-navigation-rail-and-operator-theme-tokens`
  rail, main, and shared loading, empty, and error states per ux-spec shared
  states.

### Automations list

- When the list view loads, the client SHALL fetch `GET /api/automations` and
  SHALL NOT invoke `pnpm` or `pan` from the browser.
- When each list row renders, the row SHALL show automation name, human-readable
  schedule label, status badge, relative last-run time when a run exists, and
  relative or absolute next-run label when the automation is enabled.
- When an automation latest run status is `error`, the list row SHALL use the
  failed visual treatment distinct from scheduled, running, and paused rows.
- When an automation `enabled` field is `false`, the list row SHALL use the
  paused visual treatment distinct from failed and scheduled rows.
- When the operator types in the list search field, the client SHALL filter
  rows by automation name, persona slug, or schedule label without a full page
  reload.
- When a status filter control is present, the client SHALL offer at least
  All, Failed, and Paused filters that combine with search text.

### Create and edit wizard

- When an operator starts create or edit, the wizard SHALL present linear steps
  for schedule, persona, prompt input, and review consistent with shipped
  `AutomationWizardShell`.
- When the schedule step renders, the wizard SHALL accept cron presets plus
  custom 5-field cron input and SHALL validate schedule before advancing.
- When the review step renders before save, the wizard SHALL show a read-only
  summary including preview next run computed from the draft cron schedule.
- When the operator confirms save on create, the wizard SHALL persist through
  `POST /api/automations` with `enabled: true` unless the operator explicitly
  chooses save disabled.
- When the operator confirms save on edit, the wizard SHALL persist through
  `PUT /api/automations` without mutating unrelated registry fields.
- When complex automation templates or visual workflow builder affordances would
  appear, the Feature SHALL omit them and SHALL keep agent-trigger wizard only
  for this slice.

### Run history panel

- When the operator selects a list row, the run-history panel SHALL fetch
  `GET /api/automations/[id]/runs` and SHALL list runs newest first with status
  badge, start time, duration when finished, trigger label, and expandable
  stdout or stderr excerpts.
- When a run row status is `error` and the automation is enabled, the panel
  SHALL expose a **Retry automation run** control that POSTs to
  `/api/automations/[id]/run` and refreshes history on success.
- When a run record includes `taskId` or artifact paths, the expanded row
  SHALL expose **Open related artifacts** links to FD Mission Control or Repo
  Explorer using human labels rather than raw paths as default row text.
- When no automation is selected, the panel SHALL render the guided empty state
  per ux-spec shared states.

### Pause, disable, and enable

- When the operator pauses or disables an enabled automation from list controls,
  the UI SHALL open a guarded confirm dialog before calling
  `PUT /api/automations` with `enabled: false`.
- When the operator confirms pause, the client SHALL persist the disabled state
  and SHALL reflect paused badge styling on the row without deleting history.
- When the operator resumes a paused automation, the client SHALL persist
  `enabled: true` through the existing toggle or resume control.
- When pause or resume succeeds, Activity Log event emission SHALL remain out of
  scope for this Feature per source directive; downstream
  `cockpit-v2-activity-log` owns durable event recording.

### API boundary and scheduler preservation

- When any Automations surface action executes, the browser SHALL call Next.js
  routes under `/api/automations` only and SHALL NOT shell out to `pan`.
- When the test suite runs, existing `@pancreator/scheduler` tick tests and CLI
  `pnpm -w exec pan scheduler tick` behavior SHALL remain unchanged by this
  Feature.
- When run-history reads execute, the routes SHALL continue to source JSONL from
  `.pan/scheduler/runs/` without schema changes.

### Tests

- When `pnpm --filter client test` executes, focused tests under
  `client/src/components/cockpit/automations/` and Automations route tests
  SHALL pass.
- When list, wizard, pause confirm, retry, and shell migration behaviors ship,
  new or updated tests SHALL cover search filter, failed or paused row styling,
  preview next run on review, guarded pause confirm, retry POST, and
  `/automations` placeholder replacement.

## Out of scope

- Complex automation templates, visual workflow builder, and multi-trigger type
  selectors beyond agent-trigger wizard; source directive defers these
  capabilities.
- Activity Log event emission for pause, resume, run, or retry actions;
  `cockpit-v2-activity-log` owns durable stream recording per source directive.
- Command Center recent-automations card layout, copy, or ranking changes beyond
  reusing existing automation summary and run-preview fetch helpers per source
  directive.
- Scheduler tick dispatch, concurrency lock logic, JSONL append schemas, or
  CLI subcommand changes; `cockpit-v2-local-scheduler-tick-and-run-history`
  remains authoritative.
- Registry schema v1, `@pancreator/scheduler` validation rules, or CRUD route
  semantics changes beyond fields required for next-run display labels.
- LangGraph wiring, cloud scheduler hosting, or Cursor Automations product API
  coupling.
- Replacing the superseded three-module `CockpitShell` entirely; this Feature
  migrates Automations navigation default only, matching prior Command Center
  migration scope.

## Open questions

_(none — directive, ratified ux-spec §4.11, and shipped registry plus scheduler art supply sufficient scope for plan-stage delegation)_
