# @pancreator/worktree

Git worktree pool with a persisted lease file and configurable concurrent lease
cap (PRD Q7). Worktrees live under `repoRoot/.pan/worktrees/<task-id>/`.

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/worktree run build
pnpm --filter @pancreator/worktree test
pnpm --filter @pancreator/worktree run typecheck
```

## Scope

- This package depends only on `@pancreator/core` and Node built-ins.
- CLI `pan worktree` and cohort parallelism are out of scope for this slice.

## Pool state v2

Pool state is stored at `.pan/worktrees/pool-state.json` as version `2`:

- `maxConcurrent` — maximum active leases (default `1` preserves the Q7
  single-pipeline guard for non-batch callers).
- `activeTaskIds` — task ids holding active leases.
- `slots` — per-task worktree path records (optional `branch` when created with
  `git worktree add -b`).

Version `1` state files migrate deterministically on read: `activeTaskId` becomes
`activeTaskIds`, and `maxConcurrent` defaults to `1`.

## `maxConcurrent` and batch mode

`GitWorktreePool` accepts `maxConcurrent` in its constructor. Batch
feature-delivery passes `--parallel N` as the pool cap so at most `N` sub-runs
hold leases concurrently. When active slots equal `maxConcurrent`, the next
`acquire` throws `WorktreePoolLeaseConflictError`.

Named branch creation:

```typescript
await pool.acquire(taskId, { ref: "main", branch: "pan/batch-<id>/<task-id>" });
```
