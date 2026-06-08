---
title: Cockpit v2 local scheduler tick and run history Engineering Spec
feature_id: cockpit-v2-local-scheduler-tick-and-run-history
task_id: 31248_1519_cockpit-v2-local-scheduler-tick-and-run-history
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
depends_on: [cockpit-v2-automation-registry-and-management-ui]
blocks: []
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines CLI tick behavior, JSONL run history, Cockpit Run now and run-history UI outcomes, intervention compatibility, OPERATION.md OS scheduling guidance, four acceptance checks, explicit out-of-scope boundaries, a touch set, and a ratified registry dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates tick dispatch, run-log append, Cockpit execution surfaces, and external scheduler documentation with machine-checkable acceptance criteria.
  - The canonical CLI subcommand is `pnpm -w exec pan scheduler tick`; the alternate `pan automations run-due` name from the directive is deferred to avoid duplicate entry points.
  - The canonical registry dependency slug is `cockpit-v2-automation-registry-and-management-ui` rather than the program shorthand `cockpit-v2-automations-registry` cited in the directive depends_on field.
  - The Cockpit run-history component path is `AutomationRunHistory.tsx` per the ratified ux-spec component inventory, not the `RunHistory.tsx` shorthand in the directive touch set.
  - Run now from Cockpit SHALL invoke tick for one automation id through a dedicated API route rather than shelling out from the browser.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [24, 27]
    note: Source directive Problem section states automations without execution and history are incomplete.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [28, 31]
    note: Source directive Goal section names tick CLI, JSONL run history, Cockpit UI, and OPERATION.md OS scheduling guidance.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [32, 38]
    note: Source directive Required outcomes enumerate CLI subcommand, run history, Cockpit UI, intervention compatibility, and documentation.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [40, 45]
    note: Source directive Acceptance criteria anchor due execution, Cockpit history visibility, concurrency lock, and OPERATION.md external scheduler setup.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [47, 51]
    note: Source directive Out of scope excludes LangGraph daemon, cloud scheduler, and Cursor Automations bridge.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-scheduler.md
    range: [57, 65]
    note: Source directive Touch set lists CLI run module, scheduler package, run-log directory, Cockpit components, optional run API route, and OPERATION.md.
  - kind: lines
    path: lib/memory/features/cockpit-v2-automation-registry-and-management-ui/spec.md
    range: [169, 176]
    note: Registry Feature defers tick execution, run-log append, and Run now to this scheduler Feature.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [138, 141]
    note: Ratified Automations module lists Run now row action and chronological expandable run history.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [176, 178]
    note: Ratified component inventory names AutomationRunHistory under client/src/components/cockpit/automations/.
  - kind: lines
    path: lib/internal/packages/@pancreator/scheduler/src/registry.ts
    range: [69, 73]
    note: Prior-art listDueAutomations filters enabled registry records for downstream tick evaluation.
  - kind: lines
    path: lib/internal/packages/@pancreator/scheduler/src/schema.ts
    range: [3, 28]
    note: Prior-art trigger kinds agent and pan plus policy.maxConcurrent bound tick dispatch behavior.
  - kind: lines
    path: lib/internal/packages/@pancreator/intervention/src/paths.ts
    range: [10, 33]
    note: Prior-art intervention journal under .pan/scheduler/interventions for pause and abort compatibility.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    range: [260, 269]
    note: Prior-art CursorRunner factory for agent trigger execution in sdk invocation mode.
  - kind: lines
    path: client/src/components/cockpit/automations/AutomationListView.tsx
    range: [113, 127]
    note: Current Run now control is disabled pending this Feature.
  - kind: lines
    path: client/src/components/cockpit/automations/AutomationRunHistory.tsx
    range: [3, 10]
    note: Current run-history panel renders empty state until scheduler execution ships.
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [351, 355]
    note: Control Plane Scheduler primitive naming and orchestration role.
  - kind: lines
    path: AGENTS.md
    range: [182, 187]
    note: Materialize documented .pan directories on demand with .gitkeep when Git tracks the path.
---

# Spec

This Feature SHALL deliver local automation execution and append-only run history
so operators trigger recurring agent work on demand or through an OS scheduler
without an in-app daemon. The Feature SHALL extend `@pancreator/scheduler` with
due evaluation, concurrency locking under `.pan/scheduler/`, and JSONL run-log
I/O; SHALL add `pnpm -w exec pan scheduler tick` to the CLI; SHALL wire Cockpit
Run now and the `AutomationRunHistory` sidebar to those primitives; and SHALL
document cron and launchd one-liner invocation in `OPERATION.md`. LangGraph
scheduler daemons, cloud schedulers, and Cursor Automations bridges remain out
of scope per the source directive.

## Acceptance criteria

### CLI scheduler tick

- When an operator runs `pnpm -w exec pan scheduler tick` with no `--id` flag,
  the CLI SHALL evaluate every enabled automation from `.pan/automations/` whose
  5-field cron schedule is due since the last recorded run in
  `.pan/scheduler/runs/<automation-id>.jsonl` and SHALL dispatch each due
  automation once per invocation.
- When an operator runs `pnpm -w exec pan scheduler tick --id <automation-id>`,
  the CLI SHALL dispatch that automation immediately regardless of cron due
  state and SHALL record `trigger: manual` on the appended run-log line.
- When `trigger.kind` is `agent`, tick dispatch SHALL invoke `CursorRunner` with
  the configured `persona` and `prompt` from the automation record.
- When `trigger.kind` is `pan`, tick dispatch SHALL execute
  `pnpm -w exec pan <subcommand>` using the configured `trigger.subcommand`
  string without shell interpolation beyond the declared subcommand fragment.
- When tick dispatch completes, the CLI SHALL exit with code 0 if every
  attempted dispatch succeeds and SHALL exit with a non-zero code if any
  attempted dispatch fails after recording the failure in run history.

### Run history and concurrency lock

- When tick or manual dispatch starts an automation run, the scheduler SHALL
  append one JSONL record to `.pan/scheduler/runs/<automation-id>.jsonl` with
  fields `runId`, `startedAt`, `finishedAt`, `status`, `trigger`, `stdoutSummary`,
  `stderrSummary`, and optional `taskId`.
- When an automation already holds active runs equal to
  `policy.maxConcurrent`, tick dispatch SHALL skip that automation and SHALL
  append or update a run-log record with `status: skipped` naming the lock reason.
- When the repository lacks `.pan/scheduler/runs/`, the Feature SHALL
  materialize the directory on first write per AGENTS.md materialize-on-demand
  rule.
- When the scheduler maintains concurrency state, the Feature SHALL persist
  lock metadata under `.pan/scheduler/` and SHALL release the lock when the run
  record reaches a terminal `status` of `success`, `error`, or `aborted`.
- When `@pancreator/scheduler` resolves a run-log or lock path, the primitive
  SHALL reject identifiers or paths that escape `repoRoot/.pan/scheduler/` using
  the same guard discipline as `@pancreator/intervention` paths.

### Intervention compatibility

- When tick dispatch for an `agent` trigger yields a `taskId`, the Feature SHALL
  write intervention journal entries under
  `.pan/scheduler/interventions/<task-id>.jsonl` so existing `pan pause`,
  `pan resume`, and `pan abort` commands apply without schema changes.
- When an operator aborts a running automation through the intervention CLI,
  the scheduler SHALL update the matching run-log record to `status: aborted`.

### Cockpit Run now and run history UI

- When an operator clicks Run now on an automation row, `AutomationListView`
  SHALL call `POST /api/automations/<id>/run` and SHALL refresh run history on
  success instead of rendering the disabled helper state.
- When `GET /api/automations/<id>/runs` executes, the route SHALL return run-log
  records for that automation in reverse chronological order sourced from
  `.pan/scheduler/runs/<automation-id>.jsonl`.
- When `AutomationRunHistory` renders with a selected automation, the panel
  SHALL list run records chronologically with expandable stdout and stderr
  summary excerpts per the ratified ux-spec.
- When no automation is selected or no runs exist, `AutomationRunHistory` SHALL
  render an empty state that distinguishes "no selection" from "no runs yet".

### Documentation and tests

- When an operator reads `OPERATION.md`, the operator SHALL find a section that
  documents one-line cron and launchd examples invoking
  `pnpm -w exec pan scheduler tick` from the repository root.
- When the test suite runs, CLI tests SHALL cover due tick dispatch, manual
  `--id` dispatch, skipped dispatch under `maxConcurrent`, and run-log append.
- When the test suite runs, `@pancreator/scheduler` package tests SHALL cover
  due evaluation, lock acquire and release, and run-log path guards.
- When an operator runs `pnpm -w exec pan scheduler tick` against an enabled
  hourly automation whose schedule is due, a new run-log line SHALL appear in
  `.pan/scheduler/runs/<automation-id>.jsonl` and the Cockpit run-history panel
  SHALL display that run after refresh.

## Out of scope

- LangGraph StateGraph scheduler daemon and M4 in-app background process per
  source directive.
- Cloud-hosted scheduler products and remote cron services per source directive.
- Cursor Automations import, export, or product API coupling per source directive.
- Automation registry schema, CRUD API, and wizard UI; the
  `cockpit-v2-automation-registry-and-management-ui` Feature owns those surfaces.
- Replacing OS cron or launchd with an always-on Pancreator daemon in Cockpit v2.
- Maintenance module changes beyond any shared Cockpit styling tokens already
  used by Automations components.
- Modifying `lib/personas/*.md` persona specs; tick reads existing persona slugs
  from registry records only.

## Open questions

_(none — directive, ratified ux-spec, and shipped registry Feature supply sufficient scope for plan-stage delegation)_
