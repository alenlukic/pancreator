# @daedaline/worktree

Git worktree pool with a persisted lease file and a single active pipeline guard (PRD Q7). Worktrees live under `repoRoot/.ddl/worktrees/<task-id>/`.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/worktree run build
pnpm --filter @daedaline/worktree test
pnpm --filter @daedaline/worktree run typecheck
```

## Scope

- This package depends only on `@daedaline/core` and Node built-ins.
- CLI `ddl worktree` and cohort parallelism are out of scope for this slice.
