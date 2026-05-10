# Architecture System Map v1 Intake Request

## Feature ID
`architecture-system-map-v1`

## Goal
Create an ADR-first architecture system map that gives operators a current, navigable view of repo components and their relationships.

## Scope (explicit files allowed)
- `src/memory/adr/` (new ADR for system map)
- `README.md` (add or update link to the ADR)

## Required outputs (spec/plan/touch-set + target docs/artifacts)
- **Spec:** concise feature spec for architecture map intent, audience, and boundaries.
- **Plan:** ordered implementation plan covering ADR drafting, Mermaid diagram authoring, and README linkage.
- **Touch-set:** exact file list to be changed before edits begin.
- **Artifacts:** ADR containing a Mermaid architecture diagram first, plus a README link pointing to that ADR.

## Acceptance criteria
- ADR is created under `src/memory/adr/` and contains an operator-usable Mermaid system map.
- ADR content presents diagram-first structure (diagram appears before detailed prose sections).
- `README.md` includes a working link to the new architecture ADR.
- Spec, plan, and touch-set are present and internally consistent.

## Out of scope
- Refactoring code or changing runtime behavior.
- Rewriting non-architecture handbook or persona content.
