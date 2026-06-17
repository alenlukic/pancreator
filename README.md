# Pancreator

*A simulated product organization for agentic software delivery.*

Pancreator gives operators a shared, file-native delivery pipeline: personas,
pipeline stages, durable memory, inbox workflow, and the `pan` CLI. This
repository is the harness for running and hardening that loop in real projects.

**[Operator guide → OPERATION.md](OPERATION.md)**

## What you get

| Area | Path |
|---|---|
| Operator procedures | [`OPERATION.md`](OPERATION.md) |
| Personas and pipelines | `pancreator/lib/personas/`, `pancreator/lib/pipelines/` |
| Active work pointers | `pancreator/lib/memory/active/current.md` |
| Inbox (local, gitignored) | `pancreator/lib/inbox/in`, `out`, `threads` |
| CLI policy | `pancreator/pancreator.yaml` |

## Key paths

- `pancreator/pancreator.yaml` — live policy and `project_root`
- `pancreator/lib/memory/active/current.md` — what is active now
- `pancreator/.pan/work/` — active feature-delivery runs (archived to `pancreator/.pan/archive/work/` after close)
- `pancreator/lib/internal/packages/` — TypeScript packages (`pan` CLI and runtime)

## Internal surfaces (explicit-read)

These paths are excluded from default semantic indexing. Humans open them when
needed; agents load them only when the task requires them.

- [`AGENTS.md`](AGENTS.md) — agent operating instructions
- [`pancreator/.docs/`](pancreator/.docs/) — product requirements and bootstrap history
- `.cursor/` — local Cursor IDE runtime (gitignored; run `pan cursor-sync` after clone)
