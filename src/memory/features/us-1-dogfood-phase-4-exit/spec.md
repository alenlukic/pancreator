---
title: US-1 Dogfood Phase 4 Exit Intake Spec
feature_id: us-1-dogfood-phase-4-exit
status: ready-for-plan
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: src/inbox/in/us-1-dogfood-phase-4-exit.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: approved
  channel: operator_cursor_chat
  note: |
    The intake-analyst opted out of the clarifying-question loop because the
    source directive enumerates five required-execution sections, ten
    acceptance criteria, five operator manual-validation actions, and three
    explicit non-goals. No material ambiguity blocks canonicalization. The
    directive grants two minor implementation choices: which external
    observability tool to use (Phoenix or Langfuse) and the exact second-run
    scenario for the pause/resume/abort exercise. Those choices route to the
    plan stage as declared decision slots rather than as open intake
    questions.
intake_notes:
  - The source inbox item frontmatter at line 1 carries a leading "f"
    character before the YAML delimiter. The intake-analyst MUST NOT edit
    `src/inbox/in/us-1-dogfood-phase-4-exit.md` per the persona contract.
    Citations target the file as written; the frontmatter typo blocks YAML
    parsing but does not block intake canonicalization because the body
    enumerates every required outcome.
  - The directive uses the phrase "such as Phoenix or Langfuse" for the
    external observability tool. This spec narrows the choice to "either
    Phoenix or Langfuse" to satisfy the Layer 1 atomic-clause rule, because
    `docs/BOOTSTRAP.md` Phase 4 enumerates exactly those two tools at
    lines 241 to 242 and the glossary defines run-log conformance against
    the same pair.
  - The directive references `tess pause`, `tess resume`, and `tess abort`.
    `AGENTS.md` lines 248 to 253 record that the `@tesseract/cli` runtime
    exposes those verbs through `tess run` and `tess advance` orchestration
    today. The plan stage owns the choice of dogfood scenario that exercises
    each verb.
references:
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [1, 18]
    contentHash: 414a8f4
    note: "Source directive frontmatter declares feature id, intake owner, status, and the BOOTSTRAP, M1 index, and AGENTS reference set."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [22, 36]
    contentHash: 414a8f4
    note: "Source directive problem statement enumerates the five open Phase 4 gaps that block Phase 5 M1 backlog work."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [38, 42]
    contentHash: 414a8f4
    note: "Source directive goal statement scopes the slice to closing the Phase 4 bootstrap gate with empirical proof artifacts."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [44, 51]
    contentHash: 414a8f4
    note: "Source directive non-goals forbid Phase 5 backlog start, redefinition of Phase 4 exit criteria, and acceptance of simulated or partial runs."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [55, 70]
    contentHash: 414a8f4
    note: "Source directive section 1 specifies the canonical US-1 dogfood flow that walks an inbox item through intake, plan, implement, review, report, ship, and index."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [72, 77]
    contentHash: 414a8f4
    note: "Source directive section 2 specifies capture of a run log from the real dogfood flow and verification that the trace renders cleanly in an external observability tool."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [79, 84]
    contentHash: 414a8f4
    note: "Source directive section 3 specifies a second controlled dogfood exercise that empirically exercises `tess pause`, `tess resume`, and `tess abort`."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [86, 95]
    contentHash: 414a8f4
    note: "Source directive section 4 enumerates the Phase 4 proof bundle: staged PR outcome, delivery report under `src/inbox/out/`, clean external run trace, intervention evidence, and residual-gap statement."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [97, 101]
    contentHash: 414a8f4
    note: "Source directive section 5 requires explicit human ratification of the Phase 4 exit before any Phase 5 M1 backlog work begins."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [103, 120]
    contentHash: 414a8f4
    note: "Source directive enumerates ten acceptance criteria the proof bundle and the human-ratification gate MUST satisfy."
  - kind: lines
    path: src/inbox/in/us-1-dogfood-phase-4-exit.md
    range: [122, 132]
    contentHash: 414a8f4
    note: "Source directive enumerates the five operator manual-validation actions that gate the Phase 4 exit ratification."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [225, 245]
    contentHash: 940935e
    note: "BOOTSTRAP Phase 4 section defines the seven stage outcomes for the US-1 dogfood pipeline run, the pause/resume/abort exercise, the Phoenix-or-Langfuse run-log verification, and the staged-PR plus delivery-report exit criterion."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [248, 267]
    contentHash: 940935e
    note: "BOOTSTRAP Phase 5 section identifies the M1 backlog work the Phase 4 exit unblocks; this slice MUST NOT start that work before the Phase 4 exit ratifies."
  - kind: lines
    path: docs/M1.index.md
    range: [18, 34]
    contentHash: 63d0c43
    note: "M1 index records `bootstrap.phase: 4`, `status: phase-4-in-progress`, and the open dogfood exit gaps that this Feature closes."
  - kind: lines
    path: AGENTS.md
    range: [241, 259]
    contentHash: 03ff3cd
    note: "AGENTS bootstrap-status section records that Phase 4 remains open until the US-1 dogfood exit gaps ratify and that `tess run`, `tess advance`, and `tess close-artifacts` orchestrate Phase 4 active-work."
  - kind: lines
    path: AGENTS.md
    range: [141, 148]
    contentHash: 03ff3cd
    note: "AGENTS working-agreement clauses establish the operator-sandbox exclusion of `/src/inbox/notes/` and the in-loop reviewer obligation at every phase boundary that this spec preserves."
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [281, 283]
    contentHash: e5f5ecd
    note: "Glossary defines Run-log as the append-only OTLP stream under `/src/work/<day>/<id>/run.log.jsonl` that is the basis for Phoenix and Langfuse import."
---

# Spec

This Feature SHALL close the Phase 4 bootstrap exit gate.

This Feature SHALL run the canonical US-1 dogfood flow end-to-end through
the `feature-delivery` Pipeline.

This Feature SHALL capture the empirical evidence enumerated in the source
directive at
`{kind: lines, path: src/inbox/in/us-1-dogfood-phase-4-exit.md, range: [86, 95], contentHash: 414a8f4}`.

This Feature SHALL obtain explicit human ratification of the Phase 4 exit
before any Phase 5 M1 backlog work begins.

This Feature SHALL preserve every Persona, Skill, Pipeline, Spec Contract,
documentation-impact, policy-compliance, inbox-lifecycle, and stage-exit
obligation cited at
`{kind: lines, path: AGENTS.md, range: [141, 148], contentHash: 03ff3cd}`.

This Feature SHALL NOT start Phase 5 M1 backlog delivery, SHALL NOT redefine
the Phase 4 exit criteria, and SHALL NOT treat simulated or partial runs as
sufficient proof per the non-goals at
`{kind: lines, path: src/inbox/in/us-1-dogfood-phase-4-exit.md, range: [44, 51], contentHash: 414a8f4}`.

## Acceptance criteria

### Real US-1 dogfood run from inbox to librarian closure

- When the Feature opens the Phase 4 exit slice, the Feature MUST stage one
  new real intake item under `src/inbox/in/` and MUST NOT reuse a previously
  archived inbox item.
- When the Feature opens the dogfood run, the Feature MUST start the
  `feature-delivery` Pipeline through `tess run feature-delivery
  <inbox-entry>` per the runtime contract at
  `{kind: lines, path: AGENTS.md, range: [249, 253], contentHash: 03ff3cd}`.
- When the run reaches the intake stage, the `intake-analyst` Persona MUST
  canonicalize the directive into `src/memory/features/<id>/spec.md` and
  MUST close the clarifying loop within the 5-round cap.
- When the run reaches the plan stage, the `tech-lead` Persona MUST produce
  the plan, the ADR draft, the touch-set, and the handoff card under
  `src/work/<day>/<task-id>/`.
- When the run reaches the implement stage, the `coder` Persona MUST
  implement the approved scope inside the declared touch-set without
  exceeding the in-scope path list.
- When the run reaches the review stage, the `reviewer` Persona MUST record
  the review verdict, the must-fix count, and every contracts-runner
  outcome.
- When the run reaches the report stage, the `tech-writer` Persona MUST
  author the delivery report at the per-feature `delivery-report.md` path.
- When the run reaches the ship stage, the `supervisor` Persona MUST stage
  the local diff and MUST NOT push or open a remote pull request per the
  ship-stage contract at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [236, 240], contentHash: 940935e}`.
- When the run reaches the index stage, the `librarian` Persona MUST index
  the emitted artifacts, MUST refresh the per-feature `index.json`, and MUST
  execute `tess close-artifacts <task-id>` after human validation per the
  closure contract at
  `{kind: lines, path: AGENTS.md, range: [254, 259], contentHash: 03ff3cd}`.
- When every stage completes, the run MUST preserve the stage-boundary
  Checkpoint artifacts under `/src/work/<day>/<task-id>/` so that the path
  from the inbox item to completion remains auditable.

### External run-log observability verification

- When the dogfood run emits a Run-log, the Feature MUST capture the
  `src/work/<day>/<task-id>/run.log.jsonl` file untouched as the proof input
  for external import.
- When the Feature verifies external observability, the Feature MUST import
  the captured Run-log into either Phoenix or Langfuse per the conformance
  rule at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [241, 242], contentHash: 940935e}`.
- When the Feature verifies the external trace, the verification record
  MUST show that the trace is readable, that the span hierarchy is
  complete, and that the trace identifier attributes back to the dogfood
  task identifier.
- When the Feature stages the verification record, the record MUST include
  one screenshot or one exported trace artifact stored under the active
  task work directory or the proof bundle path declared in the plan stage.

### Empirical pause, resume, and abort exercise

- When the Feature stages the intervention exercise, the Feature MUST run a
  second `feature-delivery` Pipeline invocation distinct from the
  end-to-end run scored under the first acceptance group.
- When the second run reaches a live stage, the operator MUST invoke `tess
  pause <task-id>` and the Pipeline state MUST transition to `paused`.
- When the Feature records the pause outcome, the evidence MUST list the
  task identifier, the originating stage, the timestamp of the pause, and
  the state diff captured before and after the pause.
- When the paused run is ready to continue, the operator MUST invoke `tess
  resume <task-id>` and the Pipeline state MUST transition back to the
  prior stage.
- When the Feature records the resume outcome, the evidence MUST list the
  task identifier, the resumed stage, the timestamp of the resume, and the
  state diff captured before and after the resume.
- When the second run is ready to abort, the operator MUST invoke `tess
  abort <task-id> --reason <text>` and the Pipeline state MUST transition
  to `aborted`.
- When the Feature records the abort outcome, the evidence MUST list the
  task identifier, the aborted stage, the abort reason text, the timestamp
  of the abort, and the state diff captured before and after the abort.
- When the Feature stages every intervention record, the records MUST live
  under the proof bundle path declared in the plan stage and MUST cite the
  matching Run-log entries by event identifier.

### Phase 4 proof bundle assembly

- When the Feature assembles the Phase 4 proof bundle, the bundle MUST
  include one staged pull-request outcome for the dogfood slice without an
  auto-push.
- When the Feature assembles the proof bundle, the bundle MUST include one
  delivery report staged under `src/inbox/out/` per the
  notifier-to-outbox contract at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [243, 245], contentHash: 940935e}`.
- When the Feature assembles the proof bundle, the bundle MUST include
  one clean external run trace for the end-to-end dogfood run captured
  under the verification record from the second acceptance group.
- When the Feature assembles the proof bundle, the bundle MUST include
  the pause, resume, and abort evidence from the third acceptance group.
- When the Feature assembles the proof bundle, the bundle MUST close with
  one explicit statement that either declares the Phase 4 exit checklist
  satisfied or enumerates every residual gap with a remediation owner.

### Human ratification and Phase 5 hold

- When the Feature completes the proof bundle, the Feature MUST request
  explicit human ratification of the Phase 4 exit through one inbox-out
  message that attaches every proof-bundle artifact path.
- When the human reviews the proof bundle, the human MUST inspect the
  staged pull-request outcome, the delivery report, the external run
  trace, and the pause-resume-abort intervention evidence per the operator
  manual-validation list at
  `{kind: lines, path: src/inbox/in/us-1-dogfood-phase-4-exit.md, range: [122, 132], contentHash: 414a8f4}`.
- When the human records the decision, the human MUST either ratify the
  Phase 4 exit or record the remaining blocker list under a dated
  ratification note inside the proof bundle.
- When the ratification record marks the exit as ratified, the Feature
  MUST update `tesseract.yaml` to advance the bootstrap phase tracker
  beyond `phase-4-in-progress`.
- While the ratification record remains unsigned, the Feature SHALL NOT
  start any Phase 5 M1 backlog deliverable enumerated at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [248, 267], contentHash: 940935e}`.

### Stage and policy invariants

- When the Feature stages any structural change outside `src/work/`, the
  Feature MUST stage one `/src/work/<day>/<task-id>/policy-compliance.json`
  per the policy-compliance contract cited in `AGENTS.md` working agreement.
- When the Feature completes the slice, the Feature MUST record the
  documentation-impact decision for `AGENTS.md`, `docs/M1.index.md`,
  `tesseract.yaml`, and `src/memory/active/current.md` either as applied
  updates or as deferred items with backlog linkage.
- When the Feature reads, traverses, or cites repository content, the
  Feature MUST NOT touch any path under `/src/inbox/notes/` per the
  operator-sandbox rule at
  `{kind: lines, path: AGENTS.md, range: [141, 145], contentHash: 03ff3cd}`.
- When the Feature edits Persona specs, Persona role boundaries, Persona
  tool grants, or Persona safety constraints, the Feature MUST NOT proceed
  without explicit human ratification recorded in the proof bundle.
- When the Feature touches Persona specs, Skill packs, Pipeline definitions,
  documented operational primitives, testing infrastructure, operator
  interfaces, or milestone ratification artifacts, the Feature MUST trigger
  one compliance-run pass per the AGENTS section 6.1 obligation.

## Out of scope

- This Feature SHALL NOT start any Phase 5 M1 backlog deliverable before
  the human ratifies the Phase 4 exit proof bundle.
- This Feature SHALL NOT redefine the Phase 4 exit criteria enumerated at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [225, 245], contentHash: 940935e}`.
- This Feature SHALL NOT accept a simulated, partial, or replayed run as
  a substitute for the real end-to-end dogfood run.
- This Feature SHALL NOT push the staged dogfood pull request to any
  remote and SHALL NOT open a remote pull request before human
  ratification per the ship-stage contract at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [236, 240], contentHash: 940935e}`.
- This Feature SHALL NOT delete any file under `src/work/**`,
  `src/memory/**`, `src/inbox/out/**`, or `src/inbox/threads/**` while
  assembling the proof bundle.
- This Feature SHALL NOT read, write, traverse, or cite any path under
  `/src/inbox/notes/` per the operator-sandbox rule.
- This Feature SHALL NOT modify Persona role semantics, authority
  boundaries, tool grants, or safety constraints; persona changes route
  through `persona-designer` per the AGENTS section 3 self-protection
  rule.
- This Feature SHALL NOT wire LangGraph runtime execution, automated
  Cursor or model transport, or any deferred orchestration primitive that
  the AGENTS bootstrap-status block at lines 254 to 259 lists as not yet
  automated.

## Plan-stage decisions required

The intake stage delegates the implementation choices below to the
`tech-lead` plan stage. Each decision below resolves an explicit latitude
slot the source directive grants the implementation.

- D1. Choose the dogfood directive content for the new
  `src/inbox/in/<entry>.md` intake item. The plan stage MUST pick a slice
  small enough to fit within one feature-delivery run and large enough to
  exercise each Persona stage.
- D2. Choose the external observability tool used for the run-log
  verification: either Phoenix or Langfuse. The directive authorizes the
  implementation to choose at
  `{kind: lines, path: src/inbox/in/us-1-dogfood-phase-4-exit.md, range: [74, 77], contentHash: 414a8f4}`.
- D3. Choose the second-run scenario that exercises `tess pause`, `tess
  resume`, and `tess abort` in a live stage context. The plan stage MUST
  pick a scenario that touches a real stage rather than a no-op fixture.
- D4. Choose the proof-bundle storage path: either the per-feature
  directory at `src/memory/features/us-1-dogfood-phase-4-exit/` or a
  task-scoped subdirectory under the active work tree. The plan stage MUST
  ensure every artifact path in the bundle resolves under one declared
  root.
- D5. Choose whether to seed the Phase 5 readiness ADR under
  `src/memory/adr/` inside this slice or to defer that ADR to the first
  Phase 5 feature-delivery run.

## Deferrals

- The Feature MAY defer LangGraph runtime execution wiring per the
  AGENTS bootstrap-status note that lines 254 to 259 record as not yet
  automated.
- The Feature MAY defer automated Cursor or model transport per the same
  AGENTS bootstrap-status note.
- The Feature MAY defer additional non-US-1 Pipeline dogfood runs to a
  later Phase 5 slice when the Phase 4 exit evidence already satisfies
  every acceptance criterion in this spec.

## Cross-references

- This Feature targets the bootstrap exit gate tracked by `tesseract.yaml`
  at `bootstrap.phase: 4` and `status: phase-4-in-progress` per the M1
  index at
  `{kind: lines, path: docs/M1.index.md, range: [18, 34], contentHash: 63d0c43}`.
- This Feature drives ratification of the Phase 4 exit declared at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [225, 245], contentHash: 940935e}`,
  which unblocks the Phase 5 M1 backlog work at
  `{kind: lines, path: docs/BOOTSTRAP.md, range: [248, 267], contentHash: 940935e}`.
- This Feature SHALL register its delivery report under `src/inbox/out/`
  and its closed feature index under
  `src/memory/features/us-1-dogfood-phase-4-exit/index.json` so the
  `librarian` Persona MAY populate the full index at post_run.

## Open questions

- None.
