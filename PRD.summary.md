# PRD summary (orientation)

This file is a **compact orientation** for agents and operators. It MUST NOT
replace `PRD.md` for line-anchored citations, contract authoring, or detailed
MVP scope. Read full `PRD.md` when the task requires those surfaces.

## What Tesseract is

Tesseract is a **simulated product-organization** for agentic software
delivery: personas, pipelines, durable `/memory/`, a file inbox, and a future
control plane (`tess` CLI is not wired in this repository yet).

## MVP focus (from PRD)

- **Personas:** Named roles (supervisor, intake-analyst, tech-lead, coder,
  reviewer, librarian, tech-writer, adopter, plus meta personas) with explicit
  tools and gates.
- **Pipelines:** Declarative stage graphs; flagship `feature-delivery` covers
  intake through ship with human approval gates.
- **Memory:** Handbook canon, ADRs, backlog, per-Feature folders under
  `/memory/features/<id>/` with `spec.md` as the Engineering Spec.
- **Governance:** Dual-anchor citations, documentation-impact decisions,
  policy-compliance artifacts for non-`work/` structural changes, local stage
  only (no auto-push).

## Bootstrap state in this repo

Handbook seeds, personas, skills, and backlog tracking exist. Executable
pipeline YAML and `tess` runtime are still future work; operators follow
`BOOTSTRAP.md` and `AGENTS.md` for manual phase boundaries.

## Where to go next

- Section map and deep topics: `PRD.index.md`
- Full normative spec: `PRD.md`
- Phase plan: `BOOTSTRAP.md`
- Context and indexing policy: `memory/handbook/context-economy.md`
