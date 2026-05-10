# Tesseract Operator Entry Point

Tesseract is in bootstrap. This README is the operator-facing start page for
the current manual workflow.

## 1) Current status

- **Current state:** handbook seeds under `memory/handbook/` are present.
  Meta-personas and meta-skills are present. The full Phase-1 MVP persona
  roster is present, with corresponding Cursor shims and MVP skills. Backlog
  tracking foundation is present through ADR-0001, backlog format, and backlog
  index.
- **Not implemented yet:** `tess` CLI/runtime execution is not wired in this
  repo yet.
- **Not populated yet:** `pipelines/` and `ensembles/` are not populated with
  executable definitions yet.

## 2) System overview

- **Personas (`personas/`)** define agent roles and constraints.
- **Skills (`skills/`)** define reusable operating procedures.
- **Handbook canon (`memory/handbook/`)** is the source of truth for glossary,
  persona spec, contract format, and contract style.
- **Inbox (`inbox/in`, `inbox/out`, `inbox/threads`)** is the operator control
  plane for requests and staged responses. `inbox/notes/` is a human-only
  scratch area; agents MUST NOT read or modify it.
- **Memory (`memory/`)** holds architecture decisions, backlog, RFCs, runbooks,
  checkpoints, and other long-lived organizational state.

## 3) How operators use it now (manual bootstrap workflow)

Operators SHALL run bootstrap work manually until runtime automation is wired:

1. Read `AGENTS.md` and `BOOTSTRAP.md` before starting any task. For product
   context, read `PRD.summary.md` first; open full `PRD.md` when the task needs
   detailed requirements or line-anchored citations (`PRD.index.md` lists
   triggers). Read `memory/handbook/context-economy.md` when tuning what loads
   into AI context versus explicit reads.
2. Treat `inbox/in/` as the canonical incoming work queue.
3. Execute the requested work directly in this repository and stage local diffs.
4. Place delivery artifacts or status reports in `inbox/out/` for review.
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
- `BOOTSTRAP.md` — phase plan, sequencing, and exit criteria.
- `PRD.md` — product requirements and MVP scope.
- `personas/` — role definitions.
- `skills/` — reusable procedures.
- `memory/handbook/` — canonical authoring references.
- `memory/active/current.md` — active-memory orientation (small, current context).
- `memory/adr/` — architecture decision records.
- `inbox/` — human-to-org request and response queue. `inbox/notes/` is a
  human-only sandbox excluded from agent traversal.
- `work/` — ephemeral task workspaces.

## 6) Architecture and core docs

- System architecture ADR: [`memory/adr/0002-system-architecture-map.md`](memory/adr/0002-system-architecture-map.md)
- Backlog tracking ADR: [`memory/adr/0001-backlog-tracking.md`](memory/adr/0001-backlog-tracking.md)
- Bootstrap plan: [`BOOTSTRAP.md`](BOOTSTRAP.md)
- Product requirements: [`PRD.md`](PRD.md)
- Operating contract: [`AGENTS.md`](AGENTS.md)
