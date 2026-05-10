---
feature_id: active-memory-context-economy-pass-2
stage: report
status: report-drafted
created_at_utc: 2026-05-10T01:15:00Z
references:
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [193, 519]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
  - kind: lines
    path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md
    range: [30, 63]
    contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70
  - kind: lines
    path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md
    range: [40, 173]
    contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5
  - kind: lines
    path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/adr-draft.md
    range: [39, 75]
    contentHash: a001200da3a6253f9e329337cab3fbf1a262bc681a13006f0878dd03d2ec4bfa
---

# Active Memory Context Economy Pass 2

## Summary

This Feature shipped a five-tier memory model, an `memory/active/` operator surface, a slimmer `AGENTS.md` routing card, narrowed Cursor rule triggers, per-tier context-budget reporting, ADR-0006, and governance artifacts that keep historical work reachable without defaulting the IDE into archival load. The implementation also closed the glossary deferral, kept physical migration deferred, and left the operator with a precise manual-validation checklist for post-reindex verification. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [193, 210], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [42, 47], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`

## Acceptance criteria status

| # | Status | Evidence |
|---|---|---|
| 1 | pass | `memory/handbook/memory-tiers.md` defines five tiers and locations. `{kind: lines, path: memory/handbook/memory-tiers.md, range: [28, 132], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}` |
| 2 | pass | `memory/active/README.md` exists and scopes the tier. `{kind: lines, path: memory/active/README.md, range: [29, 68], contentHash: 248cc86b0b3fb0dda938f61108737912251213461398744faa2a97949f710923}` |
| 3 | pass | `memory/active/current.md` stays pointer-only. `{kind: lines, path: memory/active/current.md, range: [24, 44], contentHash: 9a9c132f603409e4c8f0123aab6c310efeef2768a695c6f3b2ea955619f1e52c}` |
| 4 | pass | `memory/active/runs.md` stores run pointers only. `{kind: lines, path: memory/active/runs.md, range: [22, 35], contentHash: 1cd2565ba3ed1a9507a846512679a159cb56b37e37018b37d780130dfbe51519}` |
| 5 | pass | ADR-0006 records the active-versus-archival split. `{kind: lines, path: memory/adr/0006-active-vs-archival-memory.md, range: [45, 74], contentHash: 85f2d9386052f28fd1bac74027fbe1ba2a5f441c2affca7e02c4e1235c775e55}` |
| 6 | pass | `memory/handbook/context-economy.md` classifies `work/**` as archival and explicit-read only. `{kind: lines, path: memory/handbook/context-economy.md, range: [64, 91], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}` |
| 7 | pass | `memory/handbook/memory-tiers.md` separates internal operating content from active memory. `{kind: lines, path: memory/handbook/memory-tiers.md, range: [92, 104], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}` |
| 8 | pass | `memory/handbook/context-economy.md` routes tier questions. `{kind: lines, path: memory/handbook/context-economy.md, range: [64, 87], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}` |
| 9 | pass | `memory/handbook/index.md` adds active and tier routes. `{kind: lines, path: memory/handbook/index.md, range: [70, 72], contentHash: 9c4824455c19cd39e623ebb93bb81688a7fd9530e9f6f07fdcb1b5c405b49663}` |
| 10 | pass | `simple task mode` is defined with escalation triggers. `{kind: lines, path: memory/handbook/context-economy.md, range: [110, 159], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}` |
| 11 | pass | `AGENTS.md` was slimmed and D5 rationale was recorded. `{kind: lines, path: AGENTS.md, range: [1, 192], contentHash: 884bc58912b0084f49ad6f23e294c283af65ea3e7fa0e4c911e1a857958fcbdc}` |
| 12 | pass | The rule audit covers every named Cursor rule file. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/rule-audit.md, range: [52, 121], contentHash: 1e5299f4619e68a992e6dfc776c00c7315bdc2d77c7500cd67d4618a4bc17f33}` |
| 13 | pass | `tesseract-engineer.mdc` no longer broad-loads persona specs. `{kind: lines, path: .cursor/rules/tesseract-engineer.mdc, range: [3, 27], contentHash: ee7f81873daf0c08e2f6c0f20946e61e46bbf0cbe5d8b1e96936a032e77e5693}` |
| 14 | pass | `internal/tools/context-budget-report.mjs` emits seven tier groups. `{kind: lines, path: internal/tools/context-budget-report.mjs, range: [216, 360], contentHash: 4b8635212a64910b3217b532b615bf56fea0f7fd088c2ac44f4e88fb5ddd8e3b}` |
| 15 | pass | `internal/tools/context-budget-report.test.mjs` covers the new grouping behavior. `{kind: lines, path: internal/tools/context-budget-report.test.mjs, range: [26, 79], contentHash: 8eb383df77fa837794745c48672d70401a8f0326eb35ef0b9063246cbad79208}` |
| 16 | pass | `.cursorindexingignore` aligns with the tier model. `{kind: lines, path: .cursorindexingignore, range: [1, 38], contentHash: 4288f2ec8d67e4c8099bfc89c689c10831468791213f1335b3cc3fad959675b0}` |
| 17 | pass | No historical artifact was deleted. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [118, 120], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}` |
| 18 | pass | `active-memory-physical-tier-migration` stays deferred with backlog linkage. `{kind: lines, path: memory/backlog/index.yaml, range: [383, 396], contentHash: 72d0d473a846afca79cd9bd989fdb4fa4805556c9425afc3944c8e32c3f3c093}` |
| 19 | pass | The scaffold preserves the seven manual-validation steps. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/delivery-report-scaffold.md, range: [35, 45], contentHash: 76010816e6af0935c4b44fb1ec946c569684e95f99c0d8d3bfe871cd76db2662}` |
| 20 | pass | Documentation-impact and policy-compliance artifacts are satisfied. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/documentation-impact.json, range: [1, 61], contentHash: 8a76c9e7485921db1d6019fafd0f1bd22eb6d080cf5f2be8c88e9c7e60b6b532}` `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/policy-compliance.json, range: [1, 60], contentHash: 2db7a7424813c1e3166b22995a6a867cfbef2cc099b39102f0a29fef3fe63ec1}` |

## What changed

- Wave 1 landed the memory-tier handbook page, glossary nouns, handbook routing, and context-economy guidance. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [37, 56], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 2 added `memory/active/README.md`, `memory/active/current.md`, and `memory/active/runs.md` for pointer-first active memory. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [49, 56], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 3 promoted ADR-0006 for active versus archival memory. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [57, 61], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 4 slimmed `AGENTS.md` and kept the protected semantics intact. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [63, 66], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 5 audited six Cursor rule shims and kept `supervisor.mdc` unchanged. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [68, 78], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 6 aligned `.cursorindexingignore` and extended the context-budget tool and tests. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [81, 87], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`
- Wave 7 refreshed backlog, feature index, README, and the task-local governance artifacts. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [90, 98], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`

## Plan-stage decisions resolved

- D1 resolved to `memory/handbook/context-economy.md`, with one AGENTS route pointer only. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [38, 38], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`
- D2 resolved to ADR sequence `0006`. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [39, 39], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`
- D3 resolved by deferring executable budget warnings to backlog. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [40, 40], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`
- D4 resolved to `memory/handbook/context-economy.md` for escalation guidance. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [41, 41], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`
- D5 resolved in favor of slimming `AGENTS.md` without treating 900 words as a hard gate. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [42, 42], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}` `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [57, 65], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`

## Deferrals and backlog linkage

The glossary deferral closed in plan stage, so only three backlog items remain open here. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [47, 49], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`

- `active-memory-physical-tier-migration` tracks the safe migration slice with shims, tests, manifest, reference updates, and rollback notes. `{kind: lines, path: memory/backlog/index.yaml, range: [383, 396], contentHash: 72d0d473a846afca79cd9bd989fdb4fa4805556c9425afc3944c8e32c3f3c093}`
- `active-memory-budget-warning-tool` tracks executable soft-budget warnings. `{kind: lines, path: memory/backlog/index.yaml, range: [398, 411], contentHash: 72d0d473a846afca79cd9bd989fdb4fa4805556c9425afc3944c8e32c3f3c093}`
- `active-memory-rule-glob-ratification` tracks any remaining mirror-parity ratification risk. `{kind: lines, path: memory/backlog/index.yaml, range: [413, 428], contentHash: 72d0d473a846afca79cd9bd989fdb4fa4805556c9425afc3944c8e32c3f3c093}`

## Verification evidence

The implement stage recorded six passing gates: `pnpm lint`, `pnpm typecheck`, `pnpm run check:phase0a`, `pnpm run context:budget:test` at 6 of 6, `node internal/tools/context-budget-report.mjs`, and no historical deletions. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [102, 109], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}`

| Metric | Files | Chars | Approx tokens |
|---|---:|---:|---:|
| Total corpus | 577 | 2,363,961 | ~590,991 |
| Indexable default | 392 | 817,424 | ~204,356 |
| Explicit-read only | 185 | 1,546,537 | ~386,635 |
| Active memory | 3 | 5,369 | ~1,343 |

The directional delta is a small indexable increase versus the pass-1 baseline, while the operator still has to confirm the cache-read drop in a live IDE run. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [153, 172], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}` `{kind: lines, path: internal/tools/context-budget-report.mjs, range: [313, 360], contentHash: 4b8635212a64910b3217b532b615bf56fea0f7fd088c2ac44f4e88fb5ddd8e3b}`

## Reviewer findings

- Consider consolidating `AGENTS.md` §5 and §7 in a future micro-pass if the team wants the body under 900 words. Next step: backlog the micro-pass only if routing clarity still holds. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [57, 65], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`
- Consider a no-code-coverage variant of the `review_passes` gate for prose-only features. Next step: add the policy to backlog before the next review-heavy doc slice. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [66, 73], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`
- Consider renaming `simple task mode` only in a later atomic slice that can propagate the change everywhere. Next step: treat the current label as documented lint debt, not a blocker. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [74, 78], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`
- Note the dispatch-summary wording mismatch between seven waves and seven slices across three chronological waves. Next step: leave the wording untouched unless a retrospective wants a cosmetic cleanup. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [82, 85], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`

## Manual validation requested from operator

1. Restart or reindex Cursor.
2. Confirm custom agents under `.cursor/agents/**` are still discoverable if that path remains excluded from indexing.
3. Run `pnpm run context:budget`.
4. Run 3–5 comparable simple Cursor tasks and record cache-read totals.
5. Compare against the previous post-pass-1 result of approximately 770K cache-read tokens.
6. Confirm explicit references to `@PRD.md`, `@BOOTSTRAP.md`, selected `work/**` artifacts, and selected durable memory files still work when intentionally requested.
7. Confirm `memory/active/current.md` gives a clear operator-facing picture of active context without requiring traversal of archival memory.

## Risks / rollback notes

- Physical path migration remains deferred, so the rollback path is to keep the new tier as documentation and routing only until a later slice ships shims, tests, a manifest, and rollback notes. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [46, 46], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`
- The `.cursor/agents/**` exclusion still depends on explicit discovery checks after reindex. `{kind: lines, path: memory/handbook/context-economy.md, range: [209, 214], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}`
- Any future rule-glob tightening still needs mirror-parity ratification if review cannot prove the narrower surface is safe. `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [49, 49], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`

## Pipeline status

Current stage: `report`. Proposed next stage: `notifier`, which stages this delivery report to `inbox/out/` and leaves the feature ready for the next human approval handoff. `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/index.json, range: [5, 8], contentHash: cafed0f6325c909dd5d4b67b0101acbb42c7a4ba8a3242e3a786824c8cdf154e}` `{kind: lines, path: internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/review.md, range: [8, 10], contentHash: ec473714dee6f250f59b5f211a56ec843ae633c472204baafcb181ec8df10df5}`
