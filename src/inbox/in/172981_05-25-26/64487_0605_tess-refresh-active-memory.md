---
title: tess refresh-active-memory — deterministic active-memory refresher
feature_id: tess-refresh-active-memory
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:13Z
references:
  - kind: path
    path: src/memory/active/current.md
    note: Operator-facing pointers; the active-feature row and shipped-features table both lag inbox state today.
  - kind: path
    path: src/work/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md
    note: Finding M-01 and proposal P-02 record manual rotation as a recurring audit gap.
  - kind: path
    path: src/memory/features/json-formatting/index.json
    note: Per-feature index files are the existing source of truth for shipped features.
  - kind: path
    path: src/inbox/in/
    note: The active-feature row is meant to mirror the live inbox queue.
---

# tess refresh-active-memory — deterministic active-memory refresher

## Problem

`src/memory/active/current.md` carries the active-feature row, the
shipped-features table, and the open-risks block. All three are updated by
hand. Compliance audits keep finding stale active-memory state (M-01 in the
last broad sweep), the rotation has no automated owner, and proposal P-02
explicitly defers the work to M4+ scheduler wiring. But the file's contents
are deterministic: they are derivable from `src/inbox/in/`, the
`src/memory/features/*/index.json` files, and the active-work `state.json`
ledger. Waiting for the scheduler delays a deterministic fix.

## Goal

Ship a deterministic refresher that rewrites the relevant sections of
`src/memory/active/current.md` from the file system, decoupled from any
scheduler. Operators and the librarian persona invoke it on demand; future
scheduler wiring can drive it without re-implementing the rotation logic.

## Required outcomes

1. `tess refresh-active-memory [--dry-run]` rewrites the Active Feature
   row, the Most-recent shipped Features table, and the Operator-notes
   timestamp in `src/memory/active/current.md`.
2. Active Feature is computed from `src/inbox/in/` (newest unprocessed
   directive), with `(none)` when the queue contains only `.gitkeep` and
   archived items.
3. Shipped Features are computed by walking
   `src/memory/features/*/index.json` for entries with `status: indexed`
   sorted reverse-chronologically by `index.completed_at`.
4. The refresher refuses to clobber the references block and the operator
   notes section; it edits only the labelled sections.
5. The refresher emits a structured diff to stdout and exits non-zero
   when a manually-edited section conflicts with the computed value, so
   operators see the conflict instead of silent overwriting.

## Acceptance criteria

- A vitest suite covers the empty-queue case, the active-directive case,
  and the multi-shipped-features case.
- The refresher resolves audit finding M-01 deterministically when run
  before commit.
- AGENTS.md §6 references the command as the canonical pre-commit
  refresher.
- The compliance-auditor persona's broad-sweep procedure cites the
  command as the auto-remediation for M-01 / m-03 class findings.

## Out of scope

- Cron / scheduler invocation (deferred to M4+ per P-02).
- Rotating the references block or the open-risks block (those remain
  human-curated).
- MCP elicitation transport.

## Recommended downstream owners

- `librarian` for the rotation contract.
- `tesseract-engineer` for the implementation and the vitest harness.
- `compliance-auditor` for adopting the command into the broad-sweep
  procedure.
