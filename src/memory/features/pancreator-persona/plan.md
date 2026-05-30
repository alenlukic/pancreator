# Implementation Plan - @pancreator/persona

## Touch Set
- `src/internal/packages/@pancreator/persona/**`
- `src/memory/features/pancreator-persona/contracts/**`
- `src/memory/features/pancreator-persona/spec.md`
- `src/memory/features/pancreator-persona/plan.md`
- `src/memory/features/pancreator-persona/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `pancreator.persona.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `pancreator.persona.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
