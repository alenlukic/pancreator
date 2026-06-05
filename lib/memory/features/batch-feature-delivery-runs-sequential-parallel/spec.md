---
title: Batch feature-delivery runs (sequential + parallel) Engineering Spec
feature_id: batch-feature-delivery-runs-sequential-parallel
task_id: 69803_0436_batch-feature-delivery-runs-sequential-parallel
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the Build-mode directive defines required outcomes R1–R6, seven acceptance checks, out-of-scope boundaries, and a plan snapshot without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive carries `source_channel: cursor-build-mode`, explicit R1–R6 requirements, AC1–AC7, and a six-step implementation order.
  - The canonical spec consolidates batch orchestration into one CLI subcommand, worktree pool extensions, sub-run lifecycle wiring, merge phase, batch ledger, NDJSON progress, and documentation without expanding into conflict-planner, merge-resolver, or full EnvIsolation.
  - The human_approval gate remains mandatory before any state transition. After ratification, the SDK-controlled feature-delivery runner MAY advance task `69803_0436_batch-feature-delivery-runs-sequential-parallel` with this artifact.
references:
  - kind: lines
    path: lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
    range: [29, 35]
    contentHash: 24d406e
    note: Source directive Problem and Goal — operators lack unattended multi-run orchestration with worktree isolation and integration merge.
  - kind: lines
    path: lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
    range: [37, 72]
    contentHash: 7f60373
    note: Source directive Required outcomes R1–R6 — CLI surface, worktree isolation, sub-run lifecycle, batch ledger, merge phase, and documentation.
  - kind: lines
    path: lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
    range: [74, 82]
    contentHash: 7f60373
    note: Source directive Acceptance criteria AC1–AC7 — sequential, parallel, dry-run, merge conflict, worktree tests, and repository validation.
  - kind: lines
    path: lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
    range: [84, 90]
    contentHash: 3e650e3
    note: Source directive Out of scope — conflict-planner, merge-resolver, EnvIsolation, cohort planning, auto-push, resume, and skip-preclose.
  - kind: lines
    path: docs/PRD.md
    range: [165, 173]
    contentHash: b18dc8f
    note: PRD US-6 Worktree Pool — batch orchestration is a sequential, operator-capped subset of parallel pipeline execution on worktrees.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts
    range: [360, 481]
    contentHash: 8255324
    note: startFeatureDelivery SDK auto-chain — each batch sub-run reuses this entry with repoRoot set to an isolated worktree checkout.
  - kind: lines
    path: lib/internal/packages/@pancreator/worktree/src/git-worktree-pool.ts
    range: [50, 86]
    contentHash: d46f25c
    note: GitWorktreePool Q7 single-lease guard — MUST extend for --parallel N greater than 1 via pool-state v2 and maxConcurrent.
  - kind: lines
    path: AGENTS.md
    range: [147, 177]
    contentHash: 88ab69d
    note: Feature-delivery SDK progress NDJSON contract — batch progress events extend the PAN_FD_PROGRESS=ndjson surface.
  - kind: lines
    path: AGENTS.md
    range: [248, 272]
    contentHash: 28515c0
    note: Librarian pre-close validation checklist — successful sub-runs MUST pass this bundle before close-artifacts.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [77, 82]
    contentHash: b385652
    note: Outbox filename timestamp-prefix requirement for merge-conflict artifacts under lib/inbox/out/.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [69, 75]
    contentHash: c36ec4b
    note: Canonical inbox queue path layout — batch copies gitignored directives from main checkout into each worktree before startFeatureDelivery.
  - kind: lines
    path: docs/PRD.md
    range: [641, 648]
    contentHash: 11f6887
    note: Feature-delivery intake stage declares loop.max_rounds 5 and gate human_approval.
---

# Spec

This Feature SHALL ship `pnpm -w exec pan batch run` so operators MAY pass multiple inbox directives and the CLI orchestrates feature-delivery runs sequentially by default or in parallel on isolated worktree branches. Each sub-run SHALL acquire a worktree under `.pan/worktrees/<task-id>/`, branch `pan/batch-<batchId>/<task-id>`, invoke `startFeatureDelivery` with SDK mode, run librarian pre-close validation and `close-artifacts` on success, and continue remaining entries when a sibling fails. After all sub-runs finish, the CLI SHALL merge successful branches into one integration branch in CLI argument order. The Feature extends `@pancreator/worktree` for multi-slot leases and named branch creation while documenting env-collision risk for `--parallel` greater than 1.

## Acceptance criteria

### WP-1 — CLI surface (R1)

- When an operator runs `pnpm -w exec pan batch run <inbox-entry>...`, the command SHALL accept one or more inbox entries relative to `lib/inbox/in/`.
- When the operator omits `--parallel`, the command SHALL default to `--parallel 1` and SHALL run sub-runs sequentially.
- When the operator sets `--parallel N` with `N` greater than 1, the command SHALL run at most `N` sub-runs concurrently on separate worktrees.
- When the operator supplies `--base <ref>`, the command SHALL create each run branch from that ref; otherwise the command SHALL default to the current HEAD of the main checkout.
- When the operator supplies `--merge-branch <name>`, the command SHALL use that name for the integration branch; otherwise the command SHALL default to a deterministic name derived from the batch id.
- When the operator supplies `--dry-run`, the command SHALL print planned branches, parallelism, inbox order, and base ref without git or worktree mutations.
- When the operator runs with `--dry-run`, the command SHALL exit zero and SHALL NOT invoke `startFeatureDelivery`.

### WP-2 — Worktree and branch isolation (R2)

- When a sub-run starts, the orchestrator SHALL acquire a worktree at `.pan/worktrees/<task-id>/` and branch `pan/batch-<batchId>/<task-id>` from `--base`.
- When `@pancreator/worktree` creates a worktree for batch mode, the package SHALL support named branch creation on `git worktree add`.
- When `@pancreator/worktree` manages concurrent batch slots, the package SHALL migrate pool-state from v1 to v2 and SHALL expose a `maxConcurrent` option defaulting to 1 to preserve the Q7 single-lease guard.
- When `@pancreator/worktree` holds `maxConcurrent` active leases and a new acquire arrives, the package SHALL reject the N+1 lease with a typed conflict error.
- When a sub-run starts in a worktree, the orchestrator SHALL copy the inbox directive from the main checkout into the worktree before calling `startFeatureDelivery` because gitignored inbox paths are not shared across checkouts.

### WP-3 — Sub-run lifecycle (R3)

- When a sub-run executes, the orchestrator SHALL call `startFeatureDelivery` with `repoRoot` set to the worktree path and SHALL require SDK invocation mode.
- When a sub-run reaches terminal status `complete`, the orchestrator SHALL run the librarian pre-close validation bundle from `AGENTS.md`, then `pnpm -w exec pan close-artifacts <task-id>`, then `git commit` on the run branch with artifacts produced by closure.
- When a sub-run halts, returns an SDK error, fails pre-close validation, or fails `close-artifacts`, the orchestrator SHALL record the failure in the batch ledger and SHALL continue remaining entries without cancelling parallel siblings.
- When a sub-run finishes regardless of outcome, the orchestrator SHALL release the worktree lease and SHALL retain the run branch for the merge phase when the run succeeded.

### WP-4 — Batch ledger and progress (R4)

- When a batch starts, the orchestrator SHALL persist `work/<day>/batch-<batchId>/batch.json` recording `parallelism`, `baseRef`, `mergeBranch`, per-run outcomes, and merge status.
- When `PAN_FD_PROGRESS=ndjson` is set, the orchestrator SHALL emit batch-level NDJSON progress events with kinds `batch_enter`, `batch_run_start`, `batch_run_complete`, `batch_run_failed`, `batch_slot_free`, `batch_merge_start`, and `batch_complete` on stderr.
- When a batch progress event is emitted, the event SHALL include `batchId`, the affected `taskId` when applicable, and an RFC3339 `atIso` timestamp consistent with existing feature-delivery progress events.

### WP-5 — Merge phase (R5)

- When all sub-runs finish, the orchestrator SHALL create `--merge-branch` in the main checkout from `--base`.
- When merging successful run branches, the orchestrator SHALL merge in CLI argument order with `git merge --no-ff`, not completion order.
- When `git merge --no-ff` encounters a conflict, the orchestrator SHALL stop the merge phase, record conflict paths in `batch.json`, write one timestamp-prefixed outbox artifact under `lib/inbox/out/` per `lib/memory/features/timestamp-naming-conventions/spec.md`, and exit non-zero.
- When the merge phase stops on conflict, the orchestrator SHALL NOT push to any remote.

### WP-6 — Documentation (R6)

- When an operator reads `OPERATION.md`, the operator SHALL find batch run documentation with sequential and parallel examples and an env-collision caveat for `--parallel` greater than 1.
- When an operator reads `@pancreator/cli` README, the operator SHALL find `pan batch run` flag reference and copy-paste examples.
- When an operator reads `@pancreator/worktree` README, the operator SHALL find `maxConcurrent` pool behavior and pool-state v2 migration notes.

### WP-7 — Tests and repository validation (AC1–AC7)

- When tests run `pnpm -w exec pan batch run a.md b.md` with stub SDK transport, the first halted run SHALL NOT prevent the second from starting and only successful branches SHALL merge.
- When tests run `pnpm -w exec pan batch run --parallel 2 a.md b.md c.md`, at most two sub-runs SHALL execute concurrently and a freed slot SHALL start the next pending entry.
- When a sub-run succeeds in tests, the run SHALL reach `currentStage: complete`, pass pre-close validation, complete `close-artifacts`, and produce branch `pan/batch-<batchId>/<task-id>` with a commit.
- When tests run `--dry-run`, stdout or stderr SHALL show planned branches, parallelism, and inbox order without worktree directories under `.pan/worktrees/`.
- When merge-conflict tests run, `batch.json` SHALL contain conflict metadata and one outbox artifact SHALL exist under `lib/inbox/out/`.
- When `@pancreator/worktree` tests run, they SHALL cover named branch creation, pool-state v1 to v2 migration, and `maxConcurrent` lease rejection at N+1.
- When repository validation runs (`pnpm test`, `pnpm lint`, `pnpm typecheck`, and targeted batch CLI tests), every command SHALL exit zero before the implementation report is accepted.

## Out of scope

- `conflict-planner` touch-set analysis and automatic serialization per the source directive out-of-scope list.
- `merge-resolver` persona and Mergiraf or other semantic merge drivers per the source directive out-of-scope list.
- Full `EnvIsolation` port and database allocation; the Feature MAY document collision risk and MAY add an optional stub hook only.
- `pan plan-cohort`, backlog-driven batch selection, auto-push, and resume mid-batch merge per the source directive out-of-scope list.
- `--skip-preclose-validation` and dynamic parallelism adjustment mid-batch per the source directive out-of-scope list.
- Reading or writing `lib/inbox/notes/`; that path remains human-only per `lib/memory/handbook/inbox-lifecycle.md`.

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
