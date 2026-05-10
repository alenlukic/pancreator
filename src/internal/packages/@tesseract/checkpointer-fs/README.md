# @tesseract/checkpointer-fs

File-backed checkpoint envelopes under `<checkpoints-root>/<task_id>/<seq>.json` with a required `metadata.run_log_offset` that ties to the JSONL run log (see `/src/memory/handbook/run-log-schema.md`).

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/checkpointer-fs run build
pnpm --filter @tesseract/checkpointer-fs test
pnpm --filter @tesseract/checkpointer-fs run typecheck
```

`FsCheckpointStore` reads and writes `CheckpointEnvelopeV1` documents. LangGraph `BaseCheckpointSaver` adapter code is a separate integration step (Bootstrap Phase 3 follow-on).

## Scope

- This package depends only on `@tesseract/core` (and Node built-ins).
- Channel format follows whatever the pipeline compiler emits; the on-disk v1 contract is the offset linkage first.
