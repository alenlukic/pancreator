# Internal

`src/internal/` contains repository implementation, tests, tooling, and archived
execution records that operators do not need to inspect for routine operation.

Operator-facing surfaces remain at the repository root, `src/inbox/`, `src/memory/`,
`src/personas/`, `src/pipelines/`, and `src/skills/`. Agents may read `src/internal/` when a
task explicitly requires implementation, tests, tooling, or historical run
reconstruction.

## Contents

- `packages/` — TypeScript workspace packages.
- `tests/` — repository-level compliance and contract fixtures.
- `tools/` — maintenance and validation scripts.
- `work_archive/` — completed run artifacts moved out of active `src/work/`.
