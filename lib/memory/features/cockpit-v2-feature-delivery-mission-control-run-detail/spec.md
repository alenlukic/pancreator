---
title: Cockpit v2 Feature Delivery Mission Control run detail Engineering Spec
feature_id: cockpit-v2-feature-delivery-mission-control-run-detail
task_id: 50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
depends_on:
  - cockpit-v2-shell-theme-foundation
  - cockpit-v2-ux-philosophy-information-architecture-and-user-stories
  - cockpit-v2-live-run-refresh-and-stage-artifact-drawer
blocks:
  - cockpit-v2-quick-fix
  - cockpit-v2-activity-log
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines six required outcomes, five acceptance checks, explicit out-of-scope boundaries, a touch set, and ratified ux-spec §4.4 authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates stage rail, retry-limit banner, stage detail, artifacts by stage, verbose log drawer, and run-state preservation with machine-checkable acceptance criteria.
  - P9 `StageMachineGrid` and `RunEventTimeline` SHALL migrate into `client/src/components/cockpit/mission-control/` while `client/src/components/cockpit/pipeline/` retains thin re-exports for the Pipeline module regression surface.
  - Remediation CTAs Retry stage, Retry with config, Run quick fix, Mark issue resolved, and Cancel run MAY stub with operator-visible not-implemented toasts until `cockpit-v2-quick-fix` lands; the banner and strip MUST still render per ux-spec §4.4.
  - Contract `cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.fd-mission-control-stage-rail` is the blocking llm-judge gate at threshold 0.75.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [38, 42]
    note: Source directive Problem section states fragmented run inspection and P9 grid/timeline placement.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [44, 47]
    note: Source directive Goal binds ux-spec §4.4 and fd-mission-control-stage-rail contract.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [48, 56]
    note: Source directive Required outcomes enumerate stage rail, retry banner, stage detail, artifacts, logs, and run-state preservation.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [57, 63]
    note: Source directive Acceptance criteria anchor contract threshold, retry visibility, stage rail, log drawer calm default, and P10 safety.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [65, 70]
    note: Source directive Out of scope excludes command center, quick fix invocation, compliance queue, and kickoff flow.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-fd-mission-control.md
    range: [77, 81]
    note: Source directive Touch set lists mission-control components, pipeline migration shims, run-state services, API route, and client tests.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [131, 133]
    note: Ratified ux-spec FD Mission Control §4.4 stage rail, retry banner, artifacts, and verbose log drawer requirements.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [227, 267]
    note: Blocking llm-judge contract fd-mission-control-stage-rail rubric and threshold 0.75.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [163, 165]
    note: Shared drawer and banner motion tokens at most 200ms ease-out with prefers-reduced-motion honor.
  - kind: lines
    path: lib/memory/features/cockpit-v2-live-run-refresh-and-stage-artifact-drawer/delivery-report.md
    range: [34, 76]
    note: Shipped live polling, stage order with compliance, stageArtifactContract mirror, and P10 read-only handoff prior art.
  - kind: lines
    path: lib/memory/features/cockpit-v2-live-run-refresh-and-stage-artifact-drawer/spec.md
    range: [109, 178]
    note: Prior Feature acceptance patterns for polling, telemetry chips, and artifact presence checks this Feature extends into mission control.
  - kind: lines
    path: lib/memory/features/surface-opt-p10-dashboard-safe-editing/spec.md
    range: [42, 46]
    note: P10 read-only default and write-guard contract that artifact preview and open-in-editor MUST preserve.
  - kind: lines
    path: client/src/components/cockpit/layout/surface-config.ts
    range: [52, 58]
    note: Ten-surface shell registers FD Mission Control at route /mission-control as first-slice surface.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [219, 259]
    note: Retry-limit detection helpers and per-stage retry transition counting for banner and badge rendering.
  - kind: lines
    path: client/src/app/api/run-state/route.ts
    range: [1, 6]
    note: GET /api/run-state composition this Feature MUST preserve without breaking envelope shape.
---

# Spec

This Feature SHALL deliver the Cockpit v2 FD Mission Control surface at route
`/mission-control` so operators inspect one feature-delivery run with stage
sequence, retry loops, per-stage artifacts, remediation affordances, and verbose
logs in one mission-control view. The shipped P9 Pipeline module embeds
`StageMachineGrid` and `RunEventTimeline` without the ux-spec §4.4 stage rail,
retry-limit banner, stage detail panel, or artifacts-by-stage grouping. The
Feature SHALL migrate grid and timeline implementations into
`client/src/components/cockpit/mission-control/`, SHALL compose
`GET /api/run-state` with the live polling patterns from
`cockpit-v2-live-run-refresh-and-stage-artifact-drawer`, and SHALL satisfy
contract
`cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.fd-mission-control-stage-rail`
at llm-judge threshold 0.75.

## Acceptance criteria

### Stage rail

- When FD Mission Control renders a selected task, the stage rail SHALL list
  stages intake, plan, implement, review, test, report, compliance, ship, and
  index in that order.
- When a stage cell status is `active`, the cell SHALL render accent border
  treatment and a visible current-stage label per ux-spec §4.4.
- When `run.log.jsonl` records retry transitions for a stage, the corresponding
  stage cell SHALL render a retry count badge with the transition count.
- When a stage cell status is `failed`, the cell SHALL render
  `--color-status-error` treatment distinct from complete cells.
- When an operator activates a non-pending stage cell, the module SHALL select
  that stage for the stage detail panel and artifact group expansion.

### Retry-limit banner and remediation strip

- When `detectRetryLimitFailure` returns a summary for the selected task, the
  module SHALL render an unmistakable retry-limit banner above the stage rail
  with failing stage name, retry count, and loop history summary text.
- When the retry-limit banner renders, the remediation strip SHALL expose
  buttons labeled Retry stage, Retry with config, Run quick fix, Mark issue
  resolved, and Cancel run.
- When an operator activates a remediation button before quick-fix wiring lands,
  the UI SHALL show an operator-visible not-implemented toast naming the action
  rather than fail silently.

### Stage detail panel

- When an operator selects a non-pending stage, the stage detail panel SHALL
  show stage name, owner persona, status pill, start time, and end time when
  terminal.
- When the selected stage status is `failed`, the panel SHALL show a Critical
  severity chip and the newest stage-scoped error excerpt from run events.
- When stage output exceeds 280 characters, the panel SHALL truncate by default
  and SHALL offer expand and collapse controls.
- When an operator activates Copy stage output, the panel SHALL copy the visible
  output excerpt to the clipboard and SHALL confirm copy success inline.

### Artifacts by stage

- When FD Mission Control renders for a task with `featureId` and `runDir`, the
  artifacts panel SHALL group required paths from `stageArtifactContract` under
  each FD stage heading.
- When a required artifact path is absent on disk, the row SHALL render Blocking
  severity and a Missing artifact label and SHALL disable preview actions.
- When a required artifact path is present on disk, the row SHALL enable Preview
  artifact and Open in editor actions.
- When Preview artifact opens the P10 Files modal, the modal SHALL keep read-only
  default visible until the operator explicitly enters edit mode.

### Verbose log drawer

- When FD Mission Control first renders, the verbose log drawer SHALL remain
  closed so the default mission-control view stays calm.
- When an operator activates Open run logs, the module SHALL open a right-side
  drawer with severity filter chips for all, retry, escalation, and deferral and
  an event-type select filter.
- When the drawer is open, pressing Escape or activating the backdrop SHALL
  close the drawer.
- When drawer open and close animations run, transitions SHALL complete within
  200 milliseconds and SHALL honor `prefers-reduced-motion`.

### Run-state preservation and live refresh

- When the module loads, it SHALL fetch task envelopes from
  `GET /api/run-state` without altering the response schema consumed by the
  Pipeline module.
- When the selected task is non-terminal and has an active stage cell, the
  module SHALL poll `GET /api/run-state` on an interval between 5 seconds and
  10 seconds inclusive and SHALL merge envelopes without remounting the shell.
- When polling stops, the run context header SHALL remove the live indicator.
- When Command Center or deep links supply `?task=<taskId>`, the module SHALL
  pre-select that task when present in the envelope list.

### P9 grid and timeline migration

- When the Pipeline module imports `StageMachineGrid` or `RunEventTimeline` from
  `client/src/components/cockpit/pipeline/`, those modules SHALL re-export the
  canonical implementations from `client/src/components/cockpit/mission-control/`
  without behavior regression.
- When mission-control chrome is enabled on a stage cell, retry badges and
  current-stage accent treatment SHALL render only on the mission-control stage
  rail, not on the Pipeline multi-run grid default chrome.

### Contract, tests, and safety

- When compliance evaluates contract
  `cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.fd-mission-control-stage-rail`
  against a retry-limit fixture, the llm-judge score SHALL be at least 0.75.
- When the client test suite runs, focused mission-control tests and existing
  Pipeline regression tests SHALL pass.
- When an operator opens an artifact from mission control, P10 safe-editing
  guards on pipeline-owned paths SHALL remain unchanged.

## Out of scope

- Command Center hub cards and operational-state rows; the
  `cockpit-v2-command-center` Feature owns that surface per source directive.
- Out-of-band quick fix persona invocation and diff review flow; remediation
  CTAs MAY stub until `cockpit-v2-quick-fix` lands per source directive.
- Global compliance queue grouping and re-run compliance check actions; the
  `cockpit-v2-compliance-recovery` program item owns that surface per source
  directive.
- Work Intake kickoff stepper, model presets, and Launch feature delivery flow;
  the `cockpit-v2-work-intake-kickoff` Feature owns that surface per source
  directive.
- Mutating run-control APIs such as stage retry execution, run cancel, or config
  rewrite; this Feature delivers inspection and stub remediation affordances
  only.
- Changes to `lib/internal/packages/@pancreator/cli/` run-log schema, persona
  specs, or `state.json` persistence format.

## Open questions

_(none — directive, ratified ux-spec §4.4, fd-mission-control-stage-rail contract, and live-run-refresh prior art supply sufficient scope for plan-stage delegation)_
