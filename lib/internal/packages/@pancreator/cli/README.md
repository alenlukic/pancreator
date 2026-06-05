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
pnpm -w exec pan batch run <inbox-entry>...
```

## Batch feature-delivery runs

`batch run` orchestrates multiple inbox directives on isolated worktree branches.
SDK mode is required. Sub-runs continue on failure; successful branches merge in
CLI argument order.

```bash
# Sequential (default)
pnpm -w exec pan batch run a.md b.md

# Parallel (max 2 concurrent sub-runs)
pnpm -w exec pan batch run --parallel 2 a.md b.md c.md

# Dry-run
pnpm -w exec pan batch run --dry-run a.md b.md
```

| Flag | Description |
|---|---|
| `--parallel <n>` | Max concurrent sub-runs (default `1`) |
| `--base <ref>` | Base ref for run and merge branches |
| `--merge-branch <name>` | Integration branch name |
| `--dry-run` | Print plan without git/worktree mutations |

See `OPERATION.md` § "Batch feature-delivery runs" for ledger paths, progress
events, and the env-collision caveat for `--parallel` greater than `1`.

## Feature-delivery invocation

`run feature-delivery <inboxEntry>` and `feature new <inboxEntry>` read a single
file from `lib/inbox/in/` (gitignored local storage), load `lib/pipelines/feature-delivery.yaml`, derive a
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
