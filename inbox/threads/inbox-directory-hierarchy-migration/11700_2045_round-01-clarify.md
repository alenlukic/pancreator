---
title: Inbox Directory Hierarchy Migration — Round 01 Clarify
feature_id: inbox-directory-hierarchy-migration
round: 1
total_rounds_cap: 5
posted_by: intake-analyst
posted_at_utc: 2026-05-09T20:45:00Z
source_inbox_item: inbox/in/inbox_convention_migration.md
spec_path: memory/features/inbox-directory-hierarchy-migration/spec.md
status: awaiting-human-ratification
references:
  - kind: lines
    path: inbox/in/inbox_convention_migration.md
    range: [1, 1]
    contentHash: 03e17dc152bb45b74cbdf9b459f7a30cbf251722d8016f050b1c5af84b82a72e
    note: "Operator directive."
  - kind: lines
    path: memory/features/inbox-directory-hierarchy-migration/spec.md
    range: [50, 230]
    contentHash: TBD-on-commit
    note: "Round-1 spec assumptions and open-question slots."
---

# Round 1 — Clarify

The intake-analyst staged a round-1 Engineering Spec for `inbox` directory
hierarchy migration at
`memory/features/inbox-directory-hierarchy-migration/spec.md`.

The spec encodes seven explicit assumptions (A1–A7) bound to seven open
questions (Q1–Q7) below. Operator answers in this thread (one reply file per
round) close the dialogue. The clarifying loop terminates at five rounds per
the intake-analyst contract.

## Questions

- Q1. Single-file leaf placement vs per-artifact HHMM subdirectory. The
  directive says "HHMM-oriented subdirectories". Assumption A1 maps `HHMM`
  to the basename token rather than a folder layer because inbox artifacts
  are single files. Does Q1 close on A1 (basename token), or require strict
  folder-per-item parity with `work/`?
- Q2. Threads layout. Three options: (a) day-bucket nested inside the
  feature folder as
  `inbox/threads/<feature-slug>/{days-to-FDS}_{MM-DD-YY}/`; (b)
  feature-folder nested inside a day bucket as
  `inbox/threads/{days-to-FDS}_{MM-DD-YY}/<feature-slug>/`; or (c)
  feature-folder remains flat at the threads top level with no day buckets.
  Assumption A2 picks option (a).
- Q3. Migration tool surface. Extend `tools/migrate-timestamp-naming.mjs`
  with hierarchy logic, or ship a sibling
  `tools/migrate-inbox-directory-hierarchy.mjs`? Assumption A3 picks the
  sibling tool.
- Q4. Compliance descriptor surface. Extend
  `tests/compliance/timestamp-naming-conventions.yaml` with hierarchy
  clauses, or land a sibling
  `tests/compliance/inbox-directory-hierarchy.yaml`? Assumption A4 picks
  the sibling descriptor.
- Q5. ADR shape. New ADR `memory/adr/0006-inbox-directory-hierarchy.md`
  extending ADR-0005 by reference, or amend ADR-0005 in place? Assumption
  A5 picks the new ADR.
- Q6. Migration ordering. One atomic migration manifest covering all four
  in-scope subtrees, or staged subtree-by-subtree across multiple
  ratification slices? Assumption A6 picks the atomic manifest.
- Q7. Archive subtree handling. Apply the day-bucket hierarchy
  retroactively to every artifact already in `inbox/archive/in/`, or freeze
  the archive in its pre-migration shape and only apply the hierarchy to
  future archived items? Assumption A7 picks retroactive application.

## How to reply

Operator SHALL post one reply file in this same thread folder named
`<SID-prefix>_<HHMM>_round-01-clarify-human-responses.md` with answers
keyed by question id (Q1 through Q7). The intake-analyst will fold the
answers into the spec, clear `## Open questions`, and stage the spec for
the `human_approval` gate.
