# PRD summary (orientation)

This file is a **compact orientation** for agents and operators. It MUST NOT
replace `docs/PRD.md` for line-anchored citations, contract authoring, or detailed
MVP scope. Read full `docs/PRD.md` when the task requires those surfaces.

## What Pancreator is

Pancreator is a **simulated product-organization** for agentic software
delivery: personas, pipelines, durable `/lib/memory/`, a file inbox, and a future
control plane (`pnpm -w exec pan` for feature-delivery, init, and inbox flows).

## MVP focus (from PRD)

- **Personas:** Named roles (supervisor, intake-analyst, tech-lead, coder,
  reviewer, qa-tester, librarian, tech-writer, adopter, plus meta personas) with explicit
  tools and gates.
- **Pipelines:** Declarative stage graphs; flagship `feature-delivery` covers
  intake through ship with human approval gates.
- **Memory:** Handbook canon, ADRs, backlog, per-Feature folders under
  `/lib/memory/features/<id>/` with `spec.md` as the Engineering Spec.
- **Governance:** Dual-anchor citations, documentation-impact decisions, local
  stage only (no auto-push); version control is operator-owned at n=1 scale.

## Runtime policy in this repo

`pancreator.yaml` holds live runtime policy (`project_root`, `runner`,
`risk_tier`). Bootstrap phases −1 through 5 are closed (M1 ratified 2026-05-31);
closed-phase records live in `docs/BOOTSTRAP.md` and
`lib/memory/features/bootstrap-phase-*`. Current work routes through inbox and
`lib/memory/active/current.md`. The `pan` CLI invokes `feature-delivery` with
optional SDK mode (`runner.cursor.invocation: sdk`). Full LangGraph automatic
execution remains M2+.

M1 US-8 proof is package-boundary enforcement (no horizontal primitive deps, sub-path
exports, CI conformance) rather than standalone `examples/` apps. `chat-with-persona`
runtime and example apps are backlog-deferred past M1; see `lib/memory/backlog/index.yaml`.

## Where to go next

- M1/bootstrap routing: `docs/M1.index.md`
- Section map and deep topics: `docs/PRD.index.md`
- Full normative spec: `docs/PRD.md` only for exact requirements or citations
- Phase plan (closed historical record): `docs/BOOTSTRAP.md` only when `docs/M1.index.md` is insufficient
- Context and indexing policy: `lib/memory/handbook/context-economy.md`
- Live config and project root: `lib/memory/handbook/pancreator-config.md`

## Token-economy rule

For M1 work, agents SHOULD read `docs/M1.index.md` before full `docs/BOOTSTRAP.md` or
`docs/PRD.md`. Full-source reads require a task-specific reason: scope change, exact
wording, or dual-anchor citation repair.
