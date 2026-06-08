---
title: Cockpit v2 UX spec and information architecture Engineering Spec
feature_id: cockpit-v2-ux-spec-and-information-architecture
task_id: 53639_0906_cockpit-v2-ux-spec-and-information-architecture
program: cockpit-v2
stage: implement
owner: coder
status: ratified
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
next_owner: reviewer
next_stage: review
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines module scope, required outcomes, acceptance criteria, P9/P10 prior-art references, and design_steps obligations without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates three Cockpit v2 modules, eight required outcomes, five acceptance checks, and explicit out-of-scope boundaries.
  - The canonical ux-spec artifact path follows feature-delivery pipeline convention at lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md rather than the program shorthand lib/memory/features/cockpit-v2/ cited in the directive touch set.
  - This Feature delivers spec and ux-spec documentation only; production React and API implementation routes to downstream Cockpit v2 inbox items.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
    range: [27, 29]
    note: Source directive Problem section states P9/P10 cockpit gaps and operator context-switching pain.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
    range: [31, 33]
    note: Source directive Goal section names ux-spec.md as the ratified UX authority.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
    range: [35, 44]
    note: Source directive Required outcomes enumerate IA, three modules, shared patterns, accessibility, component inventory, and design tokens.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
    range: [46, 52]
    note: Source directive Acceptance criteria anchor ux-spec coverage, navigation flows, accessibility contract blocks, and design_steps.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/54353_0854_cockpit-v2-ux-spec.md
    range: [54, 58]
    note: Source directive Out of scope excludes production implementation, Cursor Automations integration, and remote deploy or auth UX.
  - kind: lines
    path: lib/memory/features/surface-opt-p9-dashboard-operator-cockpit/delivery-report.md
    range: [1, 6]
    note: P9 shipped the 9-stage grid and run-event timeline that Cockpit v2 Pipeline module evolves.
  - kind: lines
    path: lib/memory/features/surface-opt-p10-dashboard-safe-editing/spec.md
    range: [42, 46]
    note: P10 read-only default and diff confirmation carry forward into Cockpit v2 artifact modals.
  - kind: lines
    path: lib/personas/design-engineer.md
    range: [80, 83]
    note: design-engineer emits ux-spec.md during plan when design_steps is enabled.
  - kind: lines
    path: lib/memory/handbook/contract-templates/ux-spec.template.md
    range: [28, 47]
    note: UX-spec contract block slot map for accessibility, contrast, and motion budget assertions.
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [29, 39]
    note: Plan stage declares ux-spec.md output path under lib/memory/features/<feature-id>/.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [43, 283]
    contentHash: 08b0dd0
    note: Ratified ux-spec covering three-module IA, module UX, accessibility contracts, and component inventory.
---

# Spec

This Feature SHALL ratify Cockpit v2 operator-dashboard UX authority before any
production code lands. The shipped P9 9-stage grid and P10 safe-editing controls
lack cohesive information architecture for three modules: Pipeline, Automations,
and Maintenance. Operators still context-switch to chat and terminal for
orientation, human gates, compliance, and scheduled agent work. The Feature
SHALL deliver one canonical Engineering Spec at intake and one ux-spec.md during
plan with design-engineer companion support. The ux-spec SHALL define primary
navigation, module layouts, interaction patterns, accessibility contract blocks,
a proposed client/src/components/cockpit/ component inventory, and globals.css
design-token guidance. Downstream Cockpit v2 implementation inbox items SHALL
consume the ux-spec as the sole UX source of truth.

## Acceptance criteria

### Intake and plan artifacts

- When intake completes, the Feature SHALL emit
  lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/spec.md
  with Spec Kit sections for Spec, Acceptance criteria, Out of scope, and Open
  questions.
- When plan completes with design_steps enabled, the design-engineer companion
  SHALL emit
  lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
  before tech-lead consolidates plan.md.
- When the ux-spec exists, the ux-spec SHALL document all three modules:
  Pipeline, Automations, and Maintenance.

### Information architecture

- When an operator opens Cockpit v2, the primary navigation SHALL expose exactly
  three module tabs: Pipeline, Automations, and Maintenance.
- When an operator opens Cockpit v2, the Files browser SHALL appear only on a
  secondary tab and SHALL NOT occupy the default module view.
- When Cockpit v2 renders the default landing surface, domain cards SHALL NOT
  appear on the primary module view (Tier 4 demotion per source directive).

### Pipeline module UX

- When the Pipeline module renders, the surface SHALL include a Next Action
  command-center panel, a human-gate queue banner, the P9 9-stage grid, a live
  run-event timeline, an artifact drawer, inbox triage, a multi-run table, and a
  read-only config panel.
- When the Pipeline module displays run state, the module SHALL source state from
  existing pan status and run-log contracts per P9 prior art and SHALL NOT
  invent new runner APIs in this Feature.

### Automations module UX

- When the Automations module renders, the surface SHALL include a list view, a
  create/edit wizard with schedule picker, persona dropdown, and prompt editor,
  and a run-history panel.
- When the Automations wizard is documented, the ux-spec SHALL describe empty,
  loading, and error states for each wizard step.

### Maintenance module UX

- When the Maintenance module renders, the surface SHALL include a compliance
  audit panel, a test-suite picker, a streamed output viewer, and a pre-close
  validation entry point aligned with OPERATION.md pre-close validation.

### Shared patterns and accessibility

- When the ux-spec documents artifact viewing, the ux-spec SHALL mandate P10
  read-only default, explicit edit activation, and diff confirmation before
  writes.
- When the ux-spec documents shared affordances, the ux-spec SHALL specify
  copy-command buttons, attention banners, loading/empty/error states, and stage
  status badges.
- When the ux-spec documents accessibility, the ux-spec SHALL include at least
  one UX-spec contract block per
  lib/memory/handbook/contract-templates/ux-spec.template.md with explicit
  WCAG criterion identifiers.
- When the ux-spec documents visual tokens, the ux-spec SHALL specify spacing
  scale and semantic stage-status colors as globals.css extension guidance.

### Component inventory and wireframes

- When the ux-spec documents components, the ux-spec SHALL map surfaces to a
  proposed client/src/components/cockpit/ tree with layout, pipeline,
  automations, maintenance, and shared subdirectories.
- When the ux-spec includes navigation or primary flows, the ux-spec SHALL
  document them with mermaid diagrams or ASCII wireframes.
- Where wireframe assets aid comprehension, the Feature MAY add optional assets
  under lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/
  without requiring raster exports.

### Delivery boundary

- When implement stage executes, the touch-set SHALL contain only spec and
  ux-spec documentation paths and SHALL NOT include production React components
  or API route files.
- When test stage executes with design_steps enabled, design-engineer SHALL
  inspect ux-spec fidelity and qa-tester SHALL verify artifact completeness per
  pipeline contract.

## Out of scope

- Implementing API routes, React components, or client/src/components/cockpit/
  source files; downstream Cockpit v2 implementation inbox items own code per
  source directive Out of scope section.
- Cursor Automations product integration beyond UX documentation of an
  Automations module surface.
- Remote deploy, authentication, or multi-tenant operator UX per source directive.
- Modifying lib/internal/packages/@pancreator/cli/, MCP handlers, persona
  specs, or P9/P10 shipped dashboard code in this Feature run.
- Replacing P9 run-state aggregation or P10 write-guard logic; Cockpit v2 UX
  SHALL compose atop those deliverables.
- Creating lib/memory/features/cockpit-v2/ as a separate program folder; the
  canonical ux-spec path remains under this Feature id per
  lib/pipelines/feature-delivery.yaml plan-stage outputs.

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
