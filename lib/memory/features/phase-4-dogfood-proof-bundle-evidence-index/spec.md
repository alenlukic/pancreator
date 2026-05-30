---
title: Phase 4 Dogfood Proof Bundle Evidence Index
feature_id: phase-4-dogfood-proof-bundle-evidence-index
status: ready-for-plan
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: approved
  channel: operator_cursor_chat
  note: |
    The intake-analyst opted out of the clarifying-question loop because the
    source directive is fully specified. The directive enumerates three
    ordered required-execution steps, four acceptance criteria, three
    explicit non-goals, and a named proof-bundle target. No material
    ambiguity blocks canonicalization. The nested task id
    `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` was produced
    by `pan run feature-delivery phase-4-dogfood-proof-bundle-index.md`
    during intake and is recorded directly in this spec's acceptance
    criteria and citations.
references:
  - kind: lines
    path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
    range: [19, 23]
    contentHash: ccf9748
    note: "Source directive problem statement: Phase 4 exit requires one nested real feature-delivery run that produces durable proof pointers under the us-1-dogfood-phase-4-exit feature folder."
  - kind: lines
    path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
    range: [25, 30]
    contentHash: ccf9748
    note: "Source directive goal statement: run this inbox item through feature-delivery end-to-end so the implementation updates phase-4-proof-bundle.md."
  - kind: lines
    path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
    range: [32, 38]
    contentHash: ccf9748
    note: "Source directive non-goals: SHALL NOT start Phase 5, SHALL NOT redefine exit criteria, SHALL NOT accept simulated telemetry."
  - kind: lines
    path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
    range: [40, 44]
    contentHash: ccf9748
    note: "Source directive required execution: three ordered steps for intake canonicalization, proof-bundle update during implement, and run-artifact preservation."
  - kind: lines
    path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md
    range: [46, 51]
    contentHash: ccf9748
    note: "Source directive acceptance criteria: four numbered items gating the nested task on stage completion, proof-bundle population, Phoenix verification, and human ratification."
  - kind: lines
    path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md
    range: [131, 151]
    contentHash: 8796dd7
    note: "Parent feature spec Spec section declares the Phase 4 exit gate obligations this nested run satisfies as empirical proof."
  - kind: lines
    path: lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md
    range: [11, 18]
    contentHash: 1801f6f
    note: "Proof-bundle nested-dogfood table lists task id, work directory, and immutable run.log.jsonl path; librarian SHALL refresh paths after close-artifacts."
  - kind: lines
    path: work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/plan.md
    range: [1, 10]
    contentHash: d210e4a
    note: "Parent plan decision D1 scopes this nested directive as the empirical proof-bundle slice and declares the proof-bundle root."
---

# Spec

This Feature SHALL produce the nested empirical proof that satisfies the Phase 4
bootstrap exit gate for US-1 per the parent spec at
`{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [131, 151], contentHash: 8796dd7}`.

This Feature SHALL run one real `feature-delivery` Pipeline from intake to index
closure, driven by the `phase-4-dogfood-proof-bundle-index.md` source directive.

The nested pipeline's auditable artifacts SHALL populate
`lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` with
task id `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` and the
immutable path
`archive/work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl`
per the proof-bundle skeleton at
`{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md, range: [11, 18], contentHash: 1801f6f}`.

The parent Phase 4 exit gate still requires external trace verification when
tooling exists. This nested run SHALL preserve the immutable `run.log.jsonl`
path named in `phase-4-proof-bundle.md` for that future importer slice.
Phoenix import and screenshot capture are **engineering-owned** (see
`phoenix-trace-evidence.md`); they SHALL NOT be treated as operator bookkeeping
without an in-repo importer. Human ratification of the populated proof bundle
SHALL follow `phase-4-ratification-request.md` and the parent US-1 spec.

## Acceptance criteria

- When the nested `feature-delivery` Pipeline executes, the Pipeline MUST advance
  through all 7 ordered stages — intake, plan, implement, review, report, ship, and
  index — per the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [46, 48], contentHash: ccf9748}`.

- When each stage closes, the Pipeline MUST produce at least 1 auditable artifact
  per stage under the nested task work directory (canonical path after librarian
  closure:
  `archive/work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/`)
  per the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [48, 48], contentHash: ccf9748}`.

- When the implement stage closes, the `coder` Persona MUST update
  `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` to
  replace every `_pending_` placeholder with the task id
  `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` and the run-log path
  `archive/work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl`
  per the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [43, 43], contentHash: ccf9748}`.

- When the run log exists at the path above, external Phoenix import and trace
  capture SHALL satisfy the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [50, 50], contentHash: ccf9748}`
  only after the `@pancreator/run-logger` importer path exists; until then this
  criterion is **deferred** and SHALL NOT be satisfied by simulated telemetry per
  non-goals.

- When external trace tooling is available and import completes, the
  verification record MUST be written under
  `lib/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md`
  per the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [50, 50], contentHash: ccf9748}`.

- When every stage artifact exists and the Phase 4 ratification prerequisites in
  `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-ratification-request.md`
  are satisfied (including explicit handling of deferred Phoenix rows), the human
  operator MUST complete the Phase 4 ratification workflow before any Phase 5 M1
  backlog work begins, per the source directive at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [51, 51], contentHash: ccf9748}`.

## Out of scope

- Phase 5 M1 backlog delivery SHALL NOT start during or after this Feature's
  pipeline run, per the source directive non-goal at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [34, 34], contentHash: ccf9748}`.

- Phase 4 exit criteria SHALL NOT be redefined by this Feature, per the source
  directive non-goal at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [36, 36], contentHash: ccf9748}`.

- Simulated or replayed telemetry SHALL NOT satisfy any acceptance criterion,
  per the source directive non-goal at
  `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [38, 38], contentHash: ccf9748}`.

- Modifications to any artifact under `lib/memory/features/us-1-dogfood-phase-4-exit/`
  other than `phase-4-proof-bundle.md` lie outside this Feature's touch-set.

## Open questions

_None. The clarifying-question loop was not opened; the source directive is
fully specified. See `intake_closure.note` in the frontmatter._
