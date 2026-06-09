---
title: Cockpit v2 module tab accessibility Engineering Spec
feature_id: cockpit-v2-module-tab-accessibility
task_id: 4426_2246_cockpit-v2-module-tab-accessibility
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: false
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
depends_on:
  - cockpit-v2-ux-spec-and-information-architecture
blocks:
  - cockpit-v2-craft-polish-pass
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines five required outcomes, eight acceptance checks, explicit out-of-scope boundaries, a client-only touch set, and ratified ux-spec and design-audit authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates WAI-ARIA tablist semantics, roving tabindex, manual arrow-key focus, Enter or Space activation, focus-visible ring, and keyboard-only verification outcomes with machine-checkable acceptance criteria.
  - Design audit run 9781_2116 records blocker F-01 for missing tab pattern and minor F-09 for inconclusive keyboard activation; this Feature bounds scope to those findings only.
  - The directive requires manual activation on arrow keys (focus moves without module switch until Enter or Space); downstream implementers SHALL align tests and handlers with that pattern per source directive Required outcomes.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
    range: [21, 27]
    note: Source directive Problem section states F-01 blocker and missing WAI-ARIA tabs pattern in CockpitShell.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
    range: [25, 27]
    note: Source directive Goal section bounds WAI-ARIA tabs for four module switchers to clear design-audit blocker.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
    range: [29, 35]
    note: Source directive Required outcomes enumerate tablist, roving tabindex, arrow-key focus, Enter or Space activation, and focus-visible verification.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
    range: [37, 46]
    note: Source directive Acceptance criteria anchor DOM probe, aria attributes, manual activation, focus ring, and contract ux.module-tab-focus.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/9443_2122_cockpit-v2-tab-a11y.md
    range: [48, 53]
    note: Source directive Out of scope excludes pipeline empty states, craft polish, backend, and P10 modal exercises.
  - kind: lines
    path: .pan/work/172967_06-08-26/9781_2116_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [46, 54]
    note: Design audit F-01 observation and recommended CockpitShell tab-pattern fix.
  - kind: lines
    path: .pan/work/172967_06-08-26/9781_2116_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [126, 134]
    note: Design audit F-09 inconclusive keyboard activation resolved by manual verification after F-01 refactor.
  - kind: lines
    path: .pan/work/172967_06-08-26/9781_2116_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [217, 219]
    note: Design audit recommended Feature A scope and acceptance for tab pattern and ux.module-tab-focus.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [50, 55]
    note: Ratified ux-spec Layout and navigation requires single role=tablist and aria-selected on active tab.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [186, 198]
    note: Ratified Accessibility minimums require role=tab, keyboard-operable tabs, and 2px accent focus outline.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [202, 240]
    note: Contract ux.module-tab-focus requires visible focus outline and Enter or Space activation on module tabs.
  - kind: lines
    path: client/src/components/cockpit/layout/CockpitShell.tsx
    range: [75, 105]
    note: Current module tab strip implementation surface for WAI-ARIA tab pattern refactor.
  - kind: lines
    path: client/src/app/globals.css
    range: [505, 530]
    note: Module tab focus ring tokens that focus-visible verification SHALL exercise against eggshell surface.
  - kind: lines
    path: client/src/app/page.test.tsx
    range: [416, 437]
    note: Existing dashboard test coverage for tablist semantics and keyboard interaction on module tabs.
---

# Spec

This Feature SHALL implement the WAI-ARIA tabs pattern for Pipeline,
Automations, Maintenance, and Files module navigation in Cockpit v2 so screen
readers and keyboard-only operators receive standard tab semantics, roving focus,
and manual activation per the ratified ux-spec. Design audit run
9781_2116 failed with blocker F-01 because `CockpitShell` exposed module
switchers without `role="tablist"` and `role="tab"` wiring; minor F-09 recorded
inconclusive Enter and Space activation until the tab pattern lands. The Feature
SHALL limit edits to `client/` shell layout, related styles, and verification
tests and SHALL satisfy contract `ux.module-tab-focus` before operator-facing
ship.

## Acceptance criteria

### WAI-ARIA tab structure

- When an operator loads `/` at a 1280px by 900px viewport, the module
  navigation container SHALL expose `role="tablist"` and each of the four module
  buttons SHALL expose `role="tab"`.
- When a module tab is the active module, that tab SHALL carry
  `aria-selected="true"` and every inactive tab SHALL carry
  `aria-selected="false"`.
- When a module tab renders, the tab SHALL expose `aria-controls` referencing
  the associated panel id and the matching panel region SHALL expose
  `role="tabpanel"` with the referenced id and `aria-labelledby` pointing at
  the tab id.

### Roving tabindex and manual activation

- When the Cockpit renders module tabs, the selected tab SHALL carry
  `tabIndex={0}` and every other tab SHALL carry `tabIndex={-1}`.
- When an operator presses ArrowLeft or ArrowRight while focus is on a module
  tab, focus SHALL move to the adjacent tab in the tablist order without
  changing the active module until the operator presses Enter or Space on the
  focused tab.
- When an operator presses Home or End while focus is inside the tablist, focus
  SHALL move to the first or last tab respectively without changing the active
  module until the operator presses Enter or Space on the focused tab.
- When an operator presses Enter or Space on a focused module tab, the Cockpit
  SHALL switch to that module with the same behavior as a click on the tab.

### Focus visibility and contract verification

- When any module tab receives `:focus-visible` during keyboard-only traversal,
  the tab SHALL display a `2px solid var(--accent)` outline with `2px` offset
  that remains visible against the eggshell `--surface-primary` background
  including on the active inverted tab fill.
- When qa-tester executes manual keyboard-only verification on module tabs,
  contract `ux.module-tab-focus` SHALL pass with Enter and Space activation and
  a visible accent focus ring on each tab stop.
- When qa-tester completes keyboard-only module switching across all four tabs,
  audit finding F-09 SHALL resolve with documented manual verification evidence.

### Automated and touch-set gates

- When `client/src/app/page.test.tsx` runs module tab tests, the suite SHALL
  assert tablist and tab roles, roving tabindex, manual arrow-key focus
  behavior, and Enter or Space activation without regressing unrelated cockpit
  modules.
- When implementers modify the repository for this Feature, changes SHALL
  remain within `client/` paths for Cockpit shell layout, related styles, and
  tests and SHALL NOT introduce repo-wide refactors outside that touch set.

## Out of scope

- Pipeline empty-run panel placeholders per source directive (audit F-02,
  feature `cockpit-v2-pipeline-empty-states`).
- Maintenance preset legibility, Files tab typography de-emphasis, inbox mobile
  layout, compliance table scroll, and active-memory expand per source directive
  (audit F-03 through F-08, F-10 through F-12, feature
  `cockpit-v2-craft-polish-pass`).
- Backend API routes, `pan` CLI changes, or persona or pipeline edits per
  source directive.
- P10 artifact modal flows or stage-status color exercises not covered by module
  tab navigation per source directive.
- Full cockpit redesign, palette changes, or non-tab accessibility work outside
  the F-01 and F-09 audit findings.

## Open questions

_(none — directive, design audit F-01 and F-09, and ratified ux-spec supply sufficient scope for plan-stage delegation)_
