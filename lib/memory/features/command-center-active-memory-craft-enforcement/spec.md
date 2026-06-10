---
title: Command Center active memory craft enforcement Engineering Spec
feature_id: command-center-active-memory-craft-enforcement
task_id: 82780_0100_command-center-active-memory-craft-enforcement
program: command-center
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
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
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines five required outcomes, eleven acceptance checks, explicit out-of-scope boundaries, a client-only touch set, and ratified design-audit and design-craft authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates path metadata hiding, CTA rename, solid panel chrome, blockers chip summarization, accent demotion, and F-05/F-10 regression guards with machine-checkable acceptance criteria.
  - Design audit run 82901_0058 records five remaining P1 gate failures F-01, F-02, F-09, F-11, and F-12 on the Active memory panel after the command-center-active-memory-operator-readability implement pass remediated F-05 and F-10.
  - The directive permits copy-only icon versus closed disclosure and CTA label alternatives within acceptance criteria; plan stage SHALL pick one concrete implementation per alternative without reopening scope.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [46, 64]
    note: Source directive Problem section states five remaining design-craft gate failures on the Active memory panel.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [66, 72]
    note: Source directive Goal section bounds craft enforcement to gates #2, #3, #9, #11, and #12 without F-05 or F-10 regression.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [74, 96]
    note: Source directive Required outcomes enumerate path hiding, CTA rename, solid chrome, blockers chips, accent demotion, and regression guard.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [98, 157]
    note: Source directive Acceptance criteria anchor DOM probes for gates #2, #3, #9, #11, #12, F-05/F-10 retention, and design QA gate.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [159, 167]
    note: Source directive Out of scope excludes Features B and C, pan CLI, current.md format changes, and palette redesign.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/82800_0059_command-center-active-memory-craft-enforcement.md
    range: [169, 176]
    note: Source directive Touch set lists ActiveMemoryHeader, active-memory service, snapshot types, API route, styles, and tests.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [63, 72]
    note: Design audit F-01 observation and recommended copy-only path or disclosure fix.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [74, 83]
    note: Design audit F-02 observation and recommended verb-plus-object CTA rename with aria-describedby.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [95, 104]
    note: Design audit F-09 observation and recommended solid elevated card chrome for active-memory-header.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [116, 125]
    note: Design audit F-11 observation and recommended blockers chip or compact bullet summarization.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [127, 136]
    note: Design audit F-12 observation and recommended ghost or text-link demotion for Copy path control.
  - kind: lines
    path: .pan/work/172966_06-09-26/82901_0058_command-center-design-audit-delivery/command-center-design-audit.md
    range: [170, 178]
    note: Design audit Feature A recommended scope and acceptance for remaining gate failures.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [213, 249]
    note: Design-craft gate-blocking conditions #2, #3, #9, #11, and #12 for this panel.
  - kind: lines
    path: lib/memory/features/command-center-active-memory-operator-readability/delivery-report.md
    range: [1, 40]
    note: Prior Feature delivery report documents F-05 and F-10 remediation that this Feature SHALL retain.
  - kind: lines
    path: client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx
    range: [174, 205]
    note: Current Active memory panel renders visible path text, banned CTA label, and dual accent buttons.
  - kind: lines
    path: client/src/services/active-memory.ts
    range: [100, 118]
    note: summarizeBlockers joins list items into multi-sentence prose that F-11 rejects.
  - kind: lines
    path: client/src/app/globals.css
    range: [1082, 1085]
    note: active-memory-header uses dashed border that gate #9 rejects.
  - kind: lines
    path: lib/memory/active/current.md
    range: [55, 62]
    note: Risks and blockers section supplies multi-sentence source prose the panel SHALL summarize.
---

# Spec

This Feature SHALL close the five remaining human-ratified design-craft gate failures
on the Command Center Active memory panel per design audit run 82901_0058 findings
F-01, F-02, F-09, F-11, and F-12. The panel SHALL hide readable repo-relative
path text in the default view, rename the refresh CTA off the banned list, replace
dashed wireframe chrome with solid elevated surfaces, render blockers as chip rows
or compact bullets, and reserve accent fill for exactly one primary action per
region while retaining the F-05 expand toggle and F-10 relative timestamp from
`command-center-active-memory-operator-readability`.

## Acceptance criteria

### Gate #2 — raw-data exposure (F-01)

- When an operator loads `/` at a 1280px by 900px or 375px by 812px viewport, a
  DOM probe of `.active-memory-header` SHALL report `containsLibInbox: false` for
  visible text nodes in the default collapsed view.
- When an active feature path exists, the panel SHALL display a human-readable
  inbox title or filename-derived slug as secondary metadata and SHALL NOT render
  `lib/inbox/in/` as readable monospace text in the default view.
- When the operator needs the full path, a copy-only icon control or a
  closed-by-default "Path details" disclosure SHALL provide it without rendering
  the path string as visible text.

### Gate #3 — banned CTA (F-02)

- When the refresh procedure button renders, its visible label SHALL NOT be
  `Open refresh procedure`, `Refresh procedure`, or any other banned vague label
  from `design-craft.md` gate #3.
- When the refresh procedure button renders, the label SHALL name an imperative
  verb plus a concrete target (for example `Open OPERATION.md` or
  `View active-memory steps`).
- When `refreshTimestamp` is present, the button SHALL retain `aria-describedby`
  referencing the `<time>` element id.

### Gate #9 — wireframe composition (F-09)

- When `.active-memory-header` is inspected, computed `borderStyle` SHALL NOT be
  `dashed` in the shipped default state.
- When the panel renders, it SHALL use a solid elevated surface treatment scoped
  to orientation-panel card chrome and SHALL NOT alter inbox triage or multi-run
  panel borders outside this Feature touch set.

### Gate #11 — internal prose dump (F-11)

- When blockers content is present, the collapsed view SHALL render summarized
  chip rows or compact bullets and SHALL NOT render multi-sentence
  `current.md` source prose.
- When a DOM probe counts sentences in `.active-memory-blockers` visible text,
  `blockersSentenceCount` SHALL be at most 1 per chip or bullet item, with each
  item at most 60 characters before truncation.
- When the expand toggle activates, the expanded content SHALL show the same
  summarized chip or bullet structure and SHALL NOT show unmodified source prose.
- When blockers are summarized, the panel or Files affordance SHALL link to
  `lib/memory/active/current.md` for full source text.

### Gate #12 — accent sprawl (F-12)

- When `.active-memory-header` is inspected, `accentButtonCount` (elements with
  `command-center-action-button` accent fill) SHALL equal exactly 1.
- When `Copy path` or a copy-only icon renders, it SHALL use ghost or text-link
  emphasis and SHALL NOT use accent fill.

### Regression — F-05 and F-10 (retain)

- When `blockersSummary` exceeds three visible lines, the `Show full blockers` /
  `Show less` toggle SHALL remain with correct `aria-expanded` behavior.
- When `refreshTimestamp` is present, visible footer text SHALL use relative or
  locale phrasing (for example `Refreshed 17 minutes ago`) with ISO only in the
  `datetime` attribute (`isoInPanel: null`).

### Snapshot metadata and design QA gates

- When `loadActiveMemory` builds the snapshot, the service SHALL supply parsed
  blockers as structured chip or bullet items (for example `blockerItems: string[]`)
  instead of a single joined prose string consumed by `ActiveMemoryHeader`.
- When design-reviewer re-audits the Active memory panel after implementation,
  design-craft gate-blocking conditions #2, #3, #9, #11, and #12 SHALL pass and
  `design_qa_passes` SHALL be true for this surface.
- When implementers modify the repository for this Feature, changes SHALL remain
  within the source directive touch set under `client/` and SHALL NOT introduce
  unrelated module refactors.

### Automated verification

- When `client/src/app/page.test.tsx` runs active memory header tests, the suite
  SHALL assert hidden path text in default view, non-banned CTA label, solid
  border treatment, blockers chip structure, single accent button, and retained
  expand toggle and relative timestamp behavior without regressing unrelated
  Command Center surfaces.
- When `client/src/app/api/active-memory/route.test.ts` runs, the suite SHALL
  assert snapshot fields include structured blocker items when blockers content
  is present.

## Out of scope

- Inbox triage, multi-run table, module tabs, Pipeline empty states, Maintenance
  toolkit, Automations wizard, and Files secondary tab per source directive
  (audit Features B and C).
- `pan` CLI changes, persona or pipeline edits, or handbook edits per source
  directive.
- `lib/memory/active/current.md` authoring format changes beyond read and parse
  for blocker summarization per source directive.
- Palette redesign or new API routes outside `/api/active-memory` snapshot fields
  per source directive.
- Inbox triage and multi-run panel dashed-border styling unless a plan-stage ADR
  explicitly bundles them; this Feature scopes gate #9 to `.active-memory-header`
  only per touch set.

## Open questions

_(none — directive, design audit F-01, F-02, F-09, F-11, and F-12, ratified
design-craft gates, and prior operator-readability delivery supply sufficient
scope for plan-stage delegation)_
