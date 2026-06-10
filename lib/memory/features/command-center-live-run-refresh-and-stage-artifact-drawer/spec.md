---
title: Command Center live run refresh and stage artifact drawer Engineering Spec
feature_id: command-center-live-run-refresh-and-stage-artifact-drawer
task_id: 51057_0949_command-center-live-run-refresh-and-stage-artifact-drawer
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
depends_on: [command-center-pipeline-command-center-and-human-gate-queue]
blocks: [command-center-pipeline-orientation]
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines five required outcomes, five acceptance checks, explicit out-of-scope boundaries, a touch set, and a shipped command-center dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates live polling, running indicators, artifact drawer, stage-order fix, and escalation telemetry with machine-checkable acceptance criteria.
  - The directive touch-set shorthand StageGrid.tsx and RunTimeline.tsx map to shipped components StageMachineGrid.tsx and RunEventTimeline.tsx from the command-center Feature; ArtifactDrawer.tsx is net-new.
  - UX recommendations P12 and P14 in the directive goal map to the ratified ux-spec artifact-drawer and 9-stage-grid-plus-timeline interaction requirements rather than separate prior-art Feature ids.
  - Stage artifact lists SHALL resolve through stageArtifactContract in feature-delivery-stage-artifacts.ts, which is more complete than the outputs stanza in feature-delivery.yaml alone.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
    range: [24, 27]
    note: Source directive Problem section states one-shot P9 load, missing artifact links, and omitted compliance stage.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
    range: [28, 38]
    note: Source directive Goal and Required outcomes enumerate polling, indicators, drawer, stage order, and escalation telemetry.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
    range: [40, 46]
    note: Source directive Acceptance criteria anchor timeline append, drawer mapping, compliance stage, escalation visibility, and P10 guards.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
    range: [48, 52]
    note: Source directive Out of scope excludes SSE streaming, orientation surfaces, and POST /api/execute.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-live-artifacts.md
    range: [59, 67]
    note: Source directive Touch set lists pipeline components, run-state services, API route, and page tests.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [124, 136]
    note: Ratified P10 artifact-viewing guards and Pipeline artifact-drawer interaction requirements.
  - kind: lines
    path: lib/memory/features/command-center-pipeline-command-center-and-human-gate-queue/spec.md
    range: [90, 101]
    note: Shipped command-center Feature establishes DashboardModuleShell, Pipeline module extraction, and run-state field split this Feature extends.
  - kind: lines
    path: lib/memory/features/surface-opt-p9-dashboard-operator-command-center/spec.md
    range: [119, 137]
    note: P9 GET /api/run-state envelope and stage-cell contract that live refresh MUST preserve.
  - kind: lines
    path: lib/memory/features/surface-opt-p10-dashboard-safe-editing/spec.md
    range: [42, 46]
    note: P10 read-only default and write-guard contract that drawer-opened artifacts MUST preserve.
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [25, 78]
    note: Canonical feature-delivery stage inventory including compliance between report and ship.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts
    range: [48, 58]
    note: Canonical stage id list and compliance placement used for drawer artifact mapping.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts
    range: [440, 562]
    note: stageArtifactContract primary and required artifact paths per stage for drawer listing.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [1, 40]
    note: FEATURE_DELIVERY_STAGE_ORDER currently omits compliance; this Feature SHALL insert it between report and ship.
  - kind: lines
    path: client/src/components/command-center/pipeline/PipelineModule.tsx
    range: [33, 53]
    note: Current one-shot loadRunState on mount; this Feature SHALL add conditional polling while runs are active.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-sdk-progress.ts
    range: [7, 45]
    note: SDK progress kinds stage_enter, heartbeat, and stage_complete that inform running-stage semantics in the directive.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    range: [275, 295]
    note: cursor.runner.escalation run.log records that escalation telemetry SHALL surface.
---

# Spec

This Feature SHALL add live run refresh, running-stage indicators, and a stage
artifact drawer to the Command Center Pipeline module so operators observe SDK runs
without pasting terminal output. The shipped P9 dashboard loads
`GET /api/run-state` once and omits the `compliance` stage from the grid. The
Feature SHALL poll run state every 5 seconds to 10 seconds while any non-terminal
task has an active stage, SHALL pulse the active cell with elapsed time derived
from run-log timestamps, SHALL append timeline events without a full page reload,
SHALL open per-stage artifact lists in the P10 read-only modal, SHALL insert
`compliance` between `report` and `ship` in `FEATURE_DELIVERY_STAGE_ORDER`, and
SHALL surface retry, model-escalation, and deferral telemetry from
`run.log.jsonl` on the timeline and active stage cell.

## Acceptance criteria

### Live polling

- When `PipelineModule` mounts and `GET /api/run-state` returns at least one
  task whose pipeline status is non-terminal, the module SHALL start a polling
  interval between 5 seconds and 10 seconds inclusive.
- When every returned task is terminal or has no active stage cell, the module
  SHALL stop the polling interval.
- When a polling tick completes, the module SHALL merge the new envelope into
  React state without remounting `DashboardPage` or reloading the browser tab.
- When a polling tick fails, the module SHALL retain the prior task snapshot and
  SHALL surface the existing inline error affordance with retry.

### Running-stage indicator

- When a stage cell status is `active`, the cell SHALL render a visible pulse
  treatment on the status badge per command-center stage-active tokens.
- When a stage cell status is `active`, the cell SHALL display elapsed time
  since the newest `run.log.jsonl` record whose `pancreator.stage_id` matches
  the active stage name.
- When no matching run-log timestamp exists for the active stage, the cell
  SHALL omit elapsed time rather than render a misleading zero value.

### Run-event timeline merge

- When polling returns a task whose `runEvents` array grew since the prior tick,
  `RunEventTimeline` SHALL append only the new events in reverse-chronological
  order without discarding prior rendered events.
- When an operator watches an active SDK run fixture, the timeline SHALL show
  new entries before manual browser refresh.

### Stage artifact drawer

- When an operator activates a stage cell whose status is not `pending`, the
  Pipeline module SHALL open an `ArtifactDrawer` slide-over for that stage.
- When the drawer renders for a stage name, the drawer SHALL list every
  `requiredAfterStageWork` path from `stageArtifactContract` for that stage and
  the task `featureId` recorded in run state.
- When an operator activates an artifact row that exists on disk, the UI SHALL
  open the artifact in the existing Files tab modal with read-only default per
  P10.
- When an operator activates an artifact row that is missing on disk, the row
  SHALL render disabled with an explicit missing label.

### Stage order fix

- When `FEATURE_DELIVERY_STAGE_ORDER` exports the feature-delivery stage list,
  the list SHALL include `compliance` immediately after `report` and before
  `ship`.
- When the stage grid renders for a dogfood fixture, the grid SHALL show 10
  stage cells covering intake through index plus the terminal `complete` cell.
- When `client/src/app/page.test.tsx` asserts stage-cell test ids, the tests
  SHALL include `stage-cell-compliance`.

### Escalation and retry telemetry

- When `run.log.jsonl` contains a record with `name` equal to
  `cursor.runner.escalation`, the timeline SHALL render that record with an
  escalation badge derived from `attributes.escalation`.
- When `run.log.jsonl` contains a `pancreator.pipeline.advance` record whose
  transition `event` is `must_fix`, `qa_fails`, `qa_fails_plan_invalidating`,
  `compliance_fails`, or `compliance_fails_plan_invalidating`, the timeline
  SHALL render that record with a retry badge.
- When `run.log.jsonl` contains a record whose `status.message` includes
  `deferred` or whose `attributes` include a deferral code, the timeline SHALL
  render that record with a deferral badge.
- When the active stage cell has matching escalation or retry records in the
  selected task run log, the cell SHALL show a compact telemetry chip naming the
  newest matching event.

### Regression and safety

- When the test suite runs, existing P9 stage-grid, timeline, Next Action, and
  human-gate tests SHALL pass or SHALL gain equivalent coverage after this
  Feature lands.
- When an operator opens a drawer artifact in the Files modal, the modal SHALL
  keep `data-testid="readonly-indicator"` visible by default and SHALL enforce
  the P10 write guard on pipeline-owned paths.

## Out of scope

- Server-sent events or websocket streaming of SDK progress; polling is the
  minimum delivery path per source directive.
- Active-memory orientation, inbox triage panel, and multi-run table UX; the
  `command-center-pipeline-orientation` inbox item owns those surfaces per source
  directive.
- `POST /api/execute` or any mutating run-control API.
- Changes to `lib/internal/packages/@pancreator/cli/` run-log schema, persona
  specs, or `state.json` persistence format.
- Automations and Maintenance module implementation beyond placeholders already
  shipped by the command-center Feature.

## Open questions

_(none — directive, ratified ux-spec, and shipped command-center dependency supply sufficient scope for plan-stage delegation)_
