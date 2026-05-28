# Implementation Plan - @daedaline/adopter-scan

## Touch Set
- `src/internal/packages/@daedaline/adopter-scan/**`
- `src/memory/features/daedaline-adopter-scan/contracts/**`
- `src/memory/features/daedaline-adopter-scan/spec.md`
- `src/memory/features/daedaline-adopter-scan/plan.md`
- `src/memory/features/daedaline-adopter-scan/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `daedaline.adopter_scan.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `daedaline.adopter_scan.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
