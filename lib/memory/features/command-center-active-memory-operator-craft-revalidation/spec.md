---
title: Command Center active memory operator craft revalidation Engineering Spec
feature_id: command-center-active-memory-operator-craft-revalidation
task_id: 77283_0231_command-center-active-memory-operator-craft-revalidation
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
depends_on:
  - command-center-active-memory-operator-readability
  - command-center-ux-spec-and-information-architecture
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines seven required outcomes, eight machine-checkable acceptance checks, explicit out-of-scope boundaries, a client-only touch set, and ratified design-audit and design-craft authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates gate failures F-00, F-01, F-02, F-05, F-09, F-10, and F-11 with machine-checkable acceptance criteria and a bounded client touch set.
  - Design audit run 83950_0830 re-scored the reverted HEAD Active memory panel and records P0/P1 failures under tightened design-craft gates 1–12; this Feature closes Feature A scope only.
  - F-05 and F-10 are regressions from command-center-active-memory-operator-readability; plan stage SHALL restore those remediations without reopening scope.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [55, 66]
    note: Source directive Problem section lists F-00, F-01, F-02, F-04, F-05, F-09, F-10, and F-11 gate failures on the Active memory panel.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [68, 74]
    note: Source directive Goal section bounds work to design-craft gates 1, 2, 3, 5, 9, and 11 and F-05/F-10 regression restoration.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [76, 93]
    note: Source directive Required outcomes enumerate path disclosure, CTA rename, blockers expand, timestamp format, solid chrome, blockers summarization, and containment.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [95, 139]
    note: Source directive Acceptance criteria anchor DOM probes, CTA label, aria-describedby, expand toggle, time element, border style, chip rows, overflow, and design_qa_passes.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [141, 146]
    note: Source directive Out of scope excludes Features B and C, pan CLI, current.md format, palette redesign, and audit-pipeline client mutations.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/81282_0125_command-center-active-memory-operator-craft-revalidation.md
    range: [148, 155]
    note: Source directive Touch set lists ActiveMemoryHeader, active-memory service, run-state-shared, API route, globals.css tokens, and page tests.
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [55, 62]
    note: Design audit F-00 containment overflow at desktop viewport (gate 1).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [63, 72]
    note: Design audit F-01 raw inbox path exposure in default view (gate 2).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [74, 83]
    note: Design audit F-02 banned Refresh procedure CTA label (gate 3).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [95, 104]
    note: Design audit F-09 dashed wireframe border on active-memory-header (gate 9).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [99, 107]
    note: Design audit F-05 missing blockers expand affordance (operator-readability regression).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [116, 125]
    note: Design audit F-11 multi-sentence blockers prose dump (gate 11).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [127, 136]
    note: Design audit F-10 raw ISO refresh timestamp (operator-readability regression).
  - kind: lines
    path: .pan/work/172966_06-09-26/83950_0830_command-center-design-audit-validation/command-center-design-audit.md
    range: [170, 192]
    note: Design audit Feature A recommended scope and machine-checkable acceptance for validation run.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [206, 249]
    note: Human-ratified gate-blocking conditions 1–12 for Active memory panel enforcement.
  - kind: lines
    path: lib/memory/features/command-center-active-memory-operator-readability/spec.md
    range: [119, 128]
    note: Prior Feature spec for operator-readable Active memory panel remediations that this revalidation restores.
  - kind: lines
    path: lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md
    range: [117, 121]
    note: Ratified shared affordances require operator-readable panel copy and recovery CTAs.
---

# Spec

This Feature SHALL close all P0 and P1 design-craft gate failures on the Command Center
v2 Active memory panel so `design-reviewer` can set `design_qa_passes: true` for
Feature A under tightened enforcement per design audit run
83950_0830. The panel SHALL remove raw path and ISO timestamp exposure, rename
the refresh CTA off the banned list, restore blockers expand and relative
timestamp remediations from
`command-center-active-memory-operator-readability`, replace dashed wireframe
chrome with solid elevated card styling, summarize blockers as chips or compact
bullets, and fix column containment at 1280px and 375px viewports. Changes
SHALL remain within the declared `client/` touch set without altering
`lib/memory/active/current.md` authoring format.

## Acceptance criteria

### Gate 2 — raw-data exposure (F-01)

- When an operator loads `/` at a 1280px by 900px or 375px by 812px viewport, a
  DOM probe of `.active-memory-header` SHALL report `containsLibInbox: false` for
  visible text nodes in the default collapsed view.
- When an active feature path is present, the panel SHALL display an inbox title
  or semantic feature slug as the first-read label and SHALL expose the full
  repo-relative path only through a copy-only icon control or a closed-by-default
  disclosure.

### Gate 3 — banned CTA (F-02)

- When the refresh procedure button renders, the button label SHALL NOT match any
  entry on the banned list in `design-craft.md` (including "Refresh procedure"
  and "Open refresh procedure") and SHALL name a concrete target such as
  `OPERATION.md`.
- When the refresh procedure button renders, the button SHALL expose
  `aria-describedby` referencing the refreshed timestamp element id.

### F-05 — blockers expand affordance (regression)

- When `blockersSummary` exceeds three visible lines, the panel SHALL offer
  `data-testid="active-memory-blockers-toggle"` or an equivalent accessible
  expand control that reveals the full summary in-panel or opens
  `lib/memory/active/current.md` in the Files modal.

### F-10 — relative timestamp (regression)

- When the footer timestamp renders, the visible text SHALL use a locale or
  relative human-readable form and a `<time datetime="…">` element SHALL carry
  the raw ISO value without displaying the ISO string as primary text.

### Gate 9 — solid chrome (F-09)

- When `.active-memory-header` renders, computed `border-style` on the header
  element SHALL NOT be `dashed` and SHALL match solid elevated card chrome used
  by adjacent sidebar panels.

### Gate 11 — blockers summarization (F-11)

- When blockers content renders, the panel SHALL display `.active-memory-blocker-chip`
  rows or compact bullet items and SHALL NOT render a single paragraph of
  multi-sentence `current.md` source prose.

### Gate 1 — containment (F-00)

- When an operator loads `/` at a 1280px by 900px viewport, a DOM probe SHALL
  report `overflow: false` for `.active-memory-header` within its parent column.

### Gate 5 — information hierarchy (F-04)

- When the Active memory panel renders with an active feature, the first-read
  label element SHALL be visually dominant over secondary metadata and the full
  repo-relative path SHALL NOT compete as equal-weight primary content.

### Design QA gate

- When `design-reviewer` re-audits the Active memory panel after implementation,
  no P0 or P1 finding SHALL remain on that surface and `design_qa_passes` SHALL
  be `true`.

### Automated verification

- When `client/src/app/page.test.tsx` runs Active memory header tests, the suite
  SHALL assert gate 2 path concealment, gate 3 CTA label and `aria-describedby`,
  F-05 expand affordance, F-10 relative timestamp with `<time>`, gate 9 non-dashed
  border, gate 11 chip or bullet blockers, and gate 1 containment without
  regressing unrelated Command Center surfaces.
- When implementers modify the repository for this Feature, changes SHALL remain
  within the source directive touch set under `client/` and SHALL NOT introduce
  unrelated module refactors.

## Out of scope

- Inbox triage row choice overload (Feature B, design-craft gate 10) per source
  directive.
- Module tab WAI-ARIA pattern (Feature C,
  `command-center-module-tab-accessibility`) per source directive.
- `pan` CLI changes, persona or pipeline edits, or edits to
  `lib/memory/active/current.md` authoring format beyond read and parsing needs
  per source directive.
- Palette redesign or global typography changes outside active-memory-header
  tokens in `client/src/app/globals.css` per source directive.
- `client/` mutations performed by the command-center-design-audit-validation audit
  pipeline itself; this Feature delivers fixes through feature-delivery implement
  stage within the declared touch set per source directive.

## Open questions

_(none — directive, design audit Feature A scope, design-craft gates 1–12, and prior operator-readability spec supply sufficient scope for plan-stage delegation)_
