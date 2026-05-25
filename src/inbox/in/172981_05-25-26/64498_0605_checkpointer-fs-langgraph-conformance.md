---
title: checkpointer-fs conforms to LangGraph BaseCheckpointSaver v1
feature_id: checkpointer-fs-langgraph-conformance
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:02Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/checkpointer-fs/
    note: Current implementation is a file-store with an envelope-v1 type; it does not implement BaseCheckpointSaver.
  - kind: path
    path: docs/PRD.md
    note: §10 and §11 require checkpointer-fs to be a conformant BaseCheckpointSaver; §10 names KPI A19 as the gate.
  - kind: path
    path: src/memory/handbook/run-log-schema.md
    note: Run log carries checkpoint_seq; checkpointer-fs is the substrate that maps tess pause/resume/abort to LangGraph time-travel.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 3 step 3 mandates LangGraph checkpoint-saver test-suite green as a CI conformance gate.
---

# checkpointer-fs conforms to LangGraph BaseCheckpointSaver v1

## Problem

`@tesseract/checkpointer-fs` is currently an internal file store with a
Tesseract-specific `CheckpointEnvelopeV1` type. The PRD requires it to be a
verbatim conformant implementation of LangGraph.js's `BaseCheckpointSaver` v1
interface so that LangGraph's own test suite gates Tesseract checkpoints
(KPI A19). Without this, `tess pause | resume | rollback | snapshot` cannot
map cleanly to LangGraph `interrupt()` / `Command(goto)` / `checkpoint_id`
time-travel.

## Goal

Make `@tesseract/checkpointer-fs` a drop-in `BaseCheckpointSaver` v1 that
LangGraph.js's official test suite passes against, while preserving the
Tesseract-specific metadata fields (`worktree_commit`, `run_log_offset`).

## Required outcomes

1. `@tesseract/checkpointer-fs` exports a class that satisfies the
   `BaseCheckpointSaver` v1 interface from `@langchain/langgraph` (or the
   pinned major version) without adapter glue.
2. LangGraph's own checkpoint-saver test suite is wired as a vitest harness in
   the package and runs in CI.
3. Tesseract-specific fields live in `Checkpoint.metadata` per
   `src/memory/handbook/run-log-schema.md`; the `Checkpoint v1` shape itself
   stays verbatim.
4. The intervention manager's pause/resume/abort calls go through the saver's
   official methods, not a parallel persistence path.

## Acceptance criteria

- `pnpm --filter @tesseract/checkpointer-fs test` passes the LangGraph
  conformance suite plus the Tesseract metadata-extension tests.
- CI runs the conformance suite on every PR (see the CI test-aggregation
  intake item).
- A round-trip integration test writes a checkpoint, restarts a process, and
  resumes from the saved `checkpoint_id` without re-encoding metadata.
- The package README declares `stability: experimental` and cites the
  conformance suite as the authority.

## Out of scope

- SQLite or Postgres saver wrappers (deferred to M5+).
- LangGraph `Send` API parity work (Q16 deferral).

## Recommended downstream owners

- `tech-lead` for the conformance contract and metadata-extension shape.
- `tesseract-engineer` for the implementation and vitest harness.
- `reviewer` for the intervention-manager integration audit.
