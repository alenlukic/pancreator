---
feature_id: active-memory-context-economy-pass-2
stage: report
status: report-drafted
created_at_utc: 2026-05-10T01:15:00Z
references:
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [193, 519]
    contentHash: e6c4fcd
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md
    range: [30, 63]
    contentHash: 58bbab6
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md
    range: [40, 173]
    contentHash: ec47371
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/adr-draft.md
    range: [39, 75]
    contentHash: a001200
---

# Active Memory Context Economy Pass 2

## Summary

This Feature shipped a five-tier memory model, an `src/memory/active/` operator surface, a slimmer `AGENTS.md` routing card, narrowed Cursor rule triggers, per-tier context-budget reporting, ADR-0006, and governance artifacts that keep historical work reachable without defaulting the IDE into archival load. The implementation also closed the glossary deferral, kept physical migration deferred, and left the operator with a precise manual-validation checklist for post-reindex verification. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/spec.md",
  "range": [193, 210],
  "contentHash": "15ae7dd"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [42, 47],
  "contentHash": "6b25ee7"
}
```


## Acceptance criteria status

| # | Status | Evidence |
|---|---|---|
| 1 | pass | `src/memory/handbook/memory-tiers.md` defines five tiers and locations. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/memory-tiers.md",
  "range": [28, 132],
  "contentHash": "c745f2d"
}
```
 |
| 2 | pass | `src/memory/active/README.md` exists and scopes the tier. 

```json
{
  "kind": "lines",
  "path": "src/memory/active/README.md",
  "range": [29, 68],
  "contentHash": "9b951c3"
}
```
 |
| 3 | pass | `src/memory/active/current.md` stays pointer-only. 

```json
{
  "kind": "lines",
  "path": "src/memory/active/current.md",
  "range": [24, 44],
  "contentHash": "e44dbb9"
}
```
 |
| 4 | pass | `src/memory/active/runs.md` stores run pointers only. 

```json
{
  "kind": "lines",
  "path": "src/memory/active/runs.md",
  "range": [22, 35],
  "contentHash": "e98031e"
}
```
 |
| 5 | pass | ADR-0006 records the active-versus-archival split. 

```json
{
  "kind": "lines",
  "path": "src/memory/adr/0006-active-vs-archival-memory.md",
  "range": [45, 74],
  "contentHash": "4828d9d"
}
```
 |
| 6 | pass | `src/memory/handbook/context-economy.md` classifies `src/work/**` as archival and explicit-read only. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/context-economy.md",
  "range": [64, 91],
  "contentHash": "8640ae6"
}
```
 |
| 7 | pass | `src/memory/handbook/memory-tiers.md` separates internal operating content from active memory. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/memory-tiers.md",
  "range": [92, 104],
  "contentHash": "c745f2d"
}
```
 |
| 8 | pass | `src/memory/handbook/context-economy.md` routes tier questions. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/context-economy.md",
  "range": [64, 87],
  "contentHash": "8640ae6"
}
```
 |
| 9 | pass | `src/memory/handbook/index.md` adds active and tier routes. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/index.md",
  "range": [70, 72],
  "contentHash": "bc5cff7"
}
```
 |
| 10 | pass | `simple task mode` is defined with escalation triggers. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/context-economy.md",
  "range": [110, 159],
  "contentHash": "8640ae6"
}
```
 |
| 11 | pass | `AGENTS.md` was slimmed and D5 rationale was recorded. 

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [1, 192],
  "contentHash": "f2d87ec"
}
```
 |
| 12 | pass | The rule audit covers every named Cursor rule file. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/rule-audit.md",
  "range": [52, 121],
  "contentHash": "bb8b476"
}
```
 |
| 13 | pass | `tesseract-engineer.mdc` no longer broad-loads persona specs. 

```json
{
  "kind": "lines",
  "path": ".cursor/rules/tesseract-engineer.mdc",
  "range": [3, 27],
  "contentHash": "5f448a1"
}
```
 |
| 14 | pass | `src/internal/tools/context-budget-report.mjs` emits seven tier groups. 

```json
{
  "kind": "lines",
  "path": "src/internal/tools/context-budget-report.mjs",
  "range": [216, 360],
  "contentHash": "453d708"
}
```
 |
| 15 | pass | `tests/context-budget-report.test.mjs` covers the new grouping behavior. 

```json
{
  "kind": "lines",
  "path": "tests/context-budget-report.test.mjs",
  "range": [26, 79],
  "contentHash": "37d1b64"
}
```
 |
| 16 | pass | `.cursorindexingignore` aligns with the tier model. 

```json
{
  "kind": "lines",
  "path": ".cursorindexingignore",
  "range": [1, 38],
  "contentHash": "3ef42bf"
}
```
 |
| 17 | pass | No historical artifact was deleted. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [118, 120],
  "contentHash": "6b25ee7"
}
```
 |
| 18 | pass | `active-memory-physical-tier-migration` stays deferred with backlog linkage. 

```json
{
  "kind": "lines",
  "path": "src/memory/backlog/index.yaml",
  "range": [383, 396],
  "contentHash": "8157e17"
}
```
 |
| 19 | pass | The scaffold preserves the seven manual-validation steps. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/delivery-report-scaffold.md",
  "range": [35, 45],
  "contentHash": "eb3d8c1"
}
```
 |
| 20 | pass | Documentation-impact and policy-compliance artifacts are satisfied. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/documentation-impact.json",
  "range": [1, 61],
  "contentHash": "66bb47e"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/policy-compliance.json",
  "range": [1, 60],
  "contentHash": "e44c117"
}
```
 |

## What changed

- Wave 1 landed the memory-tier handbook page, glossary nouns, handbook routing, and context-economy guidance. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [37, 56],
  "contentHash": "c19097d"
}
```

- Wave 2 added `src/memory/active/README.md`, `src/memory/active/current.md`, and `src/memory/active/runs.md` for pointer-first active memory. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [49, 56],
  "contentHash": "c19097d"
}
```

- Wave 3 promoted ADR-0006 for active versus archival memory. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [57, 61],
  "contentHash": "c19097d"
}
```

- Wave 4 slimmed `AGENTS.md` and kept the protected semantics intact. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [63, 66],
  "contentHash": "c19097d"
}
```

- Wave 5 audited six Cursor rule shims and kept `supervisor.mdc` unchanged. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [68, 78],
  "contentHash": "c19097d"
}
```

- Wave 6 aligned `.cursorindexingignore` and extended the context-budget tool and tests. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [81, 87],
  "contentHash": "c19097d"
}
```

- Wave 7 refreshed backlog, feature index, README, and the task-local governance artifacts. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [90, 98],
  "contentHash": "c19097d"
}
```


## Plan-stage decisions resolved

- D1 resolved to `src/memory/handbook/context-economy.md`, with one AGENTS route pointer only. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [38, 38],
  "contentHash": "d696d0b"
}
```

- D2 resolved to ADR sequence `0006`. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [39, 39],
  "contentHash": "d696d0b"
}
```

- D3 resolved by deferring executable budget warnings to backlog. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [40, 40],
  "contentHash": "d696d0b"
}
```

- D4 resolved to `src/memory/handbook/context-economy.md` for escalation guidance. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [41, 41],
  "contentHash": "d696d0b"
}
```

- D5 resolved in favor of slimming `AGENTS.md` without treating 900 words as a hard gate. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [42, 42],
  "contentHash": "d696d0b"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [57, 65],
  "contentHash": "6b25ee7"
}
```


## Deferrals and backlog linkage

The glossary deferral closed in plan stage, so only three backlog items remain open here. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [47, 49],
  "contentHash": "d696d0b"
}
```


- `active-memory-physical-tier-migration` tracks the safe migration slice with shims, tests, manifest, reference updates, and rollback notes. 

```json
{
  "kind": "lines",
  "path": "src/memory/backlog/index.yaml",
  "range": [383, 396],
  "contentHash": "8157e17"
}
```

- `active-memory-budget-warning-tool` tracks executable soft-budget warnings. 

```json
{
  "kind": "lines",
  "path": "src/memory/backlog/index.yaml",
  "range": [398, 411],
  "contentHash": "8157e17"
}
```

- `active-memory-rule-glob-ratification` tracks any remaining mirror-parity ratification risk. 

```json
{
  "kind": "lines",
  "path": "src/memory/backlog/index.yaml",
  "range": [413, 428],
  "contentHash": "8157e17"
}
```


## Verification evidence

The implement stage recorded six passing gates: `pnpm lint`, `pnpm typecheck`, `pnpm run check:phase0a`, `pnpm run context:budget:test` at 6 of 6, `node src/internal/tools/context-budget-report.mjs`, and no historical deletions. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [102, 109],
  "contentHash": "c19097d"
}
```


| Metric | Files | Chars | Approx tokens |
|---|---:|---:|---:|
| Total corpus | 577 | 2,363,961 | ~590,991 |
| Indexable default | 392 | 817,424 | ~204,356 |
| Explicit-read only | 185 | 1,546,537 | ~386,635 |
| Active memory | 3 | 5,369 | ~1,343 |

The directional delta is a small indexable increase versus the pass-1 baseline, while the operator still has to confirm the cache-read drop in a live IDE run. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [153, 172],
  "contentHash": "6b25ee7"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/internal/tools/context-budget-report.mjs",
  "range": [313, 360],
  "contentHash": "453d708"
}
```


## Reviewer findings

- Consider consolidating `AGENTS.md` §5 and §7 in a future micro-pass if the team wants the body under 900 words. Next step: backlog the micro-pass only if routing clarity still holds. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [57, 65],
  "contentHash": "6b25ee7"
}
```

- Consider a no-code-coverage variant of the `review_passes` gate for prose-only features. Next step: add the policy to backlog before the next review-heavy doc slice. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [66, 73],
  "contentHash": "6b25ee7"
}
```

- Consider renaming `simple task mode` only in a later atomic slice that can propagate the change everywhere. Next step: treat the current label as documented lint debt, not a blocker. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [74, 78],
  "contentHash": "6b25ee7"
}
```

- Note the dispatch-summary wording mismatch between seven waves and seven slices across three chronological waves. Next step: leave the wording untouched unless a retrospective wants a cosmetic cleanup. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [82, 85],
  "contentHash": "6b25ee7"
}
```


## Manual validation requested from operator

1. Restart or reindex Cursor.
2. Confirm custom agents under `.cursor/agents/**` are still discoverable if that path remains excluded from indexing.
3. Run `pnpm run context:budget`.
4. Run 3–5 comparable simple Cursor tasks and record cache-read totals.
5. Compare against the previous post-pass-1 result of approximately 770K cache-read tokens.
6. Confirm explicit references to `@docs/PRD.md`, `@docs/BOOTSTRAP.md`, selected `src/work/**` artifacts, and selected durable memory files still work when intentionally requested.
7. Confirm `src/memory/active/current.md` gives a clear operator-facing picture of active context without requiring traversal of archival memory.

## Risks / rollback notes

- Physical path migration remains deferred, so the rollback path is to keep the new tier as documentation and routing only until a later slice ships shims, tests, a manifest, and rollback notes. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [46, 46],
  "contentHash": "d696d0b"
}
```

- The `.cursor/agents/**` exclusion still depends on explicit discovery checks after reindex. 

```json
{
  "kind": "lines",
  "path": "src/memory/handbook/context-economy.md",
  "range": [209, 214],
  "contentHash": "8640ae6"
}
```

- Any future rule-glob tightening still needs mirror-parity ratification if review cannot prove the narrower surface is safe. 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md",
  "range": [49, 49],
  "contentHash": "d696d0b"
}
```


## Pipeline status

Current stage: `report`. Proposed next stage: `notifier`, which stages this delivery report to `src/inbox/out/` and leaves the feature ready for the next human approval handoff. 

```json
{
  "kind": "lines",
  "path": "src/memory/features/active-memory-context-economy-pass-2/index.json",
  "range": [5, 8],
  "contentHash": "c19097d"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md",
  "range": [8, 10],
  "contentHash": "6b25ee7"
}
```

