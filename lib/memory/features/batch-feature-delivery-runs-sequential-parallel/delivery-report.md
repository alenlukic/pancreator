# Delivery Report — batch-feature-delivery-runs-sequential-parallel

## Summary

This feature ships `pnpm -w exec pan batch run` as a batch orchestrator over existing
`startFeatureDelivery` SDK sub-runs on isolated worktree branches. `@pancreator/worktree`
gains pool-state v2 with `maxConcurrent` leases, named branch creation, and mutex-protected
parallel acquire. The CLI adds batch ledger persistence at `work/<day>/batch-<batchId>/batch.json`,
NDJSON progress events, merge phase with conflict outbox artifacts, and documentation in
`OPERATION.md` and package READMEs. Review declares `review_passes: true` with zero must-fix
findings; QA declares `qa_passes: true` on 18 touch-set tests across worktree pool, batch
orchestrator, and SDK progress suites.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/implementation-report.md",
  "range": [3, 10],
  "contentHash": "fbead17"
}
```

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/review.md",
  "range": [5, 6],
  "contentHash": "50170cd"
}
```

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/test-report.md",
  "range": [5, 5],
  "contentHash": "032fd7b"
}
```

## Architecture

- `pan batch run` acts as a thin orchestrator over existing `startFeatureDelivery` SDK
  auto-chain behavior; each inbox entry becomes an isolated sub-run on branch
  `pan/batch-<batchId>/<task-id>` inside `.pan/worktrees/<task-id>/`.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/plan.md",
  "range": [3, 13],
  "contentHash": "03ea2b5"
}
```

- `@pancreator/worktree` migrates pool-state from v1 to v2 with `maxConcurrent` (default 1),
  active-slot tracking, and N+1 lease rejection via `WorktreePoolLeaseConflictError`.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/plan.md",
  "range": [17, 23],
  "contentHash": "1594263"
}
```

- Parallel dispatch caps in-flight sub-runs at `--parallel N`; a failed sub-run records
  failure in `batch.json` and continues without cancelling parallel siblings.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/plan.md",
  "range": [35, 39],
  "contentHash": "9a91371"
}
```

- After all sub-runs finish, successful branches merge into `--merge-branch` in CLI argument
  order with `git merge --no-ff`; conflicts stop the merge phase and emit timestamp-prefixed
  outbox artifacts per ADR-0005.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/plan.md",
  "range": [41, 46],
  "contentHash": "4860399"
}
```

- Batch NDJSON progress extends the existing `PAN_FD_PROGRESS=ndjson` surface with
  `batch_enter`, `batch_run_start`, `batch_run_complete`, `batch_run_failed`,
  `batch_slot_free`, `batch_merge_start`, and `batch_complete` event kinds.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/plan.md",
  "range": [48, 53],
  "contentHash": "c6bfb55"
}
```

- Each sub-run acquires a worktree at `.pan/worktrees/<task-id>/`, calls
  `startFeatureDelivery` with `repoRoot` set to the worktree, runs pre-close validation
  and `close-artifacts` on success, and commits before merge.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/adr-draft.md",
  "range": [56, 81],
  "contentHash": "c94a331"
}
```

## Interfaces

- `runFeatureDeliveryBatch` orchestrates inbox normalization, worktree acquire, sub-run
  dispatch, merge phase, and ledger persistence for one batch invocation.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.ts",
  "range": [319, 330],
  "contentHash": "3a60b9e"
}
```

- `BatchRunArgs`, `BatchRunOutcome`, `BatchLedger`, and related types define the batch
  CLI argument surface and ledger schema at version 1.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.ts",
  "range": [28, 65],
  "contentHash": "256d065"
}
```

- `parseAndRun` registers `pan batch run` with `--parallel`, `--base`, `--merge-branch`,
  and `--dry-run` flags and wires batch NDJSON progress to stderr.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/run.ts",
  "range": [363, 419],
  "contentHash": "71e6fae"
}
```

- `FeatureDeliveryBatchProgressKind` and `createFeatureDeliveryBatchProgressReporter`
  emit batch-level NDJSON progress events when `PAN_FD_PROGRESS=ndjson`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-sdk-progress.ts",
  "range": [14, 20],
  "contentHash": "458747c"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-sdk-progress.ts",
  "range": [164, 177],
  "contentHash": "391a7a3"
}
```

- `GitWorktreePool` accepts `maxConcurrent` in options and enforces lease caps across
  concurrent batch sub-runs.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/worktree/src/git-worktree-pool.ts",
  "range": [26, 37],
  "contentHash": "b8e7a46"
}
```

- `GitOps.worktreeAdd` accepts an optional branch name for `git worktree add -b` during
  named branch creation.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/worktree/src/git-ops.ts",
  "range": [7, 31],
  "contentHash": "353e827"
}
```

- `WORKTREE_POOL_STATE_VERSION`, `WorktreePoolStateV2`, and `readPoolState` migrate v1
  pool-state files to v2 with `maxConcurrent` and `activeTaskIds`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/worktree/src/pool-state.ts",
  "range": [8, 23],
  "contentHash": "a86152e"
}
```

## Tradeoffs

- Sub-run success calls `git commit -am`, which stages only tracked modifications; untracked
  `close-artifacts` outputs may not appear in the run branch commit, weakening branch fidelity.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/review.md",
  "range": [15, 17],
  "contentHash": "d739f3c"
}
```

- Batch tests mock `gitCommit` and `closeArtifacts` but do not assert the full
  close-artifacts → commit chain with branch naming for AC3.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/review.md",
  "range": [17, 17],
  "contentHash": "d739f3c"
}
```

- Pre-close and `close-artifacts` failure branches in `runOne` lack dedicated test coverage;
  regression risk is moderate because hooks are injectable.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/review.md",
  "range": [21, 21],
  "contentHash": "a08c1c6"
}
```

- `--parallel` greater than 1 shares host environment variables and ports; full EnvIsolation
  remains out of scope and collision risk MUST be documented.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/adr-draft.md",
  "range": [90, 94],
  "contentHash": "c35fae2"
}
```

- Pool-state v2 migration adds compatibility surface in `@pancreator/worktree`; v1 state
  files MUST upgrade deterministically on read.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/adr-draft.md",
  "range": [93, 94],
  "contentHash": "c35fae2"
}
```

- A failed sub-run SHALL NOT cancel parallel siblings or block remaining inbox entries;
  operators accept partial batch success with selective merge.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/adr-draft.md",
  "range": [72, 74],
  "contentHash": "b48c7ef"
}
```

## Usage guidelines

1. Preview a sequential batch plan without git mutations:

   ```bash
   PAN_FD_PROGRESS=ndjson pnpm -w exec pan batch run --dry-run \
     lib/inbox/in/172970_06-05-26/entry-a.md \
     lib/inbox/in/172970_06-05-26/entry-b.md
   ```

   The passing test `dry-run prints plan without creating worktree slots` asserts exit code
   0, stderr contains `parallelism: 1` and inbox entry names, and no worktree slot
   directories are created.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.test.ts",
  "range": [119, 137],
  "contentHash": "05f30b1"
}
```

2. Run a sequential batch that continues after a halted first sub-run and merges only
   successful branches:

   ```bash
   pnpm -w exec pan batch run \
     --base HEAD \
     --merge-branch pan/batch-integration \
     lib/inbox/in/172970_06-05-26/entry-a.md \
     lib/inbox/in/172970_06-05-26/entry-b.md
   ```

   The passing test `continues after a halted first sub-run and merges only successful branches`
   asserts both sub-runs execute and exactly one `mergeNoFf` occurs.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.test.ts",
  "range": [139, 177],
  "contentHash": "26f840b"
}
```

3. Cap concurrent sub-runs at 2 with `--parallel 2`:

   ```bash
   pnpm -w exec pan batch run --parallel 2 \
     lib/inbox/in/172970_06-05-26/entry-a.md \
     lib/inbox/in/172970_06-05-26/entry-b.md \
     lib/inbox/in/172970_06-05-26/entry-c.md
   ```

   The passing test `runs at most two sub-runs concurrently for --parallel 2` asserts
   `maxInFlight <= 2` and `maxInFlight > 1` across three inbox entries.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.test.ts",
  "range": [179, 220],
  "contentHash": "83481bf"
}
```

4. On merge conflict, inspect `batch.json` merge metadata and the timestamp-prefixed artifact
   under `lib/inbox/out/`. The passing test `records merge conflicts in batch.json and writes
   an outbox artifact` asserts `merge.status` is `conflict`, conflict paths are recorded,
   and the outbox file exists.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.test.ts",
  "range": [221, 267],
  "contentHash": "1fbcc7b"
}
```

5. Batch orchestration requires `runner.cursor.invocation: sdk` in `pancreator.yaml`. The
   passing test `runFeatureDeliveryBatch rejects non-sdk invocation mode` asserts a throw
   when invocation is `manual`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-batch.test.ts",
  "range": [269, 290],
  "contentHash": "acf6e1d"
}
```

## Testing

The touch-set adds 18 passing Vitest cases across `@pancreator/worktree` (9 tests),
`feature-delivery-batch.test.ts`, and `feature-delivery-sdk-progress.test.ts`. Coverage
hits sequential continue-on-failure (AC1), parallel concurrency cap (AC2), dry-run plan
(AC4), merge conflict outbox (AC5), named branch creation, v1→v2 pool-state migration,
and N+1 lease rejection (AC6). Pre-existing full-repository failures (JSON.stringify
confinement, client build cache, SDK harness timeouts) remain excluded from the gate per
review and QA scope.

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/test-report.md",
  "range": [3, 6],
  "contentHash": "e38f647"
}
```

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/test-report.md",
  "range": [9, 13],
  "contentHash": "c956fa2"
}
```

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/review.md",
  "range": [37, 41],
  "contentHash": "9a01334"
}
```

```json
{
  "kind": "lines",
  "path": "work/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/implementation-report.md",
  "range": [44, 51],
  "contentHash": "a12f04d"
}
```
