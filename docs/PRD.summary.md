# PRD summary (orientation)

This file is a **compact orientation** for agents and operators. It MUST NOT
replace `docs/PRD.md` for line-anchored citations, contract authoring, or detailed
MVP scope. Read full `docs/PRD.md` when the task requires those surfaces.

## What Tesseract is

Tesseract is a **simulated product-organization** for agentic software
delivery: personas, pipelines, durable `/src/memory/`, a file inbox, and a future
control plane (`pnpm -w exec tess` for feature-delivery, init, and inbox flows).

## MVP focus (from PRD)

- **Personas:** Named roles (supervisor, intake-analyst, tech-lead, coder,
  reviewer, librarian, tech-writer, adopter, plus meta personas) with explicit
  tools and gates.
- **Pipelines:** Declarative stage graphs; flagship `feature-delivery` covers
  intake through ship with human approval gates.
- **Memory:** Handbook canon, ADRs, backlog, per-Feature folders under
  `/src/memory/features/<id>/` with `spec.md` as the Engineering Spec.
- **Governance:** Dual-anchor citations, documentation-impact decisions,
  policy-compliance artifacts for non-`src/work/` structural changes, local stage
  only (no auto-push).

## Bootstrap state in this repo

`tesseract.yaml` tracks this repo at Bootstrap Phase 4 with status
`phase-4-ratified`. Phases -1 through 3 are treated as complete: the repo
has scaffold, handbook seeds, personas, skills, M1 contract feature folders,
Phase 3 substrate packages, and the five static MVP pipeline definition files.
The US-1 dogfood exit is ratified per `tesseract.yaml`. The `tess` CLI surface
invokes `feature-delivery` into a state-machine, handoff, and bounded
next-prompt scaffold; `tess advance` records validated stage artifacts.
Full automatic Cursor/model/LangGraph execution is not yet complete.

## Library-mode proof

`examples/library-script/` demonstrates PRD US-8: a standalone script imports only
`@tesseract/persona`, validates persona markdown, and emits `.cursor/agents/<name>.md`
plus `.cursor/rules/<name>.mdc` into a temp directory without reading `src/memory/`,
`src/inbox/`, or `tesseract.yaml`.

## Where to go next

- M1/bootstrap routing: `docs/M1.index.md`
- Section map and deep topics: `docs/PRD.index.md`
- Full normative spec: `docs/PRD.md` only for exact requirements or citations
- Phase plan: `docs/BOOTSTRAP.md` only when `docs/M1.index.md` is insufficient
- Context and indexing policy: `src/memory/handbook/context-economy.md`
- Live config and project root: `src/memory/handbook/tesseract-config.md`

## Token-economy rule

For M1 work, agents SHOULD read `docs/M1.index.md` before full `docs/BOOTSTRAP.md` or
`docs/PRD.md`. Full-source reads require a task-specific reason: scope change, exact
wording, or dual-anchor citation repair.
