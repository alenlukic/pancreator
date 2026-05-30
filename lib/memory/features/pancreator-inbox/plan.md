# Implementation Plan - @pancreator/inbox

## Touch Set
- `lib/internal/packages/@pancreator/inbox/**`
- `lib/memory/features/pancreator-lib/inbox/contracts/**`
- `lib/memory/features/pancreator-lib/inbox/spec.md`
- `lib/memory/features/pancreator-lib/inbox/plan.md`
- `lib/memory/features/pancreator-lib/inbox/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `pancreator.inbox.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `pancreator.inbox.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
