---
title: Cursor Token Economy Plan
feature_id: cursor-token-economy
stage: plan
next_owner: coder
references:
  - kind: lines
    path: lib/memory/features/cursor-token-economy/spec.md
    range: [121, 224]
    contentHash: TBD-on-commit
    note: Engineering Spec statement and acceptance criteria.
  - kind: lines
    path: lib/memory/features/cursor-token-economy/spec.md
    range: [226, 278]
    contentHash: TBD-on-commit
    note: Engineering Spec scope limits, human-ratification items, and deferrals.
  - kind: lines
    path: PRD.md
    range: [649, 658]
    contentHash: TBD-on-commit
    note: PRD plan stage requires plan, ADR draft, and touch-set artifacts.
---

# Cursor Token Economy Plan

## Architecture Summary

When this Feature enters implementation, the coder MUST shift routine Cursor retrieval from broad corpus loading to explicit, summary-first access. The implementation SHALL add a tracked root `.cursorindexingignore`, narrow Cursor rule activation, route context-budget decisions through a new handbook page, split PRD retrieval into summary and index entry points, and add a lightweight context-budget report command. The slice MUST preserve explicit reads for `PRD.md`, `BOOTSTRAP.md`, `lib/memory/**`, and `work/**`; MUST NOT delete historical artifacts; and MUST surface protected changes for human ratification before merge. This plan satisfies the Engineering Spec statement, acceptance criteria, scope limits, human-ratification block, and deferral policy. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [121, 224], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [226, 278], contentHash: TBD-on-commit}`.

## Implementation Tasks

1. When implementation starts, the coder MUST read the Engineering Spec, ADR draft, this plan, and the touch-set before editing files. The coder MUST keep writes inside `archive/work/172997_05-09-26/50909_1000_cursor-token-economy/touch-set.json`. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [1, 119], contentHash: TBD-on-commit}`; `{kind: lines, path: PRD.md, range: [649, 658], contentHash: TBD-on-commit}`.
2. When indexing policy work starts, the coder MUST add root `.cursorindexingignore` and MUST remove `.cursorindexingignore` from `.gitignore`. The file SHALL exclude `work/**`, `lib/inbox/out/**`, `lib/inbox/threads/**`, generated manifests, generated JSON write outputs, selected `lib/memory/**` JSON and delivery-report outputs, `pnpm-lock.yaml`, duplicate instruction surfaces, and `.cursor/agents/**` with an operator-confirmation comment. The coder MUST NOT add root `.cursorignore`. Citation: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [136, 163], contentHash: TBD-on-commit}`.
3. When Cursor rule audit starts, the coder MUST audit every `.cursor/rules/*.mdc` file and MUST record one rule-audit artifact at `archive/work/172997_05-09-26/50909_1000_cursor-token-economy/rule-audit.md`. The audit SHALL list each rule, prior glob set, new glob set, change status, and rationale. The coder MUST review at least `.cursor/rules/00-agents-md.mdc`, `.cursor/rules/pancreator-engineer.mdc`, `.cursor/rules/intake-analyst.mdc`, `.cursor/rules/tech-writer.mdc`, and `.cursor/rules/supervisor.mdc`. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [164, 173], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/inbox/in/token_economy.md, range: [112, 149], contentHash: TBD-on-commit}`.
4. When the `pancreator-engineer` rule changes, the coder MUST remove default `work/**/*` activation unless the rule specifically targets run logs, plans, reviews, or delivery reports. The coder SHOULD use narrower triggers for `lib/inbox/in/**/*.md`, packages, tools, tests, Pancreator config, handbook pages, skills, and `.cursor/rules/*.mdc`. Citation: `{kind: lines, path: lib/inbox/in/token_economy.md, range: [124, 147], contentHash: TBD-on-commit}`.
5. When a mirrored Cursor rule changes, the coder MUST flag the diff for human ratification before merge. When the audit finds an over-broad rule outside the named five, the coder MUST list it in `rule-audit.md` and MUST request human ratification before editing it. Citation: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [243, 266], contentHash: TBD-on-commit}`.
6. When context-economy documentation starts, the coder MUST create `lib/memory/handbook/context-economy.md` and MUST add a context-budgeting route to `lib/memory/handbook/index.md`. The page SHALL define default retrieval discipline, per-document read triggers, generated-manifest handling, and the indexed-versus-explicit-read split. Citation: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [174, 184], contentHash: TBD-on-commit}`.
7. When PRD retrieval work starts, the coder MUST create `PRD.summary.md` and `PRD.index.md`. The coder MUST update `AGENTS.md`, `README.md`, and relevant Cursor rule guidance so agents read `PRD.summary.md` first and load `PRD.md` only for product-spec detail, citation repair, or line-anchored requirements. AGENTS.md slimming MUST preserve tool-safety, no-auto-push, human-phase-boundary, inbox-discovery, delegation, documentation-impact, and policy-compliance semantics, and MUST receive human ratification before merge. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [185, 194], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [249, 254], contentHash: TBD-on-commit}`.
8. When the context-budget command starts, the coder MUST add `lib/internal/tools/context-budget-report.mjs` and MAY add a `package.json` script when it matches the existing script style. The command MUST report character counts and rough `chars / 4` token estimates for whole repo text, `work/**`, `lib/memory/**`, `PRD.md`, `AGENTS.md`, `.cursor/**`, `lib/personas/**`, `packages/**`, `pnpm-lock.yaml`, and generated JSON manifests. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [195, 203], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/inbox/in/token_economy.md, range: [228, 253], contentHash: TBD-on-commit}`.
9. When documentation-impact work runs, the coder MUST evaluate `lib/memory/handbook/index.md`, `lib/memory/handbook/context-economy.md`, `AGENTS.md`, `README.md`, `.cursor/rules/*.mdc`, and `lib/memory/backlog/index.yaml`. The coder MUST stage `archive/work/172997_05-09-26/50909_1000_cursor-token-economy/documentation-impact.json` and `archive/work/172997_05-09-26/50909_1000_cursor-token-economy/policy-compliance.json`. Citations: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [204, 224], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/inbox/in/token_economy.md, range: [255, 268], contentHash: TBD-on-commit}`.
10. When deferral review runs, the coder MUST update `lib/memory/backlog/index.yaml` for any deferred Cursor rule glob change, bulky generated-artifact migration, or future `.cursorignore` slice. The coder MUST record deferral rationale and backlog linkage in the documentation-impact artifact. Citation: `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [268, 278], contentHash: TBD-on-commit}`.
11. When verification runs, the coder MUST run lint, typecheck, Phase 0a scaffold checks, the context-budget report command, and a manual audit for historical artifact preservation. The delivery report MUST ask the operator to restart or reindex Cursor, rerun the two prior high-cache commands, record before and after totals, confirm explicit `@PRD.md`, `@BOOTSTRAP.md`, and selected `work/**` reads, and report `.cursor/agents/**` discovery regressions. Citations: `{kind: lines, path: lib/inbox/in/token_economy.md, range: [270, 297], contentHash: TBD-on-commit}`; `{kind: lines, path: lib/memory/features/cursor-token-economy/spec.md, range: [211, 216], contentHash: TBD-on-commit}`.

## Plan-Stage Risks

- If `.cursor/agents/**` exclusion breaks custom agent discovery, then the operator MUST reject merge until Cursor discovery passes after reindex.
- If AGENTS.md slimming loses protected semantics, then the human MUST reject the protected-surface diff before merge.
- If rule glob narrowing changes persona mirror behavior, then human ratification MUST precede merge.
- If `lib/internal/tools/context-budget-report.mjs` undercounts ignored or binary files, then the delivery report MUST label the metric as directional and MUST keep `chars / 4` wording.
