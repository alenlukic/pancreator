---
title: Cockpit v2 active memory operator readability Engineering Spec
feature_id: cockpit-v2-active-memory-operator-readability
task_id: 919_2344_cockpit-v2-active-memory-operator-readability
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
depends_on:
  - cockpit-v2-ux-spec-and-information-architecture
  - cockpit-v2-active-memory-inbox-triage-multi-run-view
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines four required outcomes, nine acceptance checks, explicit out-of-scope boundaries, a client-only touch set, and ratified ux-spec and design-audit authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates human-readable active-feature label, verb-plus-object refresh CTA, expandable blockers excerpt, and locale-formatted refresh timestamp with machine-checkable acceptance criteria.
  - Design audit run 37575_2342 records major findings F-01 and F-02 and minor findings F-05 and F-10 for the Active memory panel; this Feature bounds scope to those findings only.
  - The directive permits CTA label and expand-mode alternatives within acceptance criteria; plan stage SHALL pick one concrete implementation per alternative without reopening scope.
references:
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [44, 46]
    note: Source directive Problem section states raw inbox path, banned CTA label, truncated blockers, and raw ISO timestamp violations.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [48, 50]
    note: Source directive Goal section bounds operator-readable Active memory panel to clear audit F-01, F-02, F-05, and F-10.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [52, 58]
    note: Source directive Required outcomes enumerate primary label, CTA rename, expand affordance, timestamp formatting, and snapshot metadata.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [60, 70]
    note: Source directive Acceptance criteria anchor DOM probe, idle copy, secondary path, CTA label, aria-describedby, expand toggle, locale timestamp, and design-craft gates.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [72, 78]
    note: Source directive Out of scope excludes pipeline empty states, craft polish, module tabs, pan CLI, and P10 modal work.
  - kind: lines
    path: lib/inbox/in/172967_06-08-26/945_2344_cockpit-v2-active-memory-readability.md
    range: [80, 88]
    note: Source directive Touch set lists ActiveMemoryHeader, active-memory service, snapshot type, API route, styles, and tests.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [59, 67]
    note: Design audit F-01 observation and recommended human-label primary text fix for ActiveMemoryHeader.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [69, 77]
    note: Design audit F-02 observation and recommended verb-plus-object CTA rename with aria-describedby.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [99, 107]
    note: Design audit F-05 observation and recommended expand toggle or Files deep link for blockers excerpt.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [149, 157]
    note: Design audit F-10 observation and recommended locale or relative refresh timestamp formatting.
  - kind: lines
    path: .pan/work/172967_06-08-26/37575_2342_cockpit-design-audit-delivery/cockpit-design-audit.md
    range: [206, 210]
    note: Design audit recommended Feature A scope and acceptance for active memory operator readability.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [128, 136]
    note: Design-craft information hierarchy forbids raw paths and timestamps as primary displayed content.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [142, 147]
    note: Design-craft controls forbid banned vague labels including Refresh procedure.
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [203, 209]
    note: Design-craft gate-blocking conditions #2 raw-data exposure and #3 ambiguous CTA for this panel.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [117, 121]
    note: Ratified shared affordances require dashed empty states, recovery CTAs, and operator-readable panel copy.
  - kind: lines
    path: lib/memory/active/current.md
    range: [36, 38]
    note: Active Feature section supplies the inbox path that loadActiveMemory parses today.
  - kind: lines
    path: client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx
    range: [49, 73]
    note: Current Active memory panel renders raw path, blockers excerpt, ISO timestamp, and Refresh procedure CTA.
  - kind: lines
    path: client/src/services/active-memory.ts
    range: [38, 46]
    note: loadActiveMemory extracts activeFeaturePath from current.md Active Feature section only.
  - kind: lines
    path: client/src/services/inbox.ts
    range: [12, 28]
    note: Existing extractTitle and deriveSlugFromFilename helpers for inbox frontmatter and filename parsing.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [300, 304]
    note: ActiveMemorySnapshot type fields activeFeaturePath, blockersSummary, and refreshTimestamp.
  - kind: lines
    path: client/src/app/globals.css
    range: [1103, 1118]
    note: Active memory path monospace styling and blockers three-line clamp without expand affordance.
  - kind: lines
    path: client/src/app/page.test.tsx
    range: [1181, 1191]
    note: Existing dashboard test asserts raw path and ISO timestamp text that this Feature SHALL update.
---

# Spec

This Feature SHALL make the Cockpit v2 Active memory panel operator-readable by
replacing raw repo paths and ISO timestamps with human labels, renaming the
refresh CTA to verb-plus-object wording, and adding an accessible expand
affordance for truncated blockers per design audit run 37575_2342 findings
F-01, F-02, F-05, and F-10. The panel SHALL satisfy design-craft
gate-blocking conditions #2 and #3 and SHALL limit edits to the declared
client touch set without changing `lib/memory/active/current.md` authoring
format beyond read and parse needs.

## Acceptance criteria

### Active-feature label and idle state

- When an operator loads `/` at a 1280px by 900px viewport, the primary label
  element under the Active memory heading (`.active-memory-path` or successor)
  SHALL display a human-readable inbox title or feature slug and SHALL NOT
  display a raw `lib/inbox/in/...` path as first-read text.
- When `activeFeaturePath` is null or `(none)`, the panel SHALL show
  operator-facing idle copy such as “No active feature — triage inbox or start
  a run” instead of `(none)` or a bare repo path.
- When an active feature path is present, the full repo-relative path SHALL
  remain available as secondary truncated metadata with a copy affordance and
  SHALL NOT be the primary displayed content.

### Refresh CTA and timestamp

- When the refresh procedure button renders, the button label SHALL use
  verb-plus-object wording (for example “Open refresh procedure” or “View
  active-memory steps”) and SHALL NOT use the banned label “Refresh procedure”.
- When the refresh procedure button renders, the button MAY retain
  `data-testid="active-memory-refresh-procedure"` for test stability.
- When `refreshTimestamp` is present, the refresh procedure button SHALL
  expose `aria-describedby` referencing the refreshed timestamp element id.
- When the footer timestamp renders, the visible text SHALL use a locale or
  relative human-readable form (for example “Refreshed 12 minutes ago”) and the
  raw ISO value SHALL appear only in a `datetime` attribute, not as primary
  displayed text.

### Blockers excerpt expansion

- When `blockersSummary` exceeds three visible lines, the panel SHALL offer an
  accessible expand toggle or link that reveals the full summary in-panel or
  opens `lib/memory/active/current.md` in the Files modal.
- When the expand control is activated, the expanded state SHALL expose the
  full blockers summary text or SHALL navigate to `current.md` with keyboard
  operability and a visible focus indicator.

### Snapshot metadata and design QA gates

- When `loadActiveMemory` builds the snapshot, the service SHALL supply parsed
  title or slug metadata (for example `activeFeatureLabel` and optional
  `activeFeatureSlug`) without exposing raw paths as the first-read field in
  the API response consumed by `ActiveMemoryHeader`.
- When design-reviewer evaluates the Active memory panel after implementation,
  design-craft gate-blocking conditions #2 (raw-data exposure) and #3
  (ambiguous CTA) SHALL pass for this surface.
- When implementers modify the repository for this Feature, changes SHALL
  remain within the source directive touch set under `client/` and SHALL NOT
  introduce unrelated module refactors.

### Automated verification

- When `client/src/app/page.test.tsx` runs active memory header tests, the suite
  SHALL assert human-readable primary label text, idle copy, verb-plus-object
  CTA label, locale or relative timestamp display, and expand affordance
  behavior without regressing unrelated cockpit modules.
- When `client/src/app/api/active-memory/route.test.ts` runs, the suite SHALL
  assert snapshot fields include parsed label metadata when an active feature
  path is set.

## Out of scope

- Pipeline stage grid and timeline empty states per source directive (audit
  F-03, feature `cockpit-v2-pipeline-empty-states`).
- Files secondary tab typography, inbox mobile action layout, compliance table
  scroll, automations row metadata, and pre-close disabled affordance per
  source directive (audit F-04, F-06, F-07, F-08, F-09, feature
  `cockpit-v2-craft-polish-pass`).
- Module tab WAI-ARIA pattern per source directive (resolved in
  `cockpit-v2-module-tab-accessibility`).
- `pan` CLI changes, persona or pipeline edits, or edits to
  `lib/memory/active/current.md` authoring format beyond read and parsing
  needs per source directive.
- P10 artifact modal flows, stage-status color exercises, or backend APIs
  outside `/api/active-memory` snapshot fields per source directive.

## Open questions

_(none — directive, design audit F-01, F-02, F-05, and F-10, and ratified ux-spec supply sufficient scope for plan-stage delegation)_
