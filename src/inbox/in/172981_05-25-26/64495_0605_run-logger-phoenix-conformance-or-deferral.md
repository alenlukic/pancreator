---
title: run-logger Phoenix conformance smoke or formal deferral ADR
feature_id: run-logger-phoenix-conformance
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:05Z
references:
  - kind: path
    path: docs/PRD.md
    note: §10 and §11 require run logs to render cleanly in Phoenix or Langfuse without adapter code; KPI A20 is the dogfood-day-1 ratification gate.
  - kind: path
    path: src/internal/packages/@tesseract/run-logger/
    note: The package emits OTel-shaped JSONL records; conformance against an external importer has never been verified.
  - kind: path
    path: src/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md
    note: Phoenix trace verification was carried as a deferred engineering item at Phase-4 exit.
  - kind: path
    path: tesseract.yaml
    note: bootstrap.note explicitly tracks Phoenix verification as deferred to the @tesseract/run-logger / tesseract-engineer backlog.
---

# run-logger Phoenix conformance smoke or formal deferral ADR

## Problem

KPI A20 ("ecosystem reuse — at least one third-party importer reads our run
log without glue code") was the M1 dogfood-day-1 promise of the SOTA
alignment pass. It has been carried as a deferred engineering item since
Phase 4 ratification without an explicit milestone. This is either a
bootstrap-status reconciliation gap or a missed M1 deliverable; either way,
the open-ended deferral undermines KPI A19 conformance discipline.

## Goal

Either (a) ship a Phoenix or Langfuse smoke test that verifies an emitted
run log opens cleanly in the importer, or (b) write an ADR that pins the
deferral to a specific milestone with explicit rationale, scope, and
ratification owner.

## Required outcomes (option A — preferred)

1. A Docker-based smoke test under `tests/run-logger-conformance/` boots a
   local Phoenix instance, replays a sample run log emitted by
   `@tesseract/run-logger`, and asserts the trace renders with the expected
   span hierarchy.
2. CI runs the smoke test on every PR that touches `@tesseract/run-logger`
   (path-filtered to keep cost bounded).
3. A second smoke test does the same against Langfuse to demonstrate
   importer interchangeability.
4. The package README cites both smoke tests as the conformance authority
   and links to the latest passing CI run.

## Required outcomes (option B — formal deferral)

1. `src/memory/adr/0007-run-logger-phoenix-conformance-deferral.md` records
   the deferral decision in Nygard format and references the open backlog
   item.
2. `tesseract.yaml` bootstrap evidence stops mentioning Phoenix verification
   as a free-standing deferred item and instead points at the ADR.
3. The deferred milestone is one of `M2`, `M3`, or `M5` with cited rationale.
4. KPI A20 is restated against the ratified milestone in
   `docs/PRD.summary.md`.

## Acceptance criteria

- Either the smoke test passes in CI (option A), or the ADR is ratified by
  the LocalUserAuthorizer and `tesseract.yaml` is updated (option B).
- The active-memory orientation in `src/memory/active/current.md` no longer
  carries Phoenix verification as an undated risk row.
- The choice between A and B is recorded in the intake-analyst's
  canonicalized spec, not assumed by downstream agents.

## Out of scope

- Adopting alternative observability tools beyond Phoenix and Langfuse.
- Deciding whether OTLP HTTP transport replaces JSONL as the default sink.

## Recommended downstream owners

- `tech-lead` for option-A vs option-B selection and the deferral ADR if B.
- `tesseract-engineer` for the smoke test if A.
- `reviewer` for the ratification artifact and active-memory hygiene.
