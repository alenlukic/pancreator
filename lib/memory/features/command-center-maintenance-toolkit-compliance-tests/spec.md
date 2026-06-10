---
title: Command Center Maintenance toolkit (compliance and tests) Engineering Spec
feature_id: command-center-maintenance-toolkit-compliance-tests
task_id: 27260_1625_command-center-maintenance-toolkit-compliance-tests
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
depends_on: [command-center-pipeline-orientation]
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines four required outcomes, four acceptance checks, explicit out-of-scope boundaries, a touch set, and a ratified ux-spec dependency without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates compliance panel, test runner, pre-close preset, and shared OutputStream outcomes with machine-checkable acceptance criteria.
  - The directive dependency shorthand command-center-pipeline-orientation maps to shipped Feature ids command-center-active-memory-inbox-triage-multi-run-view and command-center-pipeline-command-center-and-human-gate-queue for guarded execute API patterns and Pipeline module placement.
  - The directive inbox feature_id command-center-maintenance-toolkit differs from the assigned Feature id command-center-maintenance-toolkit-compliance-tests; this spec uses the task-assigned id.
  - Index-adjacent pre-close eligibility resolves to feature-delivery stages ship and index immediately before complete per the directive pre-close preset wording.
  - The ux-spec component name StreamedOutputViewer maps to the directive touch-set name OutputStream.tsx under client/src/components/command-center/shared/.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [28, 31]
    note: Source directive Problem section states terminal-only compliance and test runs with no Command Center surface.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [32, 34]
    note: Source directive Goal section names Maintenance module with compliance, test runner, and pre-close preset.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [36, 42]
    note: Source directive Required outcomes enumerate compliance API, test API, pre-close preset, and OutputStream.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [43, 48]
    note: Source directive Acceptance criteria anchor run-all compliance, Vitest streaming, index-adjacent pre-close, and exit-code surfacing.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [50, 54]
    note: Source directive Out of scope excludes scheduled cadence, CI integration, and token economy UI.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54350_0854_command-center-maintenance-toolkit.md
    range: [60, 67]
    note: Source directive Touch set lists API routes, maintenance components, OutputStream, route tests, and optional run history directory.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [142, 144]
    note: Ratified Maintenance module compliance audit, test presets, streamed output, and pre-close CTA layout.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [179, 180]
    note: Ratified component inventory under client/src/components/command-center/maintenance/ and shared StreamedOutputViewer.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/spec.md
    range: [129, 133]
    note: Engineering Spec Maintenance module UX acceptance for compliance panel, test picker, output viewer, and pre-close entry.
  - kind: lines
    path: lib/internal/tools/run-compliance.mjs
    range: [1, 36]
    note: Compliance runner CLI that POST /api/compliance-run SHALL wrap with descriptor discovery and severity routing.
  - kind: lines
    path: lib/memory/handbook/compliance-runs.md
    range: [31, 51]
    note: Compliance descriptor model, trigger modes, and operator-on-demand invocation authority.
  - kind: lines
    path: lib/memory/features/compliance-tests/audit-history.json
    range: [1, 16]
    note: Audit history ledger that compliance results viewer SHALL link for prior run context.
  - kind: lines
    path: OPERATION.md
    range: [505, 526]
    note: Pre-close validation checklist that pre-close preset UI SHALL mirror for named checks.
  - kind: lines
    path: client/src/components/command-center/layout/DashboardModuleShell.tsx
    range: [82, 86]
    note: Current Maintenance module placeholder that this Feature SHALL replace with MaintenanceModule.
  - kind: lines
    path: client/src/app/api/execute/route.ts
    range: [1, 27]
    note: Prior-art guarded subprocess API pattern for allowlisted pan commands that maintenance routes SHALL mirror for subprocess safety.
  - kind: lines
    path: client/src/services/pan-execute.ts
    range: [11, 18]
    note: Allowlisted verb pattern that maintenance subprocess wrappers SHALL extend with read-only test and compliance verbs only.
  - kind: lines
    path: lib/memory/features/command-center-active-memory-inbox-triage-multi-run-view/spec.md
    range: [14, 14]
    note: Shipped pipeline-orientation Feature blocks command-center-maintenance-toolkit per program dependency chain.
  - kind: lines
    path: AGENTS.md
    range: [182, 187]
    note: Materialize documented .pan/ directories on demand with .gitkeep when Git tracks the path.
---

# Spec

This Feature SHALL deliver the Command Center Maintenance module so operators run
compliance audits, repository test suites, and pre-close validation from the
dashboard instead of pasting terminal output into chat. The shipped Command Center
shows a Maintenance tab placeholder and exposes no compliance or test runner
surface despite UX recommendation P15. The Feature SHALL wrap
`lib/internal/tools/run-compliance.mjs` behind `POST /api/compliance-run`,
SHALL stream subprocess output for `POST /api/test-run` suite presets, SHALL
add a Pipeline module pre-close preset for index-adjacent tasks, and SHALL
extract a shared `OutputStream` component per the ratified ux-spec Maintenance
module inventory.

## Acceptance criteria

### Compliance audit panel

- When an operator opens the Maintenance module, the compliance audit panel
  SHALL list every descriptor file under `tests/compliance/*.yaml` with id,
  severity badge (`high`, `medium`, `low`), and trigger-mode labels parsed from
  each descriptor.
- When `POST /api/compliance-run` executes without a descriptor filter, the
  route SHALL invoke the same logic as
  `node lib/internal/tools/run-compliance.mjs` and SHALL return a structured
  JSON report with one result row per descriptor including pass or fail status
  and findings detail text.
- When `POST /api/compliance-run` executes with a single descriptor id, the
  route SHALL run only that descriptor and SHALL return the same structured
  report shape as run-all.
- When run-all compliance completes in the UI, the results viewer SHALL render
  per-descriptor pass or fail rows and SHALL expose expandable findings detail
  for failed descriptors.
- When compliance results render, the panel SHALL link to
  `lib/memory/features/compliance-tests/audit-history.json` for prior audit
  context.
- When any descriptor fails with `high` severity findings, the UI SHALL surface
  a non-zero exit indicator without requiring the operator to paste terminal
  output.

### Test runner and streaming output

- When `POST /api/test-run` receives `{ "suite": "client" }`, the route SHALL
  spawn the client Vitest command and SHALL stream stdout and stderr to the
  browser via Server-Sent Events or an equivalent chunked response.
- When `POST /api/test-run` receives `{ "suite": "compliance" }`, the route
  SHALL run `node lib/internal/tools/run-compliance.mjs` and SHALL stream
  combined output to the browser.
- When `POST /api/test-run` receives `{ "suite": "repo-structure" }`, the route
  SHALL run `node lib/internal/tools/check-phase-0a-scaffold.mjs` followed by
  `node --test tests/*.test.mjs` and SHALL stream combined output.
- When `POST /api/test-run` receives `{ "suite": "pan-check" }`, the route
  SHALL run `pnpm -w exec pan check` and SHALL stream combined output.
- When the client suite streams in the UI, the Maintenance test runner SHALL
  display live Vitest output in a monospace auto-scrolling viewer with copy
  selection per the ux-spec streamed-output pattern.
- When a test run subprocess exits with a non-zero code, the UI SHALL display
  the exit code prominently and SHALL retain the streamed log in session-scoped
  result history.
- When session-scoped history is implemented, the Feature MAY persist run
  metadata under `.pan/maintenance/runs/` without requiring durable cross-session
  storage in the first slice.

### Shared OutputStream component

- When compliance or test panels render subprocess output, both panels SHALL
  compose `client/src/components/command-center/shared/OutputStream.tsx` for monospace
  log rendering, auto-scroll behavior, and copy selection.
- When `OutputStream` receives new log lines, the component SHALL append lines
  without clearing prior output until the operator starts a new run.
- When a run completes, `OutputStream` SHALL expose the subprocess exit code
  in an `aria-live="polite"` status region.

### Pre-close validation preset

- When an operator selects a task whose `currentStage` is `ship` or `index`, the
  Pipeline module SHALL render an enabled pre-close validation control.
- When an operator selects a task whose `currentStage` is `complete` or any
  stage before `ship`, the Pipeline module SHALL render the pre-close control
  disabled with helper text stating index-adjacent eligibility requirements.
- When the operator activates the pre-close preset, the UI SHALL run
  `pnpm -w exec pan check`, compliance run-all, and the client Vitest suite in
  sequence and SHALL present a checklist UI whose row labels match the named
  checks in `OPERATION.md` § Pre-close validation checklist for those three
  bundles.
- When any pre-close bundle fails, the checklist SHALL mark the failing row
  with pass or fail status and SHALL link to the Maintenance module output for
  the failed bundle.

### Maintenance module shell and API safety

- When the dashboard loads, `DashboardModuleShell` SHALL render `MaintenanceModule`
  instead of the Maintenance placeholder empty state.
- When maintenance API routes spawn subprocesses, the routes SHALL reject shell
  metacharacters in request bodies and SHALL allow only the suite and descriptor
  identifiers declared in this spec.
- When route tests execute, tests SHALL mock subprocess output and SHALL verify
  HTTP status codes, streamed chunk framing, and structured compliance report
  parsing without requiring live subprocess side effects in CI.

## Out of scope

- Scheduled compliance cadence automation; deferred to M4 scheduler wiring per
  source directive and `lib/memory/handbook/compliance-runs.md`.
- CI integration, remote test farms, or GitHub Actions workflow triggers per
  source directive.
- Token economy calibration UI per source directive.
- Extending `POST /api/execute` pan verb allowlist beyond read-only maintenance
  commands; mutating pan verbs remain Pipeline-only per shipped
  command-center-pipeline-orientation scope.
- Full OPERATION.md pre-close checklist execution in a single preset beyond
  `pan check`, compliance run-all, and client Vitest; remaining named checks
  stay operator-manual or a future inbox item.
- Automations module changes, Pipeline run-state schema changes, persona spec
  edits, or MCP handler changes.
- Replacing `lib/internal/tools/run-compliance.mjs` logic inside the client;
  API routes SHALL delegate to the existing runner.

## Open questions

_(none — directive and ratified ux-spec supply sufficient scope for plan-stage delegation)_
