---
title: Cockpit v2 automation registry and management UI Engineering Spec
feature_id: cockpit-v2-automation-registry-and-management-ui
task_id: 47315_1051_cockpit-v2-automation-registry-and-management-ui
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
depends_on: [cockpit-v2-ux-spec-and-information-architecture]
blocks: [cockpit-v2-automations-scheduler]
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines schema v1, validation primitive, CRUD API, Cockpit UI outcomes, four acceptance checks, explicit out-of-scope boundaries, a touch set, and a ratified ux-spec dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates registry schema, validation package, CRUD API, and Cockpit Automations module outcomes with machine-checkable acceptance criteria.
  - The backend decision is Pancreator-native registry under `.pan/automations/` plus a new `@pancreator/scheduler` primitive; Cursor Automations integration remains out of scope per the directive.
  - The canonical ux-spec authority path is lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md rather than the program shorthand cockpit-v2-ux-spec cited in the directive depends_on field.
  - Run history population and Run now execution remain stubbed or disabled in this Feature; cockpit-v2-automations-scheduler owns tick execution and run-log append per the directive Out of scope section.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [24, 27]
    note: Source directive Problem section states missing operator surface for recurring agent automations.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [28, 31]
    note: Source directive Goal section names Pancreator-native registry, validation, CRUD API, and Cockpit UI.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [32, 38]
    note: Source directive Required outcomes enumerate schema v1, validation, CRUD API, and Cockpit UI.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [39, 45]
    note: Source directive Acceptance criteria anchor hourly creation, disabled filtering, validation errors, and persona dropdown.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [46, 51]
    note: Source directive Out of scope excludes scheduler tick, LangGraph wiring, Cursor import, and in-app daemon.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54351_0854_cockpit-v2-automations-registry.md
    range: [59, 65]
    note: Source directive Touch set lists automations directory, scheduler package, API route, and cockpit components.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [138, 141]
    note: Ratified Automations module list actions, status badges, wizard stepper, and run-history layout.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [176, 178]
    note: Ratified component inventory under client/src/components/cockpit/automations/.
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [351, 358]
    note: Control Plane Scheduler primitive and @pancreator package naming conventions.
  - kind: lines
    path: lib/personas/design-engineer.md
    range: [72, 100]
    note: design-engineer Automations module UX authority when design_steps is enabled.
  - kind: lines
    path: lib/internal/packages/@pancreator/intervention/src/paths.ts
    range: [10, 45]
    note: Prior-art path-guard pattern for `.pan/scheduler/` that automations registry SHALL mirror under `.pan/automations/`.
  - kind: lines
    path: client/src/components/cockpit/layout/CockpitShell.tsx
    range: [80, 84]
    note: Current Automations module placeholder that this Feature SHALL replace with AutomationsModule.
  - kind: lines
    path: AGENTS.md
    range: [182, 187]
    note: Materialize documented `.pan/` directories on demand with `.gitkeep` when Git tracks the path.
---

# Spec

This Feature SHALL deliver a Pancreator-native automation registry and Cockpit
Automations management UI so operators create and edit recurring agent work
without OS cron or ad-hoc scripts. M4 LangGraph scheduler wiring is deferred.
The Feature SHALL define schema v1 YAML under `.pan/automations/`, SHALL ship a
new `@pancreator/scheduler` primitive for validation and registry I/O with path
guards, SHALL expose CRUD routes at `/api/automations`, and SHALL replace the
`CockpitShell` Automations placeholder with list and create/edit wizard surfaces
per the ratified ux-spec. Tick execution, run-history population, and Run now
invocation remain out of scope for `cockpit-v2-automations-scheduler`.

## Acceptance criteria

### Schema v1 and registry storage

- When an operator saves an automation, the registry SHALL persist one YAML file
  at `.pan/automations/<id>.yaml` with fields `schemaVersion`, `id`, `name`,
  `enabled`, `schedule`, `trigger`, and `policy`.
- When `schemaVersion` is `1`, `schedule` SHALL be a 5-field cron string and
  `policy` SHALL include numeric `maxConcurrent` and `timeoutMinutes` fields.
- When `trigger.kind` is `agent`, `trigger` SHALL include `persona` (slug matching
  a file under `lib/personas/*.md`) and `prompt` (non-empty string).
- When `trigger.kind` is `pan`, `trigger` SHALL include `subcommand` (non-empty
  string naming a `pan` CLI invocation fragment).
- When the repository lacks `.pan/automations/`, the Feature SHALL materialize
  the directory on first read or write per AGENTS.md materialize-on-demand rule.

### Validation primitive

- When `@pancreator/scheduler` reads or writes an automation file, the primitive
  SHALL validate the document against schema v1 and SHALL reject invalid YAML
  with actionable error messages naming the failing field path.
- When `@pancreator/scheduler` resolves a file path, the primitive SHALL reject
  identifiers or paths that escape `repoRoot/.pan/automations/` using the same
  guard discipline as `@pancreator/intervention` paths for `.pan/scheduler/`.
- When `@pancreator/scheduler` lists automations for due evaluation, the primitive
  SHALL exclude records where `enabled` is `false` so downstream scheduler work
  can filter disabled entries without reimplementing registry reads.

### CRUD API

- When `GET /api/automations` executes, the route SHALL return a JSON array of
  validated automation summaries sourced from `.pan/automations/`.
- When `POST /api/automations` receives a valid create payload, the route SHALL
  write a new YAML file and SHALL return the created record with HTTP 201.
- When `PUT /api/automations` receives a valid update payload for an existing
  `id`, the route SHALL overwrite the matching YAML file and SHALL return the
  updated record.
- When `DELETE /api/automations` targets an existing `id`, the route SHALL
  remove the matching YAML file and SHALL return HTTP 204.
- When any CRUD handler receives an invalid payload or unsafe `id`, the route
  SHALL return HTTP 400 with a JSON `errors` array of field-scoped messages.

### Cockpit Automations module

- When an operator opens the Automations module tab, `CockpitShell` SHALL render
  `AutomationsModule` instead of the current placeholder empty state.
- When the list view renders, each row SHALL show automation `name`, a
  human-readable `schedule` label, and an `enabled` toggle bound to the registry
  `enabled` field via the CRUD API.
- When an operator starts create or edit, the wizard SHALL present four linear
  steps in order: Schedule, Persona, Prompt, and Review per the ratified ux-spec.
- When the Schedule step renders, the wizard SHALL offer cron presets including
  an hourly option plus a custom cron input.
- When the Persona step renders, the persona dropdown SHALL list every persona
  slug discovered from `lib/personas/*.md` excluding `rules/` and `skills/`
  subdirectories.
- When the Prompt step renders, the wizard SHALL provide a multiline prompt
  editor for `trigger.kind: agent` automations.
- When the Review step renders, the wizard SHALL display a read-only summary and
  SHALL persist the automation on confirm.
- When list row secondary actions from the ux-spec are present, Run now SHALL
  render disabled with helper text citing the scheduler Feature, and the run-
  history panel SHALL render an empty state until scheduler execution ships.

### Tests and integration

- When the test suite runs, `@pancreator/scheduler` package tests SHALL cover
  schema validation success and failure cases including disabled-record filtering.
- When the test suite runs, API route tests SHALL cover create, list, update,
  delete, and validation-error responses.
- When an operator creates an hourly agent automation through the Cockpit UI,
  the saved YAML file SHALL exist under `.pan/automations/` with `enabled: true`
  and a cron schedule matching the hourly preset.

## Out of scope

- Scheduler tick execution, due-run dispatch, and run-log append; the
  `cockpit-v2-automations-scheduler` inbox item owns those capabilities per
  source directive.
- LangGraph StateGraph wiring and M4 scheduler integration per source directive.
- Cursor Automations import, export, or product API coupling per source directive.
- In-app daemon or background process hosting per source directive.
- Maintenance module implementation beyond the existing `CockpitShell` placeholder.
- Pipeline module changes beyond wiring `AutomationsModule` into `CockpitShell`.
- Modifying `lib/personas/*.md` persona specs; the dropdown reads existing files
  only.
- Replacing OS cron for non-Pancreator workloads outside the registry surface.

## Open questions

_(none — directive and ratified ux-spec supply sufficient scope for plan-stage delegation)_
