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
| Personas and pipelines | `lib/personas/`, `lib/pipelines/` |
| Active work pointers | `lib/memory/active/current.md` |
| Inbox (local, gitignored) | `lib/inbox/in`, `out`, `threads` |
| CLI policy | `pancreator.yaml` |

## Key paths

- `pancreator.yaml` — live policy and `project_root`
- `lib/memory/active/current.md` — what is active now
- `work/` — active feature-delivery runs (archived to `archive/work/` after close)
- `lib/internal/packages/` — TypeScript packages (`pan` CLI and runtime)

## Internal surfaces (explicit-read)

These paths are excluded from default semantic indexing. Humans open them when
needed; agents load them only when the task requires them.

- [`AGENTS.md`](AGENTS.md) — agent operating instructions
- [`docs/`](docs/) — product requirements and bootstrap history
