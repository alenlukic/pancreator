---
id: surface-opt-p3-cap-current-md-shipped-features-ledger
title: "surface-opt P3 — cap current.md shipped-Features ledger"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-01T05:10:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P3
governance: gov
depends_on: []
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p3-current-md-cap.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p3-current-md-cap.md
    range: [34, 93]
    contentHash: 452fad2
    note: "Source directive Problem, Goal, Touch set, Required outcomes (R1-R3), Acceptance criteria (AC1-AC3), Out of scope, Governance, and Implementation notes."
  - kind: lines
    path: lib/memory/active/current.md
    range: [40, 79]
    contentHash: d1f6703
    note: "Shipped-Features ledger renders 36 rows on every orientation read; current.md is declared as compact pointers."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/active-memory-refresh.ts
    range: [449, 464]
    contentHash: 1a92027
    note: "deriveShippedMarkdownTable sorts and emits every indexed row with no row cap."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/active-memory-refresh.ts
    range: [600, 665]
    contentHash: 1a92027
    note: "rewriteActiveMemoryFile assembles and writes current.md with no whole-file trailing-blank-line trim."
---

# Spec — cap current.md shipped-Features ledger

## 1 — Context and motivation

`lib/memory/active/current.md` is the first-read orientation file declared as
compact pointers, yet its shipped-Features ledger renders 36 rows plus roughly 18
trailing blank lines, so every orientation read pays that cost (source directive
Problem). The full shipped-Features history already lives in
`lib/memory/features/*/index.json`, which stays the source of truth. The
`deriveShippedMarkdownTable` function in `active-memory-refresh.ts` sorts and
emits every indexed row with no row cap, and `rewriteActiveMemoryFile` writes the
assembled file with no whole-file trailing-blank-line trim. This feature caps the
rendered ledger at 10 rows, removes trailing blank lines, and adds 1 unit test so
the orientation surface stays compact. This piece ships in Track D step 2 with P4
per the source directive Sequencing paragraph.

## 2 — Requirements

**R1** The `current.md` shipped-Features ledger SHALL contain at most 10 rows.

**R2** The `current.md` file SHALL end with 0 trailing blank lines.

**R3** The `active-memory-refresh.ts` refresh SHALL enforce the 10-row ledger cap
on every refresh.

## 3 — Acceptance criteria

- AC1: When `pnpm -w exec pan refresh-active-memory` completes, the `current.md`
  shipped-Features ledger SHALL contain at most 10 rows.
- AC2: When `pnpm -w exec pan refresh-active-memory` completes, `current.md` SHALL
  end with 0 trailing blank lines.
- AC3: When a unit test simulates more than 10 shipped features, the test SHALL
  assert that the rendered ledger holds at most 10 rows.

## 4 — Touch set (projected)

| Path | Change type | Rationale |
|------|-------------|-----------|
| `lib/internal/packages/@pancreator/cli/src/active-memory-refresh.ts` | modify | Cap `deriveShippedMarkdownTable` output at 10 rows and trim whole-file trailing blank lines on write (R1, R2, R3, AC1, AC2). |
| `lib/memory/active/current.md` | modify | Re-render the ledger at most 10 rows with 0 trailing blank lines (R1, R2, AC1, AC2). |
| Unit test under `lib/internal/packages/@pancreator/cli` | create/modify | Assert the rendered ledger holds at most 10 rows when more than 10 shipped features exist (R3, AC3). |

## 5 — Out of scope

- This piece SHALL NOT delete shipped-Features history; the full history stays
  queryable in `lib/memory/features/*/index.json` (source directive Out-of-scope
  bullet 1).
- This piece SHALL NOT change the CLI or runner advance engine, reserved for
  Track O P5–P8 (source directive Out-of-scope bullet 2).
- This piece SHALL NOT change MCP handlers, agent projections, or the dashboard
  (source directive Out-of-scope bullet 3 and Touch-set guard paragraph).
- This piece SHALL NOT change the `state.json` shape (source directive Touch-set
  guard paragraph).

## 6 — Governance

This piece carries the `[gov]` flag because it edits the active-memory
orientation surface (source directive Governance paragraph). The delivering run
SHALL record an active-memory review in the handoff before advance, per source
directive Governance paragraph.

## 7 — Dependencies and sequencing

- This piece depends on no other piece (source directive Dependencies: none).
- This piece SHALL ship in Track D step 2 with P4, and SHALL reach archival close
  before the Track-O `pan doctor` piece (P8) reuses this cap check (source
  directive Sequencing paragraph).

## 8 — Open questions

_None. The source directive states R1–R3 and AC1–AC3 with quantified outcomes and
an explicit touch set, so the clarifying dialogue closes at round 0._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-01 | intake-analyst | Initial canonical spec from directive `75420_0303_surface-opt-p3-current-md-cap.md`; 0 clarifying rounds. |
