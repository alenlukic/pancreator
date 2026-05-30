# @pancreator/cli

The `pan` workspace CLI composes inbox, feature-delivery invocation, and
intervention primitives.

## Quickstart

```bash
pnpm install
pnpm --filter @pancreator/cli run build
pnpm --filter @pancreator/cli run test
```

```bash
pnpm -w exec pan inbox
pnpm -w exec pan run feature-delivery my-feature.md
pnpm -w exec pan feature new my-feature.md
pnpm -w exec pan status <task-id>
pnpm -w exec pan pause <task-id>
pnpm -w exec pan resume <task-id>
pnpm -w exec pan abort <task-id> --reason "superseded"
```

## Feature-delivery invocation

`run feature-delivery <inboxEntry>` and `feature new <inboxEntry>` read a single
file from `lib/inbox/in/`, load `lib/pipelines/feature-delivery.yaml`, derive a
feature id, and create these active-work artifacts.

`<inboxEntry>` MUST be relative to `lib/inbox/in/` (for example
`172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md`). Do not pass the
`lib/inbox/in/` prefix on the command line; legacy prefixed arguments are
stripped and normalized in persisted state.

- `work/<day>/<task-id>/state.json`
- `work/<day>/<task-id>/handoff.md`
- `work/<day>/<task-id>/run.log.jsonl`

This is a Phase-4 bootstrap invocation path. It prepares the state machine and
handoff for the first persona, but it does not call Cursor, a model transport, or
LangGraph automatically.

## Status and interventions

`pause`, `resume`, and `abort` append records under
`.pan/scheduler/interventions/<task-id>.jsonl`. `status <task-id>` reads the
active-work `state.json` and folds in the current intervention journal state.

Programmatic driver:

```typescript
import { parseAndRun } from "@pancreator/cli";

const exitCode = await parseAndRun(["run", "feature-delivery", "my-feature.md"], {
  repoRoot: process.cwd(),
});
process.exit(exitCode);
```
