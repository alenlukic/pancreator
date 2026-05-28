# @daedaline/run-logger

JSONL run-log writing for Daedaline: one record per line under `/src/work/<day>/<task-id>/run.log.jsonl`, with types aligned to the handbook `run-log-schema` and OpenTelemetry GenAI + OpenInference attribute names.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/run-logger run build
pnpm --filter @daedaline/run-logger test
pnpm --filter @daedaline/run-logger run typecheck
```

`appendRunLogRecord` appends a validated `RunLogRecord` and returns the starting byte `run_log_offset` for `metadata.run_log_offset` on checkpoints.

## Scope

- This package depends only on `@daedaline/core` (and Node built-ins).
- OTLP exporters and Phoenix import conformance live under `tests/run-logger-conformance/` (Option A). Run `pnpm test:run-logger-conformance` from the repository root.
- Langfuse and additional backends are deferred to M2; local JSONL remains the first sink.
