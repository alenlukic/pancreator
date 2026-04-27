# @tesseract/intervention

Append-only intervention journal under `.tess/scheduler/interventions/<taskId>.jsonl`, an `InterventionManager` for pause, resume, abort, and stage goto, and pure-data helpers shaped like LangGraph `interrupt()`, `Command(goto)`, and `checkpoint_id` time-travel for later wiring. MVP `tess pause | resume | abort` lands with `@tesseract/cli`; this package is library-only.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/intervention run build
pnpm --filter @tesseract/intervention test
pnpm --filter @tesseract/intervention run typecheck
```

## Scope

- This package depends only on `@tesseract/core` and Node built-ins.
- LangGraph is not a runtime dependency; structural types mirror future integration.
- Full US-10 seven-lever intervention spectrum is deferred to M2 per PRD.
