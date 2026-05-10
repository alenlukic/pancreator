# @tesseract/worktree

Git worktree pool with a persisted lease file and a single active pipeline guard (PRD Q7). Worktrees live under `repoRoot/.tess/worktrees/<task-id>/`.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/worktree run build
pnpm --filter @tesseract/worktree test
pnpm --filter @tesseract/worktree run typecheck
```

## Scope

- This package depends only on `@tesseract/core` and Node built-ins.
- CLI `tess worktree` and cohort parallelism are out of scope for this slice.
