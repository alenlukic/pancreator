---
title: Cockpit v2 active memory, inbox triage, and multi-run view Engineering Spec
feature_id: cockpit-v2-active-memory-inbox-triage-multi-run-view
task_id: 49726_1011_cockpit-v2-active-memory-inbox-triage-multi-run-view
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
depends_on: [cockpit-v2-live-run-refresh-and-stage-artifact-drawer]
blocks: [cockpit-v2-maintenance-toolkit]
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines four required outcomes, five acceptance checks, explicit out-of-scope boundaries, a touch set, and a ratified ux-spec dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates active-memory header, inbox triage, multi-run table, and guarded execute API outcomes with machine-checkable acceptance criteria.
  - The directive dependency shorthand cockpit-v2-pipeline-live-artifacts maps to the canonical Feature id cockpit-v2-live-run-refresh-and-stage-artifact-drawer.
  - The directive touch-set component InboxTriage.tsx maps to ux-spec inventory name InboxTriagePanel; ActiveMemoryHeader.tsx and MultiRunTable.tsx are net-new sidebar surfaces.
  - The execute allowlist includes pan batch status per the directive; the CLI currently exposes only pan batch run, so plan stage SHALL implement batch status as a read-only ledger query or defer with a clear operator message until the subcommand ships.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
    range: [24, 27]
    note: Source directive Problem section states operators leave the cockpit for current.md, inbox paths, and multi-run monitoring.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
    range: [28, 37]
    note: Source directive Goal and Required outcomes enumerate orientation surfaces and guarded execute API.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
    range: [39, 45]
    note: Source directive Acceptance criteria anchor inbox listing, multi-run sort, active memory, execute allowlist, and confirmation modal.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
    range: [47, 51]
    note: Source directive Out of scope excludes SSE streaming, Automations or Maintenance modules, and inbox archival.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md
    range: [59, 66]
    note: Source directive Touch set lists three API routes and three Pipeline sidebar components.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [77, 94]
    note: Ratified Pipeline wireframe places inbox triage and multi-run table in the right sidebar above config.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [128, 136]
    note: Ratified Pipeline interaction requirements for inbox triage, multi-run table, and row-driven grid selection.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [168, 183]
    note: Ratified component inventory under client/src/components/cockpit/pipeline/.
  - kind: lines
    path: lib/memory/features/cockpit-v2-live-run-refresh-and-stage-artifact-drawer/spec.md
    range: [95, 107]
    note: Shipped live-artifacts Feature establishes polling and drawer behavior this Feature extends with orientation surfaces.
  - kind: lines
    path: lib/memory/features/cockpit-v2-pipeline-command-center-and-human-gate-queue/spec.md
    range: [90, 101]
    note: Shipped command-center Feature establishes CockpitShell, Pipeline module, and run-state field split.
  - kind: lines
    path: lib/memory/active/current.md
    range: [36, 62]
    note: Active memory strip content source for Active Feature, blockers, and refresh timestamp display.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [75, 83]
    note: Inbox list MUST exclude lib/inbox/notes/ from operator-facing triage.
  - kind: lines
    path: lib/memory/handbook/pancreator-config.md
    range: [90, 92]
    note: CLI invocation prefix pnpm -w exec pan for copy-command strings.
  - kind: lines
    path: OPERATION.md
    range: [405, 416]
    note: Stage advance command patterns that execute API allowlist MUST preserve.
  - kind: lines
    path: client/src/components/cockpit/pipeline/PipelineModule.tsx
    range: [232, 268]
    note: Current Pipeline sidebar renders ConfigReadOnlyPanel only; this Feature SHALL add orientation components above config.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [42, 52]
    note: TaskRunStateEnvelope fields for multi-run table stage, gate, and runEvents timestamps.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/run.ts
    range: [365, 422]
    note: Existing pan batch run subcommand; batch status allowlist entry requires plan-stage mapping.
---

# Spec

This Feature SHALL deliver Cockpit v2 orientation surfaces so operators monitor
active memory, triage inbox directives, prioritize concurrent feature-delivery
runs, and invoke allowlisted `pan` commands without leaving the Pipeline module.
Operators today read `lib/memory/active/current.md` manually, browse
`lib/inbox/in/` paths in the filesystem, and lack a compact multi-run view when
batch feature-delivery runs increase monitoring load. The Feature SHALL add
`GET /api/active-memory`, `GET /api/inbox`, and `POST /api/execute` routes,
SHALL render an active-memory header, inbox triage list, and multi-run table in
the Pipeline sidebar per the ratified ux-spec, and SHALL require explicit
confirmation before mutating execute actions.

## Acceptance criteria

### Active memory header

- When the Pipeline module renders, the active-memory header SHALL load data from
  `GET /api/active-memory`.
- When `GET /api/active-memory` executes, the route SHALL parse
  `lib/memory/active/current.md` from the repository root and SHALL return the
  Active Feature inbox path, the Risks and blockers section body, and the
  operator-notes refresh timestamp when present.
- When the active-memory header renders, the header SHALL display the Active
  Feature path, a compact blockers summary, and the refresh timestamp.
- When the operator activates the refresh-procedure link, the UI SHALL open
  `OPERATION.md` or `AGENTS.md` guidance for
  `pnpm -w exec pan refresh-active-memory` in the Files tab modal.
- When an operator runs `pnpm -w exec pan refresh-active-memory` and reloads the
  dashboard, the active-memory header SHALL match the updated `current.md`
  content without a server restart.

### Inbox triage

- When the Pipeline module renders, the inbox triage panel SHALL load entries
  from `GET /api/inbox`.
- When `GET /api/inbox` executes, the route SHALL enumerate every Markdown file
  under `lib/inbox/in/**` and SHALL exclude every path under
  `lib/inbox/notes/**`.
- When an inbox entry renders, the row SHALL show the directive title, a slug
  derived from the filename, and age in whole hours since file mtime.
- When the operator activates Copy path, the UI SHALL copy the full inbox path
  relative to the repository root.
- When the operator activates Copy run command, the UI SHALL copy
  `pnpm -w exec pan run feature-delivery <inbox-entry>` where `<inbox-entry>`
  is the path relative to `lib/inbox/in/`.
- When the operator activates Open in Files, the UI SHALL navigate the Files tab
  to the inbox entry path per the ux-spec inbox triage deep-link pattern.

### Multi-run table

- When `GET /api/run-state` returns more than one non-terminal task, the Pipeline
  module SHALL render a compact multi-run table above the stage grid.
- When the multi-run table renders a row, the row SHALL show task label, active
  stage name, human-gate badge when any stage carries `humanGate` equal to
  `human_approval` with status `active`, and last event time from the newest
  `runEvents` timestamp for that task.
- When the operator sorts the multi-run table by last event time, rows with newer
  timestamps SHALL appear before older timestamps.
- When the operator sorts the multi-run table by human gate, rows with an active
  `human_approval` gate SHALL appear before rows without one.
- When the operator expands a multi-run row, the expanded section SHALL render
  the full stage grid for that task without changing the selected task used by
  the timeline and artifact drawer.
- When the operator selects a multi-run row, the Pipeline module SHALL set the
  selected task for `StageMachineGrid`, `RunEventTimeline`, and `ArtifactDrawer`
  per the ux-spec row-driven selection contract.
- When `GET /api/run-state` returns one or zero non-terminal tasks, the module
  SHALL omit the multi-run table and SHALL keep single-run selection behavior.

### Guarded execute API

- When `POST /api/execute` receives a body whose `command` field starts with an
  allowlisted verb, the route SHALL spawn a subprocess with working directory at
  the repository root using `pnpm -w exec pan <args>`.
- When `POST /api/execute` receives a command outside the allowlist
  (`advance`, `pause`, `resume`, `abort`, `check`, `batch status`), the route
  SHALL respond with HTTP 400 and a clear rejection message naming the verb.
- When the operator invokes a mutating execute action (`advance`, `pause`,
  `resume`, `abort`), the UI SHALL open a confirmation modal before calling
  `POST /api/execute`.
- When the operator confirms a mutating execute action, the UI SHALL call
  `POST /api/execute` and SHALL display stdout, stderr, and exit code in a
  monospace result panel.
- When the operator invokes a read-adjacent execute action (`check`, `batch
  status`), the UI MAY call `POST /api/execute` without a confirmation modal.
- When `POST /api/execute` completes, the Pipeline module SHALL trigger a run-state
  refresh so multi-run and stage surfaces reflect the command outcome.

### Pipeline integration and regression

- When implement stage completes, `PipelineModule` SHALL render
  `ActiveMemoryHeader`, `InboxTriage`, and `MultiRunTable` in the right sidebar
  above `ConfigReadOnlyPanel`.
- When the test suite runs, new route tests for `/api/active-memory`, `/api/inbox`,
  and `/api/execute` SHALL pass.
- When the test suite runs with two or more fixture runs, multi-run sort tests
  SHALL verify last-event and human-gate ordering.
- When an operator opens a P10 guarded artifact from Files tab actions, the Files
  modal SHALL remain read-only by default and SHALL enforce the P10 write guard.

## Out of scope

- Server-sent events or websocket streaming of SDK progress; optional stretch
  only per source directive.
- Automations and Maintenance module implementation beyond placeholders already
  shipped by prior Cockpit v2 Features.
- Inbox archival, `pan intake` from the cockpit, or writes to `lib/inbox/out/`.
- `POST /api/execute` commands outside the directive allowlist, including
  `pan run`, `pan batch run`, `git` verbs, and shell metacharacters.
- Changes to `lib/internal/packages/@pancreator/cli/` command semantics, persona
  specs, `state.json` schema, or `run.log.jsonl` schema.
- Pre-close validation button placement; the `cockpit-v2-maintenance-toolkit`
  inbox item owns Maintenance module entry points per source directive.

## Open questions

_(none — directive, ratified ux-spec, and shipped live-artifacts dependency supply sufficient scope for plan-stage delegation)_
