# Implementation Plan - @tesseract/policy

## Touch Set
- `internal/packages/@tesseract/policy/**`
- `memory/features/tesseract-policy/contracts/**`
- `memory/features/tesseract-policy/spec.md`
- `memory/features/tesseract-policy/plan.md`
- `memory/features/tesseract-policy/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `tesseract.policy.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `tesseract.policy.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
