---
title: Cockpit v2 Pipeline command center and human gate queue Engineering Spec
feature_id: cockpit-v2-pipeline-command-center-and-human-gate-queue
task_id: 52646_0922_cockpit-v2-pipeline-command-center-and-human-gate-queue
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
depends_on: [cockpit-v2-ux-spec-and-information-architecture]
blocks: [cockpit-v2-pipeline-live-artifacts]
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines five required outcomes, five acceptance checks, explicit out-of-scope boundaries, a touch set, and a ratified ux-spec dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates Next Action panel, human gate queue, API field split, config panel, and component-extraction outcomes with machine-checkable acceptance criteria.
  - The canonical ux-spec authority path is lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md rather than the program shorthand cockpit-v2/ cited in the directive goal.
  - Inbox triage, multi-run table, live polling, and Automations or Maintenance modules remain out of scope for this Feature per the directive and downstream cockpit-v2 inbox items.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [24, 27]
    note: Source directive Problem section states P9 nextCommand rendering and missing human-gate queue.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [28, 30]
    note: Source directive Goal section names ux-spec authority and DashboardPage extraction.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [32, 38]
    note: Source directive Required outcomes enumerate command center, gate queue, API split, config panel, and component extraction.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [40, 46]
    note: Source directive Acceptance criteria anchor copy command, gate queue, config refresh, P9 regression, and P10 read-only guard.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [48, 52]
    note: Source directive Out of scope excludes live polling, inbox triage, and mutating APIs.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-pipeline-command-center.md
    range: [59, 69]
    note: Source directive Touch set lists cockpit components, run-state services, API routes, and globals.css tokens.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [128, 136]
    note: Ratified Pipeline module interaction requirements for Next Action, human gate banner, and config panel.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [168, 183]
    note: Ratified component inventory under client/src/components/cockpit/.
  - kind: lines
    path: lib/memory/features/surface-opt-p9-dashboard-operator-cockpit/spec.md
    range: [119, 137]
    note: P9 GET /api/run-state envelope and stage-cell contract that this Feature extends.
  - kind: lines
    path: lib/memory/features/surface-opt-p10-dashboard-safe-editing/spec.md
    range: [42, 46]
    note: P10 read-only default and write-guard contract that Files tab actions MUST preserve.
  - kind: lines
    path: client/src/services/run-state.ts
    range: [107, 125]
    note: Current stageActionFields merges humanAttention into nextHumanAction for non-active cells.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [15, 37]
    note: Shared StageCell and TaskRunStateEnvelope types to extend with distinct humanAttention field.
  - kind: lines
    path: client/src/components/DashboardPage.tsx
    range: [1, 80]
    note: Monolithic dashboard surface to refactor into CockpitShell and pipeline components.
  - kind: lines
    path: pancreator.yaml
    range: [14, 26]
    note: Live runner invocation, stage remediation, and SDK sampling values for config panel.
  - kind: lines
    path: pancreator-model-escalation.yaml
    range: [17, 38]
    note: Persona escalation tier ladder for read-only badge display.
---

# Spec

This Feature SHALL deliver the Cockpit v2 Pipeline command center so operators
see the next human action, the next machine command, and every waiting
human-approval gate without pasting `pan status` into chat. The shipped P9
dashboard renders `nextCommand` as static code and collapses operator guidance
into stage cells. The Feature SHALL split `humanAttention` from `nextCommand`
in the run-state API, SHALL add a read-only runtime configuration panel, SHALL
implement the Next Action panel and human gate queue per the ratified ux-spec,
and SHALL begin extracting `client/src/components/cockpit/` from
`DashboardPage.tsx` while preserving P9 grid, timeline, and P10 safe-editing
behavior.

## Acceptance criteria

### Run-state API field split

- When `GET /api/run-state` returns a task envelope, each `StageCell` SHALL
  expose `humanAttention` and `nextCommand` as separate string fields and
  SHALL NOT collapse `humanAttention` into `nextCommand`.
- When a stage cell status is `active`, the cell SHALL populate `nextHumanAction`
  and `nextCommand` from `pan status --json` and SHALL leave `humanAttention`
  empty unless `state.json` carries a persisted `humanAttention` value for that
  stage.
- When a stage cell status is `complete` or `failed`, the cell SHALL populate
  `humanAttention` from the persisted stage record and SHALL leave `nextCommand`
  empty unless `pan status --json` supplies a task-level `nextCommand`.
- When `client/src/services/run-state-shared.ts` exports envelope types, the
  types SHALL include the distinct `humanAttention` field on `StageCell`.

### Next Action panel

- When an operator selects a task in the Pipeline module, the Next Action panel
  SHALL render as a sticky surface showing `nextHumanAction`, `nextCommand`, the
  decoded task label from `taskDisplayLabel`, and the run directory path.
- When the operator activates Copy command, the UI SHALL copy the task-level
  `nextCommand` string to the clipboard and SHALL display a 2-second Copied
  tooltip with `aria-live="polite"` per the ux-spec copy-command pattern.
- When the operator activates Open next-prompt, the UI SHALL open
  `work/<day>/<task-id>/next-prompt.md` in the Files tab artifact modal.
- When the operator activates Open run folder, the UI SHALL navigate the Files
  tab to the task run directory.

### Human gate queue

- When at least one active run has a stage with `humanGate` equal to
  `human_approval` and status `active` or `ready`, the Pipeline module SHALL
  render a global attention banner on initial load.
- When the human gate queue renders, the queue SHALL list every matching stage
  across all non-terminal active runs returned by `GET /api/run-state`.
- When a gate-queue row renders, the row SHALL link to `plan.md`, `review.md`,
  and `test-report.md` when those artifacts exist under the task run directory,
  and SHALL link to the inbox source path recorded in run state when present.
- When the operator dismisses the attention banner for one gate, the dismissed
  gate SHALL remain visible in the Next Action panel for the selected task.

### Runtime configuration panel

- When the Pipeline module renders, the config panel SHALL load read-only data
  from `GET /api/config`.
- When `GET /api/config` executes, the route SHALL parse live `pancreator.yaml`
  and `pancreator-model-escalation.yaml` from the repository root and SHALL
  return SDK versus manual invocation mode, `design_steps` default, stage
  remediation flag, and persona escalation tier badges.
- When an operator edits `pancreator.yaml` on disk and refreshes the dashboard,
  the config panel SHALL display the updated values without a server restart.

### Component extraction and shell

- When the dashboard loads, `DashboardPage` SHALL render through
  `CockpitShell` with Pipeline as the default module tab per the ux-spec
  three-module shell.
- When implement stage completes, the touch-set paths under
  `client/src/components/cockpit/pipeline/`, `client/src/components/cockpit/layout/`,
  and `client/src/components/cockpit/shared/` SHALL contain extracted
  `NextActionPanel`, `HumanGateBanner`, and `ConfigReadOnlyPanel` components.
- When Cockpit v2 styles apply, `client/src/app/globals.css` SHALL extend
  cockpit-v2 design tokens from the ux-spec without breaking existing P9 stage
  status classes.

### Regression and safety

- When the test suite runs, existing P9 stage-grid and run-event timeline tests
  SHALL pass or SHALL gain equivalent coverage after the refactor.
- When an operator opens a P10 guarded path from Files tab actions, the Files
  modal SHALL remain read-only by default and SHALL enforce the P10 write guard.

## Out of scope

- Live polling or websocket refresh of run state; the
  `cockpit-v2-pipeline-live-artifacts` inbox item owns that capability per
  source directive.
- Inbox triage panel, active-memory orientation, and multi-run table UX; the
  `cockpit-v2-pipeline-orientation` inbox item owns those surfaces per source
  directive.
- Execute or mutating API endpoints; this Feature delivers read-only
  `GET /api/run-state` and `GET /api/config` routes only.
- Automations and Maintenance module implementation beyond placeholder module
  tabs required by `CockpitShell`; those modules ship in separate Cockpit v2
  inbox items.
- Artifact drawer extraction, inbox deep links, and run-history panels not
  listed in the source directive touch set.
- Changes to `lib/internal/packages/@pancreator/cli/`, MCP handlers, persona
  specs, `state.json` schema, or `run.log.jsonl` schema.

## Open questions

_(none — directive and ratified ux-spec supply sufficient scope for plan-stage delegation)_
