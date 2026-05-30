# Implementation Plan - @pancreator/contract

## Touch Set
- `src/internal/packages/@pancreator/contract/**`
- `src/memory/features/pancreator-contract/contracts/**`
- `src/memory/features/pancreator-contract/spec.md`
- `src/memory/features/pancreator-contract/plan.md`
- `src/memory/features/pancreator-contract/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `pancreator.contract.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `pancreator.contract.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
