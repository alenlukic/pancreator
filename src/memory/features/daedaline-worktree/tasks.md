# Task List - @daedaline/worktree

- [x] T1: `GitWorktreePool` + `WorktreePool` interface; path validation under `.ddl/worktrees/`; `acquire` / `release` / `list`; persisted `pool-state.json`; Q7 single-pipeline lease; injectable `GitOps` with `createNodeGitOps` and `createMemoryGitOps`.
- [x] T2: README Quickstart with explicit `pnpm --filter` commands (package shape + ergonomics intent).
- [x] T3: Vitest coverage for lease conflict, idempotent acquire, persistence across pool instances, release, invalid root, unknown release.
- [ ] T4: **Deferred:** real-git integration test in CI; cross-process file locking for `pool-state.json`; automatic orphan worktree GC.
