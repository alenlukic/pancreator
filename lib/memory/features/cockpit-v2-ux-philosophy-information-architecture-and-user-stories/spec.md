---
title: Cockpit v2 UX philosophy, information architecture, and user stories Engineering Spec
feature_id: cockpit-v2-ux-philosophy-information-architecture-and-user-stories
task_id: 69695_0438_cockpit-v2-ux-philosophy-information-architecture-and-user-stories
program: cockpit-v2
stage: implement
owner: coder
status: ratified
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
next_owner: reviewer
next_stage: review
ux_spec: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
intake_closure:
  human_approval_gate: plan-complete
  approved_date: null
  channel: operator_cursor_chat
  note: Plan stage completed with design-engineer ux-spec emission. Implement stage ratifies memory-tier artifacts against acceptance criteria; ship-stage human ratification reconciles intake_closure at commit time.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the inbox directive enumerates required outcomes, acceptance criteria, and out-of-scope boundaries and references supervisor-preserved operator prose for sections 1–6 and theme.ts.
  - The canonical ux-spec artifact path follows feature-delivery pipeline convention at lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md rather than the program shorthand cockpit-v2-ux-philosophy-user-stories cited in the inbox frontmatter.
  - This Feature delivers spec and ux-spec documentation only; production React and API implementation routes to downstream Cockpit v2 inbox items per implementation-priority slice.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
    range: [25, 34]
    note: Source directive Problem section states chat-first primitives and missing operational surfaces.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
    range: [36, 43]
    note: Source directive Goal section names ux-spec.md as successor UX authority.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
    range: [45, 69]
    note: Source directive Required outcomes enumerate philosophy, surfaces, stories, taxonomies, priority, theme, and migration.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
    range: [71, 88]
    note: Source directive Acceptance criteria anchor ux-spec contract blocks, design_steps, and touch-set boundary.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/69710_0438_cockpit-v2-ux-philosophy-user-stories.md
    range: [90, 96]
    note: Source directive Out of scope excludes production implementation and scheduler tick execution.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [43, 283]
    contentHash: 96d5a8f
    note: Prior ratified three-module IA; this Feature supersedes navigation and surface model where conflicts arise.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [1, 116]
    note: Design craft standards the design-engineer SHALL apply.
  - kind: lines
    path: lib/memory/features/surface-opt-p9-dashboard-operator-cockpit/delivery-report.md
    range: [1, 6]
    note: P9 shipped run-state aggregation that Cockpit v2 SHALL preserve.
  - kind: lines
    path: lib/memory/features/surface-opt-p10-dashboard-safe-editing/spec.md
    range: [42, 46]
    note: P10 read-only default and diff confirmation carry forward.
  - kind: lines
    path: lib/personas/design-engineer.md
    range: [80, 83]
    note: design-engineer emits ux-spec.md during plan when design_steps is enabled.
  - kind: lines
    path: lib/memory/handbook/contract-templates/ux-spec.template.md
    range: [28, 47]
    note: UX-spec contract block slot map for machine-checkable design assertions.
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [29, 39]
    note: Plan stage declares ux-spec.md output path under lib/memory/features/<feature-id>/.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [1, 392]
    contentHash: c14ffc5
    note: Ratified ux-spec with seven principles, ten surfaces, stories 4.1–4.11, five llm-judge contract blocks.
---

# Spec

This Feature SHALL ratify a successor Cockpit v2 UX authority that reframes
Cockpit as a state-first operator console for an autonomous feature-delivery
factory. The ratified three-module shell lacks ten operational surfaces,
status/severity/action taxonomies, and a fire-and-forget inspectability model
operators need. The Feature SHALL deliver one canonical Engineering Spec at
intake and one ux-spec.md during plan with design-engineer companion support.
The ux-spec SHALL encode seven UX principles, ten top-level surfaces, user
stories with acceptance criteria, cross-cutting requirements, implementation
priority, operator theme tokens, and explicit supersession rules over prior
three-module IA. Downstream Cockpit v2 implementation inbox items SHALL consume
the ux-spec as the sole UX source of truth.

## Acceptance criteria

### Intake and plan artifacts

- When intake completes, the Feature SHALL emit
  lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/spec.md
  with Spec Kit sections for Spec, Acceptance criteria, Out of scope, and Open
  questions.
- When plan completes with design_steps enabled, the design-engineer companion
  SHALL emit
  lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
  before tech-lead consolidates plan.md.
- When the ux-spec exists, the ux-spec SHALL conform to
  lib/memory/handbook/contract-templates/ux-spec.template.md layout.

### UX philosophy

- When the ux-spec documents philosophy, the ux-spec SHALL encode exactly seven
  principles: mission control not decoration; fire-and-forget with on-demand
  inspectability; state-first chat-second; every problem has a next action;
  artifacts first-class; progressive disclosure; local-native repo-aware UX.
- When the ux-spec documents product framing, the ux-spec SHALL state the
  dominant operator pattern as select/create work, kick off feature-delivery,
  walk away, inspect, remediate, and close.

### Ten top-level surfaces

- When the ux-spec documents navigation, the ux-spec SHALL define exactly ten
  top-level surfaces: Command Center; Feature Backlog; Work Intake/Kickoff;
  Feature Delivery Mission Control; Compliance + Recovery Center; Repo
  Explorer/Native Editor; Agent Chat + Persona Console; Sandbox Manager;
  Activity Log; Automations/Cron UX.
- When the ux-spec documents each surface, the ux-spec SHALL state primary jobs
  and key contents per operator source material sections 3.1 through 3.10.

### User stories

- When the ux-spec documents user stories, the ux-spec SHALL include sections
  4.1 through 4.11 with acceptance criteria as specified in the operator source
  material: Command Center; Feature backlog; Work intake and kickoff; Feature
  Delivery Mission Control; Compliance and recovery; Repo explorer and native
  editor; Agent chat and persona console; Sandbox manager; Activity log; Quick
  fix; Automations/cron.
- When the ux-spec documents Command Center stories, the ux-spec SHALL require
  active runs, blocked runs, compliance violations, hanging tasks, recent
  automation results, recent activity, and a next action on every surfaced item.

### Cross-cutting requirements

- When the ux-spec documents linking, the ux-spec SHALL preserve navigable links
  among backlog items, inbox items, feature runs, pipeline stages, persona
  invocations, artifacts, files changed, compliance findings, automation runs,
  and activity events.
- When the ux-spec documents taxonomies, the ux-spec SHALL define status values
  Draft through Archived, severity values Info through Critical, and the action
  taxonomy Open through Copy output per operator source material section 5.
- When the ux-spec documents human intervention, the ux-spec SHALL require each
  stop to show why the system stopped, supporting evidence, and safe remediation
  actions.
- When the ux-spec documents real-time behavior, the ux-spec SHALL prioritize
  meaningful state transitions in default views and SHALL place verbose logs one
  click away.

### Implementation priority

- When the ux-spec documents priority, the ux-spec SHALL mark the first
  implementation slice as Command Center, FD Mission Control, unified kickoff,
  compliance/recovery surfacing, activity log, quick fix, and automations list
  plus history.
- When the ux-spec documents deferrals, the ux-spec SHALL defer full visual
  workflow builder, advanced sandbox comparison, rich multi-file IDE, complex
  automation templates, and analytics dashboards until the core operational loop
  ships.

### Theme tokens

- When the ux-spec documents visual design, the ux-spec SHALL encode operator
  brand tokens inkBlack, apricotCream, and mintLeaf; light and dark surface
  palettes; status palettes for error, warning, and success; radii, spacing,
  typography, and shadow scales; and CSS variable mapping via getCssVariables.
- When the ux-spec documents theme application, the ux-spec SHALL include at
  least one contract block asserting theme token application on primary surfaces.

### Prior-art reconciliation and contract blocks

- When the ux-spec cites prior art, the ux-spec SHALL cite
  lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
  and SHALL state explicit supersession rules for conflicting three-module
  navigation IA.
- When the ux-spec documents P9 and P10 integration, the ux-spec SHALL preserve
  GET /api/run-state aggregation and P10 safe-editing mechanics without
  replacing them.
- When the ux-spec documents migration, the ux-spec SHALL document transition
  from the three-module shell to the ten-surface IA.
- When the ux-spec includes contract blocks, the ux-spec SHALL include
  machine-checkable blocks for at least Command Center operational state, FD
  Mission Control stage rail plus retry-limit surfacing, kickoff flow inputs,
  compliance violation remediation actions, and theme token application.
- When the ux-spec documents craft standards, the ux-spec SHALL encode measurable
  thresholds from lib/memory/handbook/engineering/design-craft.md including
  CTA verb+object labels, progressive disclosure tiers, and no raw-data-as-primary
  content.

### Delivery boundary and design QA

- When implement stage executes, the touch-set SHALL contain only memory-tier
  documentation paths spec.md, ux-spec.md, and index.json and SHALL NOT include
  production React components or API route files.
- When test stage executes with design_steps enabled, design-reviewer SHALL
  verify ux-spec contract blocks are machine-checkable and navigation flows are
  complete for the first implementation slice.

## Out of scope

- Implementing API routes, React components, or client/src/components/cockpit/
  source files for the ten surfaces; downstream Cockpit v2 implementation inbox
  items own code per implementation-priority slice per source directive.
- Replacing P9 GET /api/run-state aggregation or P10 write-guard mechanics per
  source directive Out of scope section.
- Scheduler tick execution owned by cockpit-v2-automations-scheduler backlog
  item per source directive.
- Full visual workflow builder, advanced sandbox comparison, rich multi-file IDE,
  complex automation templates, and deep analytics dashboards per source
  directive and operator section 6 deferrals.
- Modifying lib/internal/packages/@pancreator/cli/, MCP handlers, persona specs,
  or P9/P10 shipped dashboard code in this Feature run.

## Open questions

_(none — directive and preserved operator source material are sufficiently specified for plan-stage delegation)_
