# @tesseract/run-logger

JSONL run-log writing for Tesseract: one record per line under `/work/<task-id>/run.log.jsonl`, with types aligned to the handbook `run-log-schema` and OpenTelemetry GenAI + OpenInference attribute names.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/run-logger run build
pnpm --filter @tesseract/run-logger test
pnpm --filter @tesseract/run-logger run typecheck
```

`appendRunLogRecord` appends a validated `RunLogRecord` and returns the starting byte `run_log_offset` for `metadata.run_log_offset` on checkpoints.

## Scope

- This package depends only on `@tesseract/core` (and Node built-ins).
- OTLP exporters, Phoenix, and Langfuse are integration targets; local JSONL is the first sink.
