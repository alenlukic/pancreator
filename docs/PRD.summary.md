# PRD summary (orientation)

This file is a **compact orientation** for agents and operators. It MUST NOT
replace `docs/PRD.md` for line-anchored citations, contract authoring, or detailed
MVP scope. Read full `docs/PRD.md` when the task requires those surfaces.

## What Tesseract is

Tesseract is a **simulated product-organization** for agentic software
delivery: personas, pipelines, durable `/src/memory/`, a file inbox, and a future
control plane (`tess` CLI is not wired in this repository yet).

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

Handbook seeds, personas, skills, and backlog tracking exist. Executable
pipeline YAML and `tess` runtime are still future work; operators follow
`docs/BOOTSTRAP.md` and `AGENTS.md` for manual phase boundaries.

## Where to go next

- M1/bootstrap routing: `docs/M1.index.md`
- Section map and deep topics: `docs/PRD.index.md`
- Full normative spec: `docs/PRD.md` only for exact requirements or citations
- Phase plan: `docs/BOOTSTRAP.md` only when `docs/M1.index.md` is insufficient
- Context and indexing policy: `src/memory/handbook/context-economy.md`

## Token-economy rule

For M1 work, agents SHOULD read `docs/M1.index.md` before full `docs/BOOTSTRAP.md` or
`docs/PRD.md`. Full-source reads require a task-specific reason: scope change, exact
wording, or dual-anchor citation repair.
