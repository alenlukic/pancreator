# @daedaline/intervention

Append-only intervention journal under `.ddl/scheduler/interventions/<taskId>.jsonl`, an `InterventionManager` for pause, resume, abort, and stage goto, and pure-data helpers shaped like LangGraph `interrupt()`, `Command(goto)`, and `checkpoint_id` time-travel for later wiring. MVP `ddl pause | resume | abort` lands with `@daedaline/cli`; this package is library-only.

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/intervention run build
pnpm --filter @daedaline/intervention test
pnpm --filter @daedaline/intervention run typecheck
```

## Scope

- This package depends only on `@daedaline/core` and Node built-ins.
- LangGraph is not a runtime dependency; structural types mirror future integration.
- Full US-10 seven-lever intervention spectrum is deferred to M2 per PRD.
