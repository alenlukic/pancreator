# Pancreator

*A simulated product organization for agentic software delivery.*

Pancreator gives operators and agents a shared, file-native delivery pipeline:
personas, pipeline stages, durable memory, inbox workflow, and the `pan` CLI.
This repository is the operating surface for running and hardening that loop in
real projects, not a frontend or design-skill showcase.

[Status](#current-status) · [Operator guide](OPERATION.md) · [AGENTS](AGENTS.md) · [Bootstrap](docs/BOOTSTRAP.md) · [PRD](docs/PRD.summary.md)

> Bootstrap note: Pancreator is in Bootstrap Phase 5 (`phase-5-in-progress`).
> Phases -1 through 4 are complete for tracking, and operators still invoke
> personas manually after `pnpm -w exec pan run feature-delivery`.

## Current status

- **Phase tracking:** `pancreator.yaml` records Bootstrap Phase 5 (`phase-5-in-progress`).
  Phases -1 through 4 are complete for tracking purposes.
- **Current focus:** Phase 5 M1 hardening per `docs/BOOTSTRAP.md` — US-9 evidence
  kit (`lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/`),
  knowledge-curation cron seed, and KPI baseline evidence.
- **Runtime caveat:** `pnpm -w exec pan run feature-delivery <inbox-entry>` creates
  the Phase-5 state machine and bounded prompts. Operators still invoke personas
  manually and advance with `pnpm -w exec pan advance`. See
  [OPERATION.md § Feature delivery loop](OPERATION.md#feature-delivery-loop).

## System overview

| Area | Path | Role |
|---|---|---|
| Operating contract | `AGENTS.md` | Cross-tool rules, routing, bootstrap status |
| Operator how-to | `OPERATION.md` | Inbox, feature-delivery loop, CLI, validation |
| Personas | `lib/personas/` | Agent roles and constraints |
| Skills | `lib/personas/skills/` | Reusable procedures |
| Handbook | `lib/memory/handbook/` | Canon: glossary, contracts, context economy |
| Inbox | `lib/inbox/in`, `out`, `threads` | Local transient comms (gitignored; `notes/` is human-only) |
| Memory | `lib/memory/` | ADRs, backlog, features, active pointers |
| Implementation | `lib/internal/` | Packages, tools, work archive |

## Key paths

- `pancreator.yaml` — live policy and bootstrap phase (`lib/memory/handbook/pancreator-config.md`)
- `docs/M1.index.md` — compact M1/bootstrap route map
- `docs/BOOTSTRAP.md` — full phase plan and exit criteria
- `docs/PRD.summary.md` / `docs/PRD.index.md` — compact PRD routing
- `docs/PRD.md` — full product requirements
- `lib/memory/active/current.md` — active-memory orientation
- `lib/memory/active/handoffs.md` — pointer-only handoff map
- `work/` — active runs (archived to `archive/work/`)
- `lib/internal/packages/` — TypeScript workspace packages
- `tests/` — repository tests and compliance fixtures
- `lib/internal/tools/` — validation and maintenance scripts
- `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/` — US-9
  greenfield evidence schema, fixture, evaluator, and KPI baseline evidence (Phase 5)

## Architecture and core docs

- [System architecture ADR](lib/memory/adr/0002-system-architecture-map.md)
- [Backlog tracking ADR](lib/memory/adr/0001-backlog-tracking.md)
- [M1 route map](docs/M1.index.md)
- [Bootstrap plan](docs/BOOTSTRAP.md)
- [PRD summary](docs/PRD.summary.md) · [PRD index](docs/PRD.index.md) · [Full PRD](docs/PRD.md)
- [Operating contract](AGENTS.md)
- [Operator how-to](OPERATION.md)
