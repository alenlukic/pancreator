# Implementation Plan - @daedaline/policy

## Touch Set
- `src/internal/packages/@daedaline/policy/**`
- `src/memory/features/daedaline-policy/contracts/**`
- `src/memory/features/daedaline-policy/spec.md`
- `src/memory/features/daedaline-policy/plan.md`
- `src/memory/features/daedaline-policy/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `daedaline.policy.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `daedaline.policy.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
