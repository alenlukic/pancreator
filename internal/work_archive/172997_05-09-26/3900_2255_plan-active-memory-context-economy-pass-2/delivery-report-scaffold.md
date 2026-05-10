---
title: Delivery report scaffold — Active Memory Context Economy Pass 2
feature_id: active-memory-context-economy-pass-2
stage: implement-complete
task_id: 173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2
next_owner: tech-writer
note: |
  The tech-writer SHALL finalize this scaffold at the report stage, preserve
  the seven manual validation steps verbatim, and cite
  `memory/features/active-memory-context-economy-pass-2/spec.md` where required.
---

# Active Memory Context Economy Pass 2 — delivery report scaffold

## Summary for operators

This Feature SHALL yield an active-memory tier, a memory-tier taxonomy in the handbook, slimmer `AGENTS.md` routing, six narrowed Cursor rule projections with an audited `supervisor.mdc`, indexing alignment, extended context-budget reporting, ADR-0006, and governance artifacts. This scaffold lists staged surfaces, deferrals, and mandatory post-merge checks.

## Staged changes (high level)

The implementation waves produced or updated the paths recorded under `implement.waves[]` in `memory/features/active-memory-context-economy-pass-2/index.json`, including handbook pages, `memory/active/**`, ADR-0006, `AGENTS.md`, selected `.cursor/rules/*.mdc`, `.cursorindexingignore`, `internal/tools/context-budget-report.mjs` and its test, the rule audit, backlog entries, README key-path pointer, and task-local governance JSON in `internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/`.

## Deferrals with backlog linkage

The following backlog items SHALL remain open until a future slice closes them:

| Backlog id | Purpose |
|------------|---------|
| `active-memory-physical-tier-migration` | Future physical migration with shims, tests, manifest, reference updates, and rollback notes. |
| `active-memory-budget-warning-tool` | Executable warnings against documented soft budgets. |
| `active-memory-rule-glob-ratification` | Owner ratification for any mirrored rule glob that still carries activation risk after audit. |

The plan reversed the glossary deferral; no separate glossary backlog item is required because `memory/handbook/glossary.md` carries the new nouns.

## Manual validation requested from operator

After implementation, the delivery report SHALL ask the operator to perform exactly these seven actions (source: `inbox/in/token-economy-enhanced.md` § Manual validation, mirrored in the ratified Engineering Spec):

1. Restart or reindex Cursor.
2. Confirm custom agents under `.cursor/agents/**` are still discoverable if that path remains excluded from indexing.
3. Run `pnpm run context:budget`.
4. Run 3–5 comparable simple Cursor tasks and record cache-read totals.
5. Compare against the previous post-pass-1 result of approximately 770K cache-read tokens.
6. Confirm explicit references to `@PRD.md`, `@BOOTSTRAP.md`, selected `work/**` artifacts, and selected durable memory files still work when intentionally requested.
7. Confirm `memory/active/current.md` gives a clear operator-facing picture of active context without requiring traversal of archival memory.

## Informational context targets

Directional cache-read token bands from the source directive remain informational targets, not hard correctness gates, because the IDE may add hidden tool, schema, or chat overhead.

## Preservation invariants

The Feature MUST NOT delete historical artifacts under `work/**`, `memory/**`, `inbox/out/**`, or `inbox/threads/**`. The reviewer and operator SHALL confirm deletion-free diffs before merge.
