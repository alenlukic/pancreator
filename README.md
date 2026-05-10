# Tesseract Operator Entry Point

Tesseract is in bootstrap. This README is the operator-facing start page for
the current manual workflow.

## 1) Current status

- **Current state:** handbook seeds under `src/memory/handbook/` are present.
  Meta-personas and meta-skills are present. The full Phase-1 MVP persona
  roster is present, with corresponding Cursor shims and MVP skills. Backlog
  tracking foundation is present through ADR-0001, backlog format, and backlog
  index.
- **Not implemented yet:** `tess` CLI/runtime execution is not wired in this
  repo yet.
- **Not populated yet:** `src/pipelines/` and `src/ensembles/` are not populated with
  executable definitions yet.

## 2) System overview

The root directory is the operator entry point. The `docs/` directory contains high-level product/bootstrap documents. The `tests/` directory contains repository-level tests and compliance fixtures. The `src/` directory contains the operating corpus and implementation surfaces.

- **Personas (`src/personas/`)** define agent roles and constraints.
- **Skills (`src/skills/`)** define reusable operating procedures.
- **Handbook canon (`src/memory/handbook/`)** is the source of truth for glossary,
  persona spec, contract format, and contract style.
- **Inbox (`src/inbox/in`, `src/inbox/out`, `src/inbox/threads`)** is the operator control
  plane for requests and staged responses. `src/inbox/notes/` is a human-only
  scratch area; agents MUST NOT read or modify it.
- **Memory (`src/memory/`)** holds architecture decisions, backlog, RFCs, runbooks,
  checkpoints, and other long-lived organizational state.
- **Internal (`src/internal/`)** holds implementation packages, tools, and
  completed work archives that operators do not need for routine operation.

## 3) How operators use it now (manual bootstrap workflow)

Operators SHALL run bootstrap work manually until runtime automation is wired:

1. Read `AGENTS.md` before starting any task. For active context, read
   `src/memory/active/current.md` unless simple task mode applies. For M1/bootstrap
   routing, read `docs/M1.index.md` before full `docs/BOOTSTRAP.md`. For product context,
   read `docs/PRD.summary.md` and `docs/PRD.index.md` before full `docs/PRD.md`; open full
   sources only when the task needs detailed requirements or line-anchored
   citations. Read `src/memory/handbook/context-economy.md` when tuning what loads
   into AI context versus explicit reads.
2. Treat `src/inbox/in/` as the canonical incoming work queue.
3. Execute the requested work directly in this repository and stage local diffs.
4. Place delivery artifacts or status reports in `src/inbox/out/` for review.
5. Obtain human ratification at each phase boundary before proceeding.

## 4) Planned CLI/runtime trigger path (not yet wired)

The following trigger path is future-state and **NOT implemented in this repo
state**:

- `tess inbox [list|read <id>|reply <id>]`
- `tess run <pipeline> <inbox-id|--feature <id>>`
- `tess status`
- `tess approve <task-id>`

These planned commands describe the intended operator UX and MUST NOT be
treated as currently available behavior.

## 5) Key paths map

- `AGENTS.md` — cross-tool operating contract and live bootstrap status.
- `docs/M1.index.md` — compact M1/bootstrap route map.
- `docs/BOOTSTRAP.md` — full phase plan, sequencing, and exit criteria.
- `docs/PRD.summary.md` and `docs/PRD.index.md` — compact PRD orientation and routing.
- `docs/PRD.md` — full product requirements and MVP scope.
- `src/README.md` — map of the source corpus under `src/`.
- `src/personas/` — role definitions.
- `src/skills/` — reusable procedures.
- `src/memory/handbook/` — canonical authoring references.
- `src/memory/active/current.md` — active-memory orientation (small, current context).
- `src/memory/adr/` — architecture decision records.
- `src/inbox/` — human-to-org request and response queue. `src/inbox/notes/` is a
  human-only sandbox excluded from agent traversal.
- `src/work/` — active task workspaces. Completed runs move to `src/internal/work_archive/`.
- `src/internal/packages/` — TypeScript workspace packages.
- `tests/` — repository-level tests and compliance fixtures.
- `src/internal/tools/` — validation and maintenance scripts.
- `docs/README.md` — guide to product/bootstrap document routing.
- `src/internal/work_archive/` — completed run artifacts; explicit-read only.

## 6) Architecture and core docs

- System architecture ADR: [`src/memory/adr/0002-system-architecture-map.md`](src/memory/adr/0002-system-architecture-map.md)
- Backlog tracking ADR: [`src/memory/adr/0001-backlog-tracking.md`](src/memory/adr/0001-backlog-tracking.md)
- M1 route map: [`docs/M1.index.md`](docs/M1.index.md)
- Bootstrap plan: [`docs/BOOTSTRAP.md`](docs/BOOTSTRAP.md)
- Product requirements summary: [`docs/PRD.summary.md`](docs/PRD.summary.md)
- Product requirements index: [`docs/PRD.index.md`](docs/PRD.index.md)
- Full product requirements: [`docs/PRD.md`](docs/PRD.md)
- Operating contract: [`AGENTS.md`](AGENTS.md)
