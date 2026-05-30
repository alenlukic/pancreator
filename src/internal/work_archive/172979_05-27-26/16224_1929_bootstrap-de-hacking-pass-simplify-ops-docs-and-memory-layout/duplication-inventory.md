# Duplication inventory — bootstrap de-hacking pass

WP-6 category labels per feature spec: `docs-vs-handbook`, `cli-help-vs-handbook`, `parallel-agent-projections`, `overlapping-feature-specs`.

| Category | Topic | Locations before | Canonical after | Action |
|---|---|---|---|---|
| `docs-vs-handbook` | Feature-delivery operator loop | `README.md` §3–4 | `OPERATION.md` § Feature delivery loop | Moved; README links only |
| `docs-vs-handbook` | `pan advance` command table | `README.md` | `OPERATION.md` § pan CLI verbs | Moved |
| `docs-vs-handbook` | CLI `pnpm -w exec pan` prefix | `AGENTS.md`, `pancreator-config.md`, `operator-output-contract.md` | Unchanged — AGENTS states rule; handbook holds examples; OPERATION holds operator tables | Mirror only; no collapse |
| `docs-vs-handbook` | Subagent model tiers | `AGENTS.md` §4, `subagent-model-tiers.md` | `subagent-model-tiers.md` | No edit — intentional AGENTS route |
| `docs-vs-handbook` | Context economy / simple task mode | `AGENTS.md`, `context-economy.md` | `context-economy.md` | No edit — AGENTS route row only |
| `docs-vs-handbook` | Debt tier path | `AGENTS.md`, `PRD.md`, `memory-tiers.md` | `backlog-format.md` `tags: [debt]` | Consolidated (WP-4) |
| `docs-vs-handbook` | Librarian validation | CI workflows | `OPERATION.md` + `librarian.md` | Local pre-close gate; CI narrowed |
| `cli-help-vs-handbook` | CLI help strings in `run.ts` | Package source | `OPERATION.md` + `pancreator-config.md` | No drift found requiring `run.ts` edit |
| `parallel-agent-projections` | Persona canon vs Cursor projections | `src/personas/<name>.md`, `.cursor/agents/<name>-{standard,complex}.md`, `.cursor/rules/<name>.mdc` | Persona file + handbook `persona-spec.md` | No edit — compact projections are retrieval stubs; operator examples live in persona canon |
| `overlapping-feature-specs` | Superseded `m1-substrate-runtime-batch` intake skeleton | `src/memory/features/m1-substrate-runtime-batch/spec.md`, shipped `m1-substrate-runtime-batch-harness-loop-…` feature folder | `src/memory/backlog/drafts/m1-substrate-runtime-batch.md` + harness feature index | Relocated draft to backlog; deleted duplicate feature folder (WP-1) |

No ADR required; remaining dual locations are route pointers vs canonical handbook/operator docs.
