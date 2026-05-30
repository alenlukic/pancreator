# Implementation report — bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants

- **Task id:** `54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`
- **Feature id:** `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`

## Work package A — pancreator-* feature folders

For each of **20** folders under `lib/memory/features/pancreator-*/` the change set:

| Folder | `spec.md` | `delivery-report.md` | `index.json` |
| --- | --- | --- | --- |
| `pancreator-adopter-scan` | Prepended YAML (`title`, `feature_id`, `lifecycle_stage`) | Created stub report | Created stub index aligned to Phase-2-ish shape |
| `pancreator-checkpointer-fs` | same pattern | same | same |
| `pancreator-cli` | same pattern | same | same |
| `pancreator-contract` | same pattern | same | same |
| `pancreator-contract-runner-llm-judge` | same pattern | same | same |
| `pancreator-contract-runner-rego` | same pattern | same | same |
| `pancreator-contract-style` | same pattern | same | same |
| `pancreator-core` | same pattern | same | same |
| `pancreator-env-isolation` | same pattern | same | same |
| `pancreator-inbox` | same pattern | same | same |
| `pancreator-intervention` | same pattern | same | same |
| `pancreator-mcp-server` | same pattern | same | same |
| `pancreator-memory` | same pattern | same | same |
| `pancreator-notifier` | same pattern | same | same |
| `pancreator-persona` | same pattern | same | same |
| `pancreator-pipeline` | same pattern | same | same |
| `pancreator-policy` | same pattern | same | same |
| `pancreator-run-logger` | same pattern | same | same |
| `pancreator-runner-cursor` | same pattern | same | same |
| `pancreator-worktree` | same pattern | same | same |

- **Existing** `plan.md`, `tasks.md`, `contracts/`, `contracts.index.json`: left untouched.
- **`artifact_index.feature_folder.per_feature_index`**: `path` only (no nested `citation`) to avoid a self-referential `contentHash` loop when paired with canonical JSON rewriting; richer dual-anchor parity with `lib/memory/features/json-formatting/index.json` remains a librarian follow-up if required.
- **`lib/memory/features/index.json`**: each pancreator row now points at paired `index.json`, drops `per_feature_index_missing`, and `coverage_gaps` is cleared (empty).

**Dual-anchor cites (fingerprints):**

- Global index pairing: `{ "kind": "lines", "path": "lib/memory/features/index.json", "range": [1, 287], "contentHash": "e39c9f5" }`

## Work package B — Cursor tier filename consolidation

> **Superseded:** suffix files were restored; see **Correction** at end of this report.
> The deletion manifest below records the interim implement pass only.

**Deleted files** (24 total; subsequently restored):

| Path |
| --- |
| `.cursor/agents/adopter-standard.md` |
| `.cursor/agents/adopter-complex.md` |
| `.cursor/agents/coder-standard.md` |
| `.cursor/agents/coder-complex.md` |
| `.cursor/agents/compliance-auditor-standard.md` |
| `.cursor/agents/compliance-auditor-complex.md` |
| `.cursor/agents/contract-writer-standard.md` |
| `.cursor/agents/contract-writer-complex.md` |
| `.cursor/agents/intake-analyst-standard.md` |
| `.cursor/agents/intake-analyst-complex.md` |
| `.cursor/agents/librarian-standard.md` |
| `.cursor/agents/librarian-complex.md` |
| `.cursor/agents/persona-designer-standard.md` |
| `.cursor/agents/persona-designer-complex.md` |
| `.cursor/agents/reviewer-standard.md` |
| `.cursor/agents/reviewer-complex.md` |
| `.cursor/agents/supervisor-standard.md` |
| `.cursor/agents/supervisor-complex.md` |
| `.cursor/agents/tech-lead-standard.md` |
| `.cursor/agents/tech-lead-complex.md` |
| `.cursor/agents/tech-writer-standard.md` |
| `.cursor/agents/tech-writer-complex.md` |
| `.cursor/agents/pancreator-engineer-standard.md` |
| `.cursor/agents/pancreator-engineer-complex.md` |

**Retained projections:** `.cursor/agents/<persona>.md` ×12 plus `general-purpose.md`. Twelve persona mirrors received updated `description` and **Tier guidance** prose (no `-standard`/`-complex` filenames).

**.cursor/rules/\*.mdc:** unchanged (`touch-set.json` parity).

### Tooling and tests

- `lib/internal/tools/context-budget-report.mjs` — persona mirror stats replace alias/standard/complex filename counters; cites: `{ "kind": "lines", "path": "lib/internal/tools/context-budget-report.mjs", "range": [1, 424], "contentHash": "4439e83" }`
- `tests/context-budget-report.test.mjs` — asserts roster completeness and absence of suffix files; cites: `{ "kind": "lines", "path": "tests/context-budget-report.test.mjs", "range": [1, 140], "contentHash": "c0966ed" }`
- `lib/internal/packages/@pancreator/persona/lib/emit.ts` — JSDoc states single-file Cursor mirror policy; cites: `{ "kind": "lines", "path": "lib/internal/packages/@pancreator/persona/lib/emit.ts", "range": [1, 46], "contentHash": "35b1382" }`

## Documentation updates

| Path | Summary |
| --- | --- |
| `AGENTS.md` §3–§4 | Single-file persona projections; tiers via handbook + harness model picker |
| `lib/memory/handbook/subagent-model-tiers.md` | Migration rationale + tier table rewrite + Cursor example subsection |
| `lib/memory/handbook/persona-spec.md` | §5.1 rules, preamble, integration contract, §9 gate |
| `lib/memory/handbook/context-economy.md` | `simple task mode` delegation, model escalation table row, indexer maintenance bullet |
| `lib/memory/handbook/operator-output-contract.md` | Invocation examples (`/coder`, persona table column) |

**Dual-anchor cites:**

- `{ "kind": "lines", "path": "AGENTS.md", "range": [1, 280], "contentHash": "696b2b9" }`
- `{ "kind": "lines", "path": "lib/memory/handbook/subagent-model-tiers.md", "range": [1, 109], "contentHash": "94471db" }`

## Documentation impact (`touch-set.json`)

- **applies:** `true`
- **rationale:** Agent projection layout and handbook invocation guidance mutated.
- **changed-surfaces:** per `documentation_impact.changed-surfaces` in `touch-set.json` (`AGENTS.md`, handbook pages, global feature index).

## Adjacent authoring

- `lib/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/spec.md` — references refreshed for `subagent-model-tiers` and representative `pancreator-cli/spec.md`; work-package prose aligned with preserved contract surfaces.

## JSON corpus maintenance

Ran `migrate-json-formatting --write` with `PANCREATOR_MIGRATION_GO=1` so new `*.json` match repository canonical JSON policy (fixes `repository JSON files use two-space formatting` gate).

## Validation commands

| Command | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | **pass** (81/81) |
| `node lib/internal/tools/check-phase-0a-scaffold.mjs` | **pass** |
| `node lib/internal/tools/context-budget-report.mjs` | **pass** |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | **pass** |

## Pre-existing observations

- `node --test` stderr shows `fatal: not a git repository` lines from inbox migration tests probing git rungs in a sanitized environment; suites still **pass**.

## Blockers / deferrals

- **None.** Optional follow-up: restore full dual-anchor block on `per_feature_index` when librarian tooling can stabilize self-citations.

## Correction — Work package B mirrors restored (post-review)

Work package B suffix deletion was **reverted** after operator review: removing
`-standard`/`-complex` mirrors regressed tier selection (committed per-tier `model:`
frontmatter, touch-set-safe invocation via `/persona-complex`, separate Cursor cache
entries per tier).

**Restored from `HEAD` (minimal):**

- All **24** `.cursor/agents/*-{standard,complex}.md` files
- Twelve `.cursor/agents/<persona>.md` backward-compatible aliases
- `AGENTS.md` §3–§4, `subagent-model-tiers.md`, impacted handbook pages,
  `context-budget-report.mjs`, `tests/context-budget-report.test.mjs`, `emit.ts`

**Canonical tier invocation (restored):**

| Tier | Invoke |
| --- | --- |
| Standard (default) | `/persona-standard` or `/persona` (alias) |
| Complex (escalation) | `/persona-complex` |

Work package A (20 `pancreator-*` folder normalization) is unchanged.
