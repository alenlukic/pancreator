# Source Corpus

`lib/` contains the agentic operating corpus and internal implementation surfaces.
External operators enter through [`README.md`](../README.md) and
[`OPERATION.md`](../OPERATION.md). Agent operating instructions live in
`AGENTS.md` (explicit-read). Pancreator product docs: `.docs/`.

- `ensembles/` — future ensemble configurations.
- `inbox/` — operator request/response queue and thread history.
- `memory/` — active, durable, archival-index, and handbook memory surfaces; `memory/active/handoffs.md` stores pointer-only plan-to-execution state.
- `personas/` — canonical persona specifications.
- `pipelines/` — pipeline DAG definitions.
- `skills/` — reusable skill packs.
- `.pan/work/` — active task workspaces only, including compact `handoff.md` cards for delegated execution.
- `internal/` — implementation packages, validation tools, and completed work archive.
