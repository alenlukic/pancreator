---
title: Active Memory Context Economy Pass 2 Plan
feature_id: active-memory-context-economy-pass-2
stage: plan
task_id: 173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2
next_owner: coder
references:
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [193, 210]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Feature statement and preservation boundary.
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [212, 519]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Acceptance criteria.
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [560, 600]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Plan-stage decisions and deferrals.
  - kind: lines
    path: memory/features/cursor-token-economy/spec.md
    range: [121, 224]
    contentHash: f44cc8ebe621e6c9aadc207abde8026773fe9fdc27012957c43a7c861f6f3449
    note: Pass-1 retrieval, indexing, and report precedent.
---

# Active Memory Context Economy Pass 2 Plan

## Architecture Summary

When this Feature enters implementation, the coder MUST add an active-memory tier and memory-tier taxonomy while preserving explicit access to archival and durable artifacts. The implementation SHALL keep `work/**` and historical memory in place, route routine orientation through `memory/active/**`, and extend the existing context-budget tool rather than adding a runtime MemoryRouter. The slice MUST update handbook routes, AGENTS pointers, Cursor indexing policy, selected Cursor rules, tests, backlog entries, and governance artifacts within the declared touch-set. Citations: `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [193, 519], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`; `{kind: lines, path: memory/features/cursor-token-economy/spec.md, range: [121, 224], contentHash: f44cc8ebe621e6c9aadc207abde8026773fe9fdc27012957c43a7c861f6f3449}`.

## Plan-Stage Decisions

1. D1: The canonical surface for `simple task mode` SHALL be `memory/handbook/context-economy.md`. AGENTS.md SHALL carry one route pointer only, because the handbook already owns retrieval discipline and keeps the always-loaded card smaller. Citation: `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [314, 352], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.
2. D2: The ADR number SHALL be `0006`, because `memory/adr/0005-timestamp-naming-conventions.md` is the current highest numbered ADR. Citation: `{kind: lines, path: memory/adr/0005-timestamp-naming-conventions.md, range: [1, 24], contentHash: TBD-on-commit}`.
3. D3: The active-memory budget-warning tool SHALL be deferred. The soft caps SHALL ship as documented budgets, and backlog item `active-memory-budget-warning-tool` SHALL track executable warning behavior to avoid mixing reporting refactor and new enforcement.
4. D4: Model and context escalation guidance SHALL live in `memory/handbook/context-economy.md`. AGENTS.md SHALL point there, because provider-neutral escalation policy belongs with retrieval policy. Citation: `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [455, 473], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.
5. D5: AGENTS.md SHALL be slimmed opportunistically but SHALL NOT treat 900 words as a hard gate in this slice. The delivery report MUST record why any larger size remains safer when protected delegation, governance, or operator-sandbox semantics would otherwise become ambiguous. Citation: `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [354, 374], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

## Deferrals

1. Physical migration of `work/**` and `memory/**` SHALL remain deferred. Backlog item `active-memory-physical-tier-migration` SHALL track a future migration with shims, tests, manifest, reference updates, and rollback notes.
2. The glossary deferral SHALL be reversed. The coder MUST add active-memory, durable-memory, archival-memory, internal-operating-content, and generated-machine-artifact terms in `memory/handbook/glossary.md` because the slice introduces those nouns.
3. Budget-warning tooling SHALL remain deferred through backlog item `active-memory-budget-warning-tool`.
4. One per-rule glob narrowing deferral SHALL remain available for mirror-parity risk and SHALL be tracked by backlog item `active-memory-rule-glob-ratification`. The coder MUST still audit every named rule and narrow every rule whose activation surface is safe.

## Implementation Tasks

1. When implementation starts, the coder MUST read this plan, the ADR draft, the touch-set, and the ratified Engineering Spec before editing files. The coder MUST keep writes inside `work/173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/touch-set.json`.
2. When memory-tier documentation starts, the coder MUST create `memory/handbook/memory-tiers.md`, `memory/active/README.md`, `memory/active/current.md`, and `memory/active/runs.md`. The coder MUST update `memory/handbook/glossary.md`, `memory/handbook/index.md`, and `memory/handbook/context-economy.md` with the tier model, active-memory routes, soft budgets, explicit-read rules, `simple task mode`, and escalation guidance. Rollback: remove only new active-memory files and revert handbook hunks.
3. When ADR work starts, the coder MUST add `memory/adr/0006-active-vs-archival-memory.md` from the draft and cite ADR-0003 or ADR-0004 as prior art. Rollback: remove the new ADR before any references depend on it.
4. When AGENTS slimming starts, the coder MUST reduce duplicated prose, preserve protected semantics, and add route pointers to memory-tier, `simple task mode`, escalation, documentation-impact, and policy-compliance guidance. Gate: human ratification MUST approve the protected-surface diff.
5. When Cursor rule work starts, the coder MUST audit `00-agents-md`, `tesseract-engineer`, `persona-designer`, `intake-analyst`, `supervisor`, `tech-lead`, and `tech-writer`. The coder MUST emit `rule-audit.md` with prior globs, new globs, status, and rationale. Gate: mirrored rule diffs MUST receive human ratification.
6. When indexing and reporting work starts, the coder MUST keep archival and generated paths excluded in `.cursorindexingignore`, keep `memory/active/**` indexable, extend `tools/context-budget-report.mjs` with the seven tier groups, and update `tools/context-budget-report.test.mjs`. Gate: `pnpm run context:budget:test` MUST pass.
7. When governance work runs, the coder MUST update `memory/backlog/index.yaml`, stage `documentation-impact.json` and `policy-compliance.json`, update the feature index routing fields, and prepare a delivery report that requests the seven operator validation steps. Rollback: revert backlog and feature-index additions if implementation aborts before review.

## Verification Gates

The coder MUST run `pnpm lint`, `pnpm typecheck`, `pnpm run check:phase0a`, `pnpm run context:budget:test`, and `node tools/context-budget-report.mjs`. The coder MUST verify that no historical artifact under `work/**`, `memory/**`, `inbox/out/**`, or `inbox/threads/**` was deleted. The operator MUST restart or reindex Cursor, verify custom-agent discovery, verify explicit reads for excluded paths, compare before and after context-budget output, and approve protected AGENTS and Cursor-rule changes before merge.
