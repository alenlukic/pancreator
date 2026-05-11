---
title: Inbox Directory Hierarchy Migration — Round 01 Clarify
feature_id: inbox-directory-hierarchy-migration
round: 1
total_rounds_cap: 5
posted_by: intake-analyst
posted_at_utc: 2026-05-09T20:45:00Z
source_inbox_item: src/inbox/in/inbox_convention_migration.md
spec_path: src/memory/features/inbox-directory-hierarchy-migration/spec.md
status: ratified
references:
  - kind: lines
    path: src/inbox/in/inbox_convention_migration.md
    range: [1, 1]
    contentHash: 03e17dc152bb45b74cbdf9b459f7a30cbf251722d8016f050b1c5af84b82a72e
    note: "Operator directive."
  - kind: lines
    path: src/memory/features/inbox-directory-hierarchy-migration/spec.md
    range: [1, 304]
    contentHash: TBD-on-commit
    note: "Round-1 spec assumptions and ratified decision slots."
---

# Round 1 — Clarify

The intake-analyst staged a round-1 Engineering Spec for `inbox` directory
hierarchy migration at
`src/memory/features/inbox-directory-hierarchy-migration/spec.md`.

The spec encodes seven explicit assumptions (A1–A7) bound to seven clarify
questions (Q1–Q7) below. Round 1 operator answers are inlined under
**Questions**. The clarifying loop terminates at five rounds per the
intake-analyst contract.

## Questions

- Q1. Single-file leaf placement vs per-artifact HHMM subdirectory. The
  directive says "HHMM-oriented subdirectories". Assumption A1 maps `HHMM`
  to the basename token rather than a folder layer because inbox artifacts
  are single files. Does Q1 close on A1 (basename token), or require strict
  folder-per-item parity with `src/work/`? **Answer**: A1 is the correct assumption.
- Q2. Threads layout. Three options: (a) day-bucket nested inside the
  feature folder as
  `src/inbox/threads/<feature-slug>/{days-to-FDS}_{MM-DD-YY}/`; (b)
  feature-folder nested inside a day bucket as
  `src/inbox/threads/{days-to-FDS}_{MM-DD-YY}/<feature-slug>/`; or (c)
  feature-folder remains flat at the threads top level with no day buckets.
  Assumption A2 picks option (a). **Answer**: Option (b).
- Q3. Migration tool surface. Extend `src/internal/tools/migrate-timestamp-naming.mjs`
  with hierarchy logic, or ship a sibling
  `src/internal/tools/migrate-inbox-directory-hierarchy.mjs` (repo script
  layout per `AGENTS.md` workspace map)? Assumption A3 picks the sibling tool.
  **Answer**: A3.
- Q4. Compliance descriptor surface. Extend
  `tests/compliance/timestamp-naming-conventions.yaml` with hierarchy clauses, or
  land a sibling `tests/compliance/inbox-directory-hierarchy.yaml`? Assumption A4
  picks the sibling descriptor. **Answer**: A4.
- Q5. ADR shape. New ADR `src/memory/adr/0006-inbox-directory-hierarchy.md`
  extending ADR-0005 by reference, or amend ADR-0005 in place? Assumption
  A5 picks the new ADR. **Answer**: New ADR.
- Q6. Migration ordering. One atomic migration manifest covering all four
  in-scope subtrees, or staged subtree-by-subtree across multiple
  ratification slices? Assumption A6 picks the atomic manifest. **Answer**: A6.
- Q7. Archive subtree handling. Apply the day-bucket hierarchy
  retroactively to every artifact already in `src/inbox/archive/in/`, or freeze
  the archive in its pre-migration shape and only apply the hierarchy to
  future archived items? Assumption A7 picks retroactive application. **Answer**: A7.

## How to reply

Round 1 closed with operator answers inlined under **Questions** above. Ratifications
are folded into
`src/memory/features/inbox-directory-hierarchy-migration/spec.md` under
`## Ratified decisions (round 1)` with source citation to this thread. Later rounds
(if any) MAY use a separate `<SID-prefix>_<HHMM>_round-NN-clarify-human-responses.md`
file per thread convention.
