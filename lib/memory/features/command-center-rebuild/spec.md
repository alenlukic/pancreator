---
title: Command Center rebuild Engineering Spec
feature_id: command-center-rebuild
task_id: 52276_0928_command-center-rebuild
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
source_pipeline: experience-planning
source_task_id: 30811_0833_experience-planning-command-center-rebuild
depends_on:
  - command-center-app-shell-navigation-rail-and-operator-theme-tokens
  - command-center-ux-philosophy-information-architecture-and-user-stories
  - command-center-command-center-operational-state-surface
  - command-center-feature-delivery-mission-control-run-detail
  - command-center-automation-registry-and-management-ui
  - command-center-maintenance-toolkit-compliance-tests
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the experience-planning synthesis directive defines required outcomes, acceptance criteria, tradeoffs, recommendation disposition, and out-of-scope boundaries without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive at lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md enumerates six destinations, home attention reconciliation, human-gate action speed, automation lifecycle, compliance recovery, activity receipts, navigation pruning, and design-system compliance with machine-checkable acceptance criteria.
  - The directive synthesizes experience-planning task 30811_0833_experience-planning-command-center-rebuild product and design recommendation streams; downstream plan stage SHALL emit ux-spec.md when design_steps is enabled.
  - Bounded service-layer repairs are in scope; pipeline runtime, pan CLI semantics, and persona contracts remain unchanged per source directive out-of-scope call.
references:
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [28, 36]
    note: Source directive Problem section states untrustworthy Command Center orientation, stale attention, missing gates, and placeholder navigation.
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [38, 45]
    note: Source directive Goal section names six URL-addressable destinations plus run and automation detail routes.
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [47, 131]
    note: Source directive Required outcomes enumerate home truthfulness, feature delivery, compliance, automations, navigation, and design system obligations.
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [133, 156]
    note: Source directive Acceptance criteria anchor orientation speed, attention reconciliation, gate clicks, receipts, automation completeness, compliance recovery, navigation integrity, freshness, and design QA gate.
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [158, 187]
    note: Source directive Tradeoffs resolved bound six destinations, presentation rebuild scope, mutation safety, token canon, salience, Cmd-K mirroring, and attention motion.
  - kind: lines
    path: lib/inbox/in/172965_06-10-26/55292_0838_command-center-rebuild.md
    range: [317, 326]
    note: Source directive Out of scope excludes placeholder surfaces, pipeline runtime changes, auth, and broken-CTA preservation.
  - kind: lines
    path: lib/memory/handbook/engineering/design/design-system.md
    range: [1, 80]
    note: Ratified design-system tokens and layout canon the presentation layer SHALL conform to.
  - kind: lines
    path: lib/memory/handbook/engineering/design/component-standard.md
    range: [1, 80]
    note: Component-standard governs shadcn/ui, Radix, Tailwind variable mapping, and shared extraction rules.
  - kind: lines
    path: lib/memory/handbook/engineering/design/control-surface-ux.md
    range: [1, 80]
    note: Control-surface UX standard governs mutating CTA labels, confirmation policy, and operator action affordances.
  - kind: lines
    path: lib/memory/features/command-center-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [1, 120]
    note: Prior ratified ten-surface IA and action taxonomy; this Feature reconciles shipped slices into the six-destination rebuild model where conflicts arise.
  - kind: lines
    path: lib/memory/features/command-center-command-center-operational-state-surface/spec.md
    range: [94, 104]
    note: Prior Home card-region and run-state consumption patterns to extend with reconciliation and freshness rules.
  - kind: lines
    path: lib/memory/features/command-center-feature-delivery-mission-control-run-detail/spec.md
    range: [1, 120]
    note: Prior FD Mission Control run detail, human gates, and intervention levers to integrate under Feature Delivery destination.
  - kind: lines
    path: lib/memory/features/command-center-automation-registry-and-management-ui/spec.md
    range: [1, 100]
    note: Prior automation registry and lifecycle UI to complete under Automations destination.
  - kind: lines
    path: lib/memory/features/command-center-maintenance-toolkit-compliance-tests/spec.md
    range: [1, 100]
    note: Prior compliance run triggering and result review patterns to extend under Compliance + Recovery destination.
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [29, 39]
    note: Plan stage declares ux-spec.md output path under lib/memory/features/<feature-id>/ when design_steps is enabled.
---

# Spec

This Feature SHALL rebuild the Pancreator Command Center as a truthful, design-canon-compliant
local control surface so one operator answers what needs attention, what is running,
what failed or stalled, and what shipped recently within 30 seconds, acts on human
gates within 2 clicks, recovers delivery health, manages automations, and audits
every state mutation from one coherent UI. The shipped information architecture
SHALL expose six URL-addressable destinations plus run and automation detail routes:
Home, Feature Delivery, Compliance + Recovery, Automations, Activity Log, and Cmd-K.
The Feature SHALL reconcile attention data across `.pan/work`, `lib/memory/features/*/index.json`,
and `.pan/archive/work/`, emit Activity Log receipts for every state mutation, and
conform to ratified design-system, component-standard, and control-surface standards.

## Acceptance criteria

### Home and attention truthfulness

- When an operator opens Home, the surface SHALL answer the four orientation questions
  within 30 seconds in urgency order: Human Gates, Anomalies, Running Now, and Recent
  Outcomes.
- When an attention region renders, the region SHALL show a count, at most 5 ranked
  items, one overflow navigation action, and a guided empty state when no items exist.
- When attention regions reconcile live work, the client SHALL exclude shipped, archived,
  complete, closed, or superseded runs from Needs You, Human Gates, Anomalies, and
  Running Now by cross-checking `.pan/work`, `lib/memory/features/*/index.json`, and
  `.pan/archive/work/`.
- When fixture state contains 2 active runs, 1 human gate, 3 shipped features, and
  2 archived runs, attention regions SHALL show exactly 2 active runs and 1 gate with
  0 shipped or archived items.
- When attention data is older than 60 seconds, each affected region SHALL display
  data age.
- When active work is visible, the client SHALL revalidate attention data at most
  every 10 seconds.
- When reconciliation fails, Home SHALL render a degraded-data banner that names the
  failing source.
- When a persistent rail or status-bar attention indicator renders, it SHALL use the
  same reconciled state as Human Gates and Anomalies with calm, attention, and blocking
  states.

### Feature delivery decisions

- When an operator opens Feature Delivery, the surface SHALL own active run supervision:
  run list, run detail, human gates, intervention levers, and artifact links.
- When a human gate announces on Home or Feature Delivery, the operator SHALL approve,
  reject, or revise within 2 clicks from the announcing surface without a context-losing
  route change.
- When seeded human-gate flows execute, 95 percent or more of gates SHALL complete
  approve, reject, or revise within 2 clicks from the announcing surface.
- When pause, steer, and abort controls render, they SHALL sit next to the run they
  target.
- When a destructive action executes, the UI SHALL require one blast-radius confirmation.
- When a reversible action executes and undo exists, the UI SHALL offer undo for at
  least 10 seconds.

### Compliance, recovery, automations, and auditability

- When an operator opens Compliance + Recovery, the surface SHALL support triggering
  a compliance run, reviewing latest results, inspecting failures, and running recovery
  actions from populated surfaces.
- When seeded compliance failures render, 100 percent SHALL expose a review path and
  at least 1 recovery action from the UI.
- When an operator opens Automations, the surface SHALL support create, enable, disable,
  edit, pause, re-enable, and run-history review through live controls backed by existing
  automation API handlers.
- When seeded automation lifecycle actions execute from create through re-enable, 100
  percent SHALL complete successfully from the UI and emit receipts.
- When any state-mutating action executes across feature delivery, compliance, recovery,
  or automations, the action SHALL use an imperative verb plus concrete object, state
  the mutation effect, and emit an Activity Log receipt with actor, verb, object,
  timestamp, and artifact or diff link.
- When Activity Log renders, it SHALL display those receipts as an audit trail for
  who acted, what changed, when it changed, and where the artifact lives.
- When seeded feature-delivery, compliance, recovery, and automation flows execute,
  100 percent of state-mutating actions SHALL produce receipts containing actor, verb,
  object, timestamp, and artifact or diff link.

### Navigation, launcher, and detail routes

- When production navigation renders, it SHALL omit Feature Backlog, Repo Explorer,
  Agent Chat, Sandbox Manager, inspector placeholders, and any "Coming soon" destination.
- When production navigation renders, 0 "Coming soon" elements SHALL appear, and 100
  percent of shipped destinations SHALL map to one documented operator job.
- When run detail or automation detail surfaces render, each route SHALL be URL-addressable.
- When Cmd-K opens, the launcher SHALL expose navigation plus the 10 most frequent
  actions.
- When a launcher action exists, a visible control on the owning surface SHALL mirror
  that action.
- When mutating CTAs render, labels SHALL name the verb and object, such as "Approve
  plan for command-center-rebuild", "Re-run compliance audit", and "Pause automation
  nightly-curation".

### Design and implementation system

- When the presentation layer ships, it SHALL conform to ratified design-system,
  component-standard, and control-surface standards so the design QA companion can
  verify release readiness.
- When the app shell renders on regular and wide viewports, it SHALL use a calm,
  type-led layout with persistent rail, main content, and optional inspector or detail
  panel; compact viewports SHALL collapse the rail behind a menu and stack inspector
  content below the main flow.
- When layout and styling apply, the UI SHALL use only design-token spacing, color,
  typography, radius, and shadow values and SHALL NOT add one-off layout values or
  grow `globals.css` beyond resets, font loading, and CSS custom-property emission.
- When shared UI is built, components SHALL come from shadcn/ui generated components
  in `client/src/components/ui/`, Radix primitives, Tailwind utilities mapped to
  design-system CSS variables, and typed component variants.
- When a Command Center pattern appears on two or more surfaces, the pattern SHALL
  become a shared component; the starting inventory includes `AppShell`, `NavRail`,
  `StatusBar`, `RegionCard`, `AttentionList`, `RunRow`, `HumanGateCard`,
  `AutomationRow`, `ComplianceResultCard`, `ActivityReceiptRow`, `EmptyState`,
  `DegradedDataBanner`, `ActionMenu`, `ConfirmDialog`, `CommandPalette`, `Toast`,
  `Badge`, `Tabs`, `Tooltip`, and `Skeleton`.
- When icons render, the UI SHALL use Lucide icons consistently; interactive parents
  SHALL own accessible labels and SHALL NOT use Unicode glyphs, emoji, or inline pasted
  SVG paths.
- When interactive controls render, hover, focus, active, selected, disabled, loading,
  success, and error states SHALL be defined before implementation; loading feedback
  SHALL appear within 400 ms.
- When motion applies, animations SHALL be subtle, purposeful, and reduced-motion aware;
  a new blocking attention item MAY nudge once with at most 4 px amplitude, 160–240 ms
  duration, and at most 2 cycles.

### Verification and release gates

- When Home orientation is measured across at least 10 seeded sessions, 90 percent
  or more of sessions SHALL answer all four orientation questions within 30 seconds
  of unassisted reading.
- When operator task coverage is measured over 5 working days, 90 percent or more
  of day-to-day Pancreator tasks SHALL complete inside the Command Center per operator
  task log.
- When the design QA release gate runs before delivery acceptance, the gate SHALL
  report `design_qa_passes: true` with 0 P0 findings and 0 P1 findings.

## Out of scope

- Feature Backlog, Repo Explorer, Agent Chat, Sandbox Manager, and inspector placeholder
  surfaces until each owns a real operator job per source directive.
- Pipeline runtime behavior, `pan` CLI semantics, and persona contracts, except for
  the bounded service-layer repairs required to make Command Center state truthful
  and controls live per source directive.
- Authentication, roles, multi-user collaboration, and mobile-native applications;
  responsive web is sufficient per source directive.
- Preserving broken CTAs, empty production data surfaces, disabled placeholders, or
  hidden side effects for compatibility per source directive.
- Breakpoint, icon-size, and easing token canon extensions unless implementation
  cannot express the approved layout, icon sizing, or motion with current tokens per
  adapted design-stream recommendations in the source directive.

## Open questions

_(none — experience-planning synthesis directive, tradeoff disposition, and ratified design canon supply sufficient scope for plan-stage delegation)_
