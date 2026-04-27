# Implementation Plan - @tesseract/cli

## Touch Set
- `packages/@tesseract/cli/**`
- `memory/features/tesseract-cli/contracts/**`
- `memory/features/tesseract-cli/spec.md`
- `memory/features/tesseract-cli/plan.md`
- `memory/features/tesseract-cli/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `tesseract.cli.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `tesseract.cli.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
