---
title: Command Center — craft polish pass Engineering Spec
feature_id: command-center-craft-polish-pass
task_id: 8919_2131_command-center-craft-polish-pass
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: false
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
depends_on:
  - command-center-ux-spec-and-information-architecture
  - command-center-pipeline-command-center-and-human-gate-queue
  - command-center-active-memory-inbox-triage-multi-run-view
  - command-center-automation-registry-and-management-ui
  - command-center-maintenance-toolkit-compliance-tests
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines seven required outcomes, seven acceptance checks, explicit out-of-scope boundaries, a touch set, and ratified ux-spec and design-audit authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates accessibility, IA correction, empty states, sidebar compaction, wizard elevation, Maintenance OUTPUT guidance, and Files tab styling outcomes with machine-checkable acceptance criteria.
  - The directive source_channel command-center-design-audit-delivery maps to design audit run 9186_2126 with blocker B1 and majors M1–M6 as the bounded fix scope.
  - Minor audit items m1–m5 and nits n1–n3 remain out of scope unless trivially bundled with a listed fix per source directive.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [28, 37]
    note: Source directive Problem section states accessibility drift, IA misplacement, hollow Pipeline empty state, and sidebar density gaps from design audit 9186_2126.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [39, 41]
    note: Source directive Goal section bounds one craft-polish pass without palette redesign or API changes.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [43, 51]
    note: Source directive Required outcomes enumerate B1, M1–M6, and Files secondary tab treatment.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [53, 61]
    note: Source directive Acceptance criteria anchor WAI-ARIA tabs, Maintenance pre-close placement, Pipeline empty-run recovery, sidebar compaction, wizard shell, OUTPUT guidance, and Files tab typography.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [63, 71]
    note: Source directive Out of scope excludes API changes, domain-card restoration, header-summary wiring, and unlisted audit nits.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/8947_2130_command-center-craft-polish-pass.md
    range: [84, 87]
    note: Source directive Touch set lists Command Center components and globals.css focus tokens.
  - kind: lines
    path: .pan/work/158_06-08-26/9186_2126_command-center-design-audit-delivery/command-center-design-audit.md
    range: [39, 54]
    note: Design audit blocker B1 and majors M1–M6 observations and fix recommendations.
  - kind: lines
    path: .pan/work/158_06-08-26/9186_2126_command-center-design-audit-delivery/command-center-design-audit.md
    range: [104, 112]
    note: Design audit recommended feature scope seeds matching this Feature acceptance criteria.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [52, 54]
    note: Ratified ux-spec requires single role=tablist, aria-selected on active tab, and de-emphasized Files secondary tab.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [77, 81]
    note: Ratified Maintenance module wireframe places pre-close validation CTA with OPERATION.md link; Pipeline wireframe excludes duplicate pre-close panel.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [119, 121]
    note: Ratified shared affordance requires dashed empty states with recovery CTA on idle panels.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [31, 39]
    note: Design-craft standard governs accessibility, hierarchy, empty states, and perceived product quality for this polish pass.
  - kind: lines
    path: client/src/components/command-center/layout/DashboardModuleShell.tsx
    range: [32, 68]
    note: Current module tab strip lacks role=tablist and role=tab semantics despite aria-selected on buttons.
  - kind: lines
    path: client/src/components/command-center/pipeline/PipelineModule.tsx
    range: [18, 18]
    note: Current Pipeline module imports PreCloseValidationPanel contrary to ratified Maintenance-only IA.
  - kind: lines
    path: client/src/components/command-center/automations/AutomationsModule.tsx
    range: [275, 275]
    note: Current automation wizard renders inline via AutomationWizardShell without overlay focus trap.
  - kind: lines
    path: client/src/components/command-center/shared/useFocusTrap.ts
    range: [1, 30]
    note: Prior-art focus-trap hook that wizard shell SHALL reuse consistent with Files modal pattern.
  - kind: lines
    path: client/src/app/globals.css
    range: [505, 529]
    note: Module tab focus ring tokens that active-tab contrast fix MAY adjust without palette overhaul.
  - kind: lines
    path: lib/memory/features/command-center-maintenance-toolkit-compliance-tests/spec.md
    range: [175, 189]
    note: Shipped pre-close preset spec that Maintenance module SHALL host exclusively after IA correction.
---

# Spec

This Feature SHALL deliver one bounded Command Center craft-polish pass that closes
design-audit blocker B1 and majors M1–M6 without redesigning the palette or
changing API routes. The live Command Center exposes module tabs without WAI-ARIA tablist
semantics, hosts pre-close validation in Pipeline instead of Maintenance, shows
a hollow Pipeline main column when no runs are active, and renders dense sidebar
actions that reduce operator scan speed. The Feature SHALL align module tabs,
information architecture, empty states, sidebar triage, automation wizard
elevation, Maintenance OUTPUT guidance, and Files tab typography with the
ratified ux-spec and design-craft standards.

## Acceptance criteria

### Module tab accessibility (B1)

- When an operator focuses the module tab strip, the DOM SHALL expose a single
  `role="tablist"` on `.dashboard-module-tabs` and `role="tab"` on each module
  button with roving `tabIndex` per the WAI-ARIA tabs pattern.
- When an operator presses Left, Right, Home, or End while focus is inside the
  tablist, keyboard navigation SHALL move selection and activation without
  leaving the tablist.
- When a screen reader inspects the active Pipeline tab, the reader SHALL
  announce "Pipeline, tab, 1 of 4, selected".
- When any module tab receives `:focus-visible`, the focus ring SHALL remain
  `2px solid var(--accent)` with `2px` offset at ≥3:1 contrast against the
  tab fill including the active inverted tab.

### Pre-close information architecture (M1)

- When an operator opens the Maintenance module, the pre-close validation panel
  SHALL render with an OPERATION.md link and a `pan check` CTA per the ratified
  Maintenance wireframe.
- When an operator opens the Pipeline module, the Pipeline main column SHALL NOT
  host `PreCloseValidationPanel`.
- When the Pipeline module needs to reference pre-close checks, the module MAY
  render a one-line link with copy "Pre-close checks → Maintenance" that navigates
  to the Maintenance module.

### Pipeline empty-run recovery (M2)

- When `GET /api/run-state` returns zero non-terminal tasks, the Pipeline main
  column SHALL show a unified dashed empty state spanning the 9-stage grid and
  timeline region.
- When the unified empty state renders, the panel SHALL display copy "No active
  runs" and a primary recovery CTA that copies `pan run feature-delivery …` from
  the newest inbox row or links to operator documentation.
- When the Pipeline module renders with zero active runs at a 1280px viewport
  width, dead space above the fold in the main column SHALL occupy <40% of the
  main column height.

### Sidebar compaction (M3, M4)

- When inbox triage rows render in the Pipeline sidebar, each row SHALL expose at
  most 2 visible controls at rest; secondary actions SHALL demote to icon with
  tooltip or compact text links.
- When an inbox row has `title === slug`, the slug SHALL NOT render as a
  duplicate visible label.
- When the active memory preview renders in the Pipeline sidebar, the preview
  SHALL NOT display literal `**` markdown markers.
- When the active memory body exceeds 3 lines, the preview SHALL collapse the
  remainder behind a "Show details" control with ≤3 lines visible before expand.

### Automation wizard shell (M5)

- When an operator opens the automation create or edit wizard, the wizard SHALL
  present in an elevated slide-over or modal panel with focus trap until Cancel
  or Save.
- When the wizard opens, the automation list behind the panel SHALL dim and SHALL
  NOT receive pointer interaction until the wizard closes.
- When the operator presses Esc or activates Cancel, the wizard SHALL close and
  SHALL restore the prior scroll position of the automation list.

### Maintenance OUTPUT guidance (M6)

- When the Maintenance module loads with no prior compliance or test-suite run
  in the session, the OUTPUT region SHALL show a dashed `EmptyState` with guided
  copy "Run a compliance check or test suite to stream output here".
- When the compliance results table renders after a run, the table SHALL include
  a dedicated Result column with aligned pass or fail values across rows.

### Files secondary tab (audit AC7)

- When an operator views the module tab strip, the Files tab SHALL use
  `0.75rem` type, a lighter border than primary module tabs, and an optional
  trailing chevron with label "Files ›".
- When an operator compares Files and Pipeline tabs at rest, the Files tab SHALL
  appear visibly smaller than primary module tabs at a glance.

### Verification gates

- When qa-tester executes browser verification, the operator SHALL inspect
  Pipeline (empty and active runs), Automations (list and wizard), Maintenance
  (idle OUTPUT and compliance run), and Files modal at `http://localhost:3000`.
- When qa-tester executes accessibility verification, axe or screen-reader
  spot-check SHALL pass on the module tab strip with focus-visible on the active
  tab.
- When qa-tester executes responsive verification, a 375×812 viewport spot-check
  SHALL confirm stacked layout readability for affected surfaces.

## Out of scope

- API route or backend schema changes per source directive.
- New automations backend or scheduler tick wiring per source directive.
- Domain-card restoration; Tier 4 demotion from the ratified ux-spec stands.
- Full header-summary data wiring beyond static copy; audit item m1 deferred.
- Lighthouse score targets or performance budgets per source directive.
- Full Command Center redesign or palette and token overhaul per source directive.
- Audit minor items m2–m5 and nits n1–n3 unless trivially bundled with a listed
  fix per source directive.
- Runtime config persona-tier collapse (audit m4) unless bundled incidentally with
  sidebar compaction work.

## Open questions

_(none — directive, design audit, and ratified ux-spec supply sufficient scope for plan-stage delegation)_
