# Tesseract

*A simulated product organization for agentic software delivery.*

Tesseract gives operators and agents a shared, file-native delivery pipeline:
personas, pipeline stages, durable memory, inbox workflow, and the `tess` CLI.
This repository is the operating surface for running and hardening that loop in
real projects, not a frontend or design-skill showcase.

[Status](#current-status) · [Operator guide](OPERATION.md) · [AGENTS](AGENTS.md) · [Bootstrap](docs/BOOTSTRAP.md) · [PRD](docs/PRD.summary.md)

> Bootstrap note: Tesseract is in Bootstrap Phase 5 (`phase-5-in-progress`).
> Phases -1 through 4 are complete for tracking, and operators still invoke
> personas manually after `pnpm -w exec tess run feature-delivery`.

## Current status

- **Phase tracking:** `tesseract.yaml` records Bootstrap Phase 5 (`phase-5-in-progress`).
  Phases -1 through 4 are complete for tracking purposes.
- **Current focus:** Phase 5 M1 hardening per `docs/BOOTSTRAP.md` — init-greenfield
  and adopt pipelines on real targets, knowledge-curation seed, and KPI baseline.
- **Runtime caveat:** `pnpm -w exec tess run feature-delivery <inbox-entry>` creates
  the Phase-5 state machine and bounded prompts. Operators still invoke personas
  manually and advance with `pnpm -w exec tess advance`. See
  [OPERATION.md § Feature delivery loop](OPERATION.md#feature-delivery-loop).

## System overview

| Area | Path | Role |
|---|---|---|
| Operating contract | `AGENTS.md` | Cross-tool rules, routing, bootstrap status |
| Operator how-to | `OPERATION.md` | Inbox, feature-delivery loop, CLI, validation |
| Personas | `src/personas/` | Agent roles and constraints |
| Skills | `src/skills/` | Reusable procedures |
| Handbook | `src/memory/handbook/` | Canon: glossary, contracts, context economy |
| Inbox | `src/inbox/in`, `out`, `threads` | Operator control plane (`notes/` is human-only) |
| Memory | `src/memory/` | ADRs, backlog, features, active pointers |
| Implementation | `src/internal/` | Packages, tools, work archive |

## Key paths

- `tesseract.yaml` — live policy and bootstrap phase (`src/memory/handbook/tesseract-config.md`)
- `docs/M1.index.md` — compact M1/bootstrap route map
- `docs/BOOTSTRAP.md` — full phase plan and exit criteria
- `docs/PRD.summary.md` / `docs/PRD.index.md` — compact PRD routing
- `docs/PRD.md` — full product requirements
- `src/memory/active/current.md` — active-memory orientation
- `src/memory/active/handoffs.md` — pointer-only handoff map
- `src/work/` — active runs (archived to `src/internal/work_archive/`)
- `src/internal/packages/` — TypeScript workspace packages
- `tests/` — repository tests and compliance fixtures
- `src/internal/tools/` — validation and maintenance scripts

## Architecture and core docs

- [System architecture ADR](src/memory/adr/0002-system-architecture-map.md)
- [Backlog tracking ADR](src/memory/adr/0001-backlog-tracking.md)
- [M1 route map](docs/M1.index.md)
- [Bootstrap plan](docs/BOOTSTRAP.md)
- [PRD summary](docs/PRD.summary.md) · [PRD index](docs/PRD.index.md) · [Full PRD](docs/PRD.md)
- [Operating contract](AGENTS.md)
- [Operator how-to](OPERATION.md)
