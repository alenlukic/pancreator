# Implementation Plan - @daedaline/worktree

## Touch Set
- `src/internal/packages/@daedaline/worktree/**`
- `src/memory/features/daedaline-worktree/contracts/**`
- `src/memory/features/daedaline-worktree/spec.md`
- `src/memory/features/daedaline-worktree/plan.md`
- `src/memory/features/daedaline-worktree/tasks.md`

## Execution Steps
1. Implement and organize package files so they satisfy `daedaline.worktree.package_shape`.
2. Draft and maintain a README Quickstart flow that satisfies `daedaline.worktree.readme_ergonomics`.
3. Run package conformance checks and contract evaluation before Phase 2 handoff.

## Verification
- Evaluate the registered contracts in `contracts.index.json`.
- Run JSON-emitting checks used by package-shape gates (`tsc`, `vitest`, `publint`, `attw`, `eslint`).

## Risks
- Package-shape drift can break contract gating for downstream Phase 3 work.
- Quickstart drift can reduce onboarding quality and fail README ergonomics checks.
