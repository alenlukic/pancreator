# Implementation Plan - @daedaline/runner-cursor

## Touch Set
- `src/internal/packages/@daedaline/runner-cursor/**`
- `src/memory/features/daedaline-runner-cursor/contracts/**`
- `src/memory/features/daedaline-runner-cursor/spec.md`
- `src/memory/features/daedaline-runner-cursor/plan.md`
- `src/memory/features/daedaline-runner-cursor/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `daedaline.runner_cursor.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `daedaline.runner_cursor.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
