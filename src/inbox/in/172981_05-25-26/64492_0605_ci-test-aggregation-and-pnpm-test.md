---
title: CI runs the full vitest + node-test suite under pnpm test
feature_id: ci-test-aggregation
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:08Z
references:
  - kind: path
    path: package.json
    note: No top-level "test" script; named entries (migration:test, context:budget:test, repo:structure:test) cover only a subset.
  - kind: path
    path: .github/workflows/
    note: CI runs build, lint, typecheck, attw, publint, scaffold check, and migration tests but does NOT run turbo run test.
  - kind: path
    path: src/work/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md
    note: Finding n-01 records the missing pnpm test aggregator and the friction it creates.
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/run.test.ts
    note: Existing vitest specs (e.g., feature-delivery-run.test.ts) are not exercised by CI.
---

# CI runs the full vitest + node-test suite under pnpm test

## Problem

The repository has 32+ vitest spec files across `@tesseract/*` packages and
several `node --test` suites under `tests/`. CI runs `lint`, `typecheck`,
`attw`, `publint`, `check:phase0a`, and the migration / context-budget /
repo-structure node-test suites — but it never runs `turbo run test` or
`pnpm -r test`. The package vitests are dead weight in CI today. There is
also no top-level `pnpm test` aggregator, so operators must invoke each
named script individually.

## Goal

Wire a single `pnpm test` command that runs every test suite the repository
ships, then add it to the CI workflow so package-level regressions are
caught on every PR.

## Required outcomes

1. `package.json` adds a `"test"` script that runs:
   - `turbo run test` (every `@tesseract/*` package vitest);
   - the existing node-test suites (`tests/repo-structure.test.mjs`,
     `tests/migrate-json-formatting.test.mjs`, the migration test, the
     context-budget test).
2. Each `@tesseract/*` package declares its `test` script in
   `package.json` so `turbo run test` actually executes the vitest config
   that already exists.
3. The CI workflow under `.github/workflows/` runs `pnpm test` after the
   existing `lint`, `typecheck`, `attw`, and `publint` gates.
4. Vitest configurations exclude integration smoke tests that need external
   services; those run in a separate optional CI job.
5. The compliance-auditor persona's tool grant is reconciled with the
   actual `pnpm test` command shape.

## Acceptance criteria

- A fresh checkout, `pnpm install`, then `pnpm test` runs every spec and
  exits zero (or non-zero with a clear failure surface).
- CI fails when any vitest spec fails; CI logs make the failing package
  obvious.
- The compliance-auditor `pnpm test:*` reference resolves to a real entry.
- Total CI runtime increase is recorded in the delivery report and stays
  under a documented ceiling (recommend ≤ 3 minutes additional wallclock).

## Out of scope

- Adding new tests beyond what already exists in the repository.
- Coverage gating (deferred to M2 threshold-policy work).

## Recommended downstream owners

- `tesseract-engineer` for the `pnpm test` aggregator and per-package
  `test` scripts.
- `coder` for CI workflow wiring.
- `reviewer` for the runtime-budget audit.
