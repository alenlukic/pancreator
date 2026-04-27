# Implementation Plan - @tesseract/contract-style

## Touch Set
- `packages/@tesseract/contract-style/**`
- `memory/features/tesseract-contract-style/contracts/**`
- `memory/features/tesseract-contract-style/spec.md`
- `memory/features/tesseract-contract-style/plan.md`
- `memory/features/tesseract-contract-style/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `tesseract.contract_style.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `tesseract.contract_style.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
