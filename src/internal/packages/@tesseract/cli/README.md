# @tesseract/cli

The `tess` workspace CLI composes inbox, feature-delivery invocation, and
intervention primitives.

## Quickstart

```bash
pnpm install
pnpm --filter @tesseract/cli run build
pnpm --filter @tesseract/cli run test
```

```bash
pnpm -w exec tess inbox
pnpm -w exec tess run feature-delivery my-feature.md
pnpm -w exec tess feature new my-feature.md
pnpm -w exec tess status <task-id>
pnpm -w exec tess pause <task-id>
pnpm -w exec tess resume <task-id>
pnpm -w exec tess abort <task-id> --reason "superseded"
```

## Feature-delivery invocation

`run feature-delivery <inboxEntry>` and `feature new <inboxEntry>` read a single
file from `src/inbox/in/`, load `src/pipelines/feature-delivery.yaml`, derive a
feature id, and create these active-work artifacts:

- `src/work/<day>/<task-id>/state.json`
- `src/work/<day>/<task-id>/handoff.md`
- `src/work/<day>/<task-id>/run.log.jsonl`

This is a Phase-4 bootstrap invocation path. It prepares the state machine and
handoff for the first persona, but it does not call Cursor, a model transport, or
LangGraph automatically.

## Status and interventions

`pause`, `resume`, and `abort` append records under
`.tess/scheduler/interventions/<task-id>.jsonl`. `status <task-id>` reads the
active-work `state.json` and folds in the current intervention journal state.

Programmatic driver:

```typescript
import { parseAndRun } from "@tesseract/cli";

const exitCode = await parseAndRun(["run", "feature-delivery", "my-feature.md"], {
  repoRoot: process.cwd(),
});
process.exit(exitCode);
```
