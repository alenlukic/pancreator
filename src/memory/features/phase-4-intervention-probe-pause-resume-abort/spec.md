---
title: Phase 4 Intervention Probe (Pause, Resume, Abort)
feature_id: phase-4-intervention-probe-pause-resume-abort
status: ready-for-plan
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
nested_task_id: 71096_0415_phase-4-intervention-probe-pause-resume-abort
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: approved
  channel: operator_cursor_chat
  note: |
    The intake-analyst opted out of the clarifying-question loop because the
    source directive is fully specified. The directive enumerates three ordered
    required-execution steps, four acceptance criteria, and three explicit
    non-goals. No material ambiguity blocks canonicalization. The nested task id
    `71096_0415_phase-4-intervention-probe-pause-resume-abort` was produced by
    `tess run feature-delivery phase-4-intervention-probe.md` during intake and
    is recorded directly in this spec's acceptance criteria and citations.
references:
  - kind: lines
    path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
    range: [19, 23]
    contentHash: 970e45f
    note: "Source directive problem statement: Phase 4 exit requires a second real feature-delivery invocation that exercises tess pause, tess resume, and tess abort against live ledger state."
  - kind: lines
    path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
    range: [25, 29]
    contentHash: 970e45f
    note: "Source directive goal statement: start tess run feature-delivery on this inbox item, advance to live plan, then pause, resume, and abort before implementation; record outcomes in pause-resume-abort-evidence.json."
  - kind: lines
    path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
    range: [31, 37]
    contentHash: 970e45f
    note: "Source directive non-goals: SHALL NOT substitute for the end-to-end proof-bundle run, SHALL NOT start Phase 5, empirical execution belongs to nested slice after scaffold review."
  - kind: lines
    path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
    range: [39, 43]
    contentHash: 970e45f
    note: "Source directive required execution: three ordered steps—run pipeline through intake into plan, capture state snapshots before/after each CLI intervention, populate pause-resume-abort-evidence.json."
  - kind: lines
    path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md
    range: [45, 51]
    contentHash: 970e45f
    note: "Source directive acceptance criteria: four items gating pause→paused, resume→prior stage, abort→aborted, and evidence paths referenced from phase-4-proof-bundle.md."
  - kind: lines
    path: src/memory/features/us-1-dogfood-phase-4-exit/spec.md
    range: [208, 232]
    contentHash: 8796dd7
    note: "Parent feature spec acceptance group 'Empirical pause, resume, and abort exercise' declares the eight criteria this Feature's evidence must satisfy, including task id, timestamps, state diffs, and run-log citations."
  - kind: lines
    path: src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md
    range: [27, 35]
    contentHash: 1801f6f
    note: "Proof-bundle intervention-probe section declares the directive path, archive-local run directory, run log, and structured evidence target pause-resume-abort-evidence.json."
---

# Spec

This Feature SHALL produce the empirical pause, resume, and abort evidence
that satisfies the acceptance group at
`{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [208, 232], contentHash: 8796dd7}`.

The nested `feature-delivery` Pipeline run, identified by task id
`71096_0415_phase-4-intervention-probe-pause-resume-abort`, SHALL advance through
the intake and plan stages and then halt at a live plan stage for CLI
intervention, per the source directive goal at
`{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [25, 29], contentHash: 970e45f}`.

The operator SHALL capture state snapshots before and after each CLI
intervention and populate
`src/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json`
with task id, timestamps, stage identifiers, reasons, state diffs, and
`run.log.jsonl` event citations, per the source directive at
`{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [39, 43], contentHash: 970e45f}`.

## Acceptance criteria

- When the operator invokes `tess pause 71096_0415_phase-4-intervention-probe-pause-resume-abort`
  at a live plan stage, the Pipeline ledger state MUST transition to `paused` and
  the evidence record MUST list the task identifier, the originating stage, the
  timestamp of the pause, and the state diff captured before and after the pause,
  per the source directive at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [47, 47], contentHash: 970e45f}`.

- When the operator invokes `tess resume 71096_0415_phase-4-intervention-probe-pause-resume-abort`
  on the paused run, the Pipeline ledger state MUST transition back to the prior
  plan stage and the evidence record MUST list the task identifier, the resumed
  stage, the timestamp of the resume, and the state diff captured before and
  after the resume, per the source directive at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [48, 48], contentHash: 970e45f}`.

- When the operator invokes `tess abort 71096_0415_phase-4-intervention-probe-pause-resume-abort --reason <text>`
  after resume and before any implement stage begins, the Pipeline ledger state
  MUST transition to `aborted` and the evidence record MUST list the task
  identifier, the aborted stage, the abort reason text, the timestamp of the
  abort, and the state diff captured before and after the abort, per the source
  directive at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [49, 49], contentHash: 970e45f}`.

- When every intervention record is complete, the evidence file paths MUST be
  referenced from `src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md`
  per the proof-bundle index at
  `{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md, range: [27, 35], contentHash: 1801f6f}`.

- When the operator populates `pause-resume-abort-evidence.json`, each
  intervention record MUST cite matching `run.log.jsonl` event identifiers from
  `src/internal/work_archive/172988_05-18-26/71096_0415_phase-4-intervention-probe-pause-resume-abort/run.log.jsonl`
  per the parent spec acceptance group at
  `{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [228, 232], contentHash: 8796dd7}`.

## Out of scope

- This Feature SHALL NOT substitute for the end-to-end nested proof-bundle-index
  run, per the source directive non-goal at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [33, 33], contentHash: 970e45f}`.

- Phase 5 M1 backlog delivery SHALL NOT start during or after this Feature's
  pipeline run, per the source directive non-goal at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [35, 35], contentHash: 970e45f}`.

- Empirical CLI execution for pause, resume, and abort transitions belongs to the
  nested feature slice after scaffold review completes, per the source directive
  non-goal at
  `{kind: lines, path: src/inbox/archive/in/172990_05-16-26/86400_0000_phase-4-intervention-probe.md, range: [37, 37], contentHash: 970e45f}`.

- This Feature SHALL NOT modify any artifact under
  `src/memory/features/us-1-dogfood-phase-4-exit/` other than
  `pause-resume-abort-evidence.json` and the proof-bundle index update required
  by the final acceptance criterion.

## Open questions

_None. The clarifying-question loop was not opened; the source directive is
fully specified. See `intake_closure.note` in the frontmatter._
