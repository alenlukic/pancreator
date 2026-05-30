# Docs Operator README v1 Intake Request

## Feature ID
`docs-operator-readme-v1`

## Goal
Refresh operator-facing README documentation so a new operator can quickly understand current status, system overview, usage, and where architecture canon lives.

## Scope (explicit files allowed)
- `README.md`
- `lib/memory/adr/` (link targets only; no ADR rewrites unless explicitly required by touch-set)

## Required outputs (spec/plan/touch-set + target docs/artifacts)
- **Spec:** concise README refresh spec with required sections and audience assumptions.
- **Plan:** update sequence for status, overview, usage instructions, and architecture references.
- **Touch-set:** exact files and sections proposed for edit.
- **Artifacts:** updated `README.md` containing current status, high-level overview, usage guidance, and explicit links to architecture ADR document(s).

## Acceptance criteria
- README includes a clearly labeled current status section.
- README includes a concise project overview and operator usage section.
- README includes link(s) to architecture ADR(s), including the system-map ADR when available.
- Spec, plan, and touch-set are provided and align with actual edits.

## Out of scope
- Code changes outside documentation.
- Policy/governance rule changes.
