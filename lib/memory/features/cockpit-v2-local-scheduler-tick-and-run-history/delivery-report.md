# Delivery Report — Cockpit v2 local scheduler tick and run history

## Summary

This feature delivery ships local automation execution and append-only JSONL run history for Cockpit v2. The `@pancreator/scheduler` package gains due evaluation, concurrency locks, run-log I/O, and tick orchestration under `.pan/scheduler/`. The CLI exposes `pnpm -w exec pan scheduler tick` with optional `--id` for manual dispatch. Cockpit calls dedicated Next.js routes for Run now and run-history reads. Automations UI components replace registry stubs with row selection, enabled Run now, expandable log excerpts, and running/error list badges. `OPERATION.md` documents cron and launchd one-liners. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and 70 touch-set tests pass across scheduler, CLI tick, and client focused suites.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [5, 12],
  "contentHash": "fa780c7"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [5, 5],
  "contentHash": "6208bd7"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [5, 5],
  "contentHash": "dc3dfbd"
}
```

## Architecture

- Each automation SHALL persist runs as append-only JSONL at `.pan/scheduler/runs/<automation-id>.jsonl` with terminal statuses `success`, `error`, `aborted`, or `skipped`, and the primitive SHALL materialize the directory on first write.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [58, 61],
  "contentHash": "04c00ca"
}
```

- Lock metadata SHALL live under `.pan/scheduler/` and SHALL enforce `policy.maxConcurrent` per automation; saturated locks SHALL append a `skipped` record naming the lock reason without dispatching.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [63, 65],
  "contentHash": "04c00ca"
}
```

- `pan scheduler tick` SHALL evaluate due enabled automations or honor `--id` for manual dispatch with `trigger: manual`; agent triggers SHALL invoke `CursorRunner`, and pan triggers SHALL execute `pnpm -w exec pan <subcommand>` without shell interpolation.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [67, 71],
  "contentHash": "04c00ca"
}
```

- When agent dispatch yields a `taskId`, the scheduler SHALL write intervention journal entries so existing `pan pause`, `pan resume`, and `pan abort` commands apply; abort SHALL update the matching run-log record to `status: aborted`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [73, 76],
  "contentHash": "04c00ca"
}
```

- Run now SHALL call `POST /api/automations/<id>/run` server-side and run history SHALL load via `GET /api/automations/<id>/runs`; the browser SHALL NOT shell out to `pan` directly.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [78, 80],
  "contentHash": "04c00ca"
}
```

- The implement stage SHALL extend `@pancreator/scheduler` with `due.ts` for cron evaluation, `tick.ts` with injected `agent` and `pan` executors, and path guards mirroring `@pancreator/intervention` discipline under `.pan/scheduler/`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/plan.md",
  "range": [21, 37],
  "contentHash": "11a8613"
}
```

## Interfaces

- `@pancreator/scheduler` exports `tickAutomations` and `aggregateTickExitCode` for due or manual dispatch with per-automation outcome aggregation and exit-code derivation.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/scheduler/src/tick.ts",
  "range": [36, 52],
  "contentHash": "5453f14"
}
```

- The run-log module exports `appendRunRecord`, `readRunRecordsNewestFirst`, and `abortSchedulerRunByTaskId` with `RunRecord` fields `runId`, `startedAt`, `finishedAt`, `status`, `trigger`, `stdoutSummary`, `stderrSummary`, and optional `taskId`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/scheduler/src/run-log.ts",
  "range": [10, 23],
  "contentHash": "5c288e6"
}
```

- The lock module exports `acquireLock` and `releaseLock` to enforce `policy.maxConcurrent` before dispatch and release on terminal status.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [37, 37],
  "contentHash": "fa780c7"
}
```

- The due module exports `isAutomationDue` to evaluate 5-field cron against the last recorded run in each automation JSONL file.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [38, 38],
  "contentHash": "fa780c7"
}
```

- The CLI exports `runSchedulerTick` wiring `tickAutomations` to `CursorRunner` for agent triggers and bounded `spawnSync` pan dispatch for pan triggers.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [39, 39],
  "contentHash": "fa780c7"
}
```

- The server service exports `triggerManualAutomationRun` and `loadAutomationRunHistory` delegating to scheduler primitives from `findRepoRoot()`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [42, 43],
  "contentHash": "fa780c7"
}
```

- `POST /api/automations/<id>/run` dispatches a manual tick for one automation; `GET /api/automations/<id>/runs` returns `{ runs: RunRecord[] }` in reverse chronological order.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/automations/[id]/run/route.ts",
  "range": [1, 20],
  "contentHash": "dab5501"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/automations/[id]/runs/route.ts",
  "range": [1, 20],
  "contentHash": "f257f30"
}
```

- Cockpit UI surfaces include `AutomationListView` with enabled Run now, `AutomationRunHistory` with expandable stdout/stderr excerpts, and `AutomationsModule` wiring selection, history refresh, and list-row status badges.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [44, 45],
  "contentHash": "fa780c7"
}
```

## Tradeoffs

- In-app daemon, LangGraph scheduler, and cloud schedulers remain out of scope; OS cron and launchd are the only recurring trigger per engineering spec deferrals.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/implementation-report.md",
  "range": [77, 79],
  "contentHash": "fa780c7"
}
```

- `.pan/scheduler/runs/` is gitignored runtime state; operators MUST back up JSONL files separately from version control.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/adr-draft.md",
  "range": [98, 99],
  "contentHash": "04c00ca"
}
```

- `finishedAt` reuses the tick-entry `now` timestamp rather than a post-dispatch clock, so run-history duration formatting may show `0s` for runs completing within the same tick minute.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [15, 15],
  "contentHash": "6208bd7"
}
```

- Agent dispatch appends a `pause` intervention journal entry after `CursorRunner.invoke` returns, which may reduce intervention state to `paused` even though an empty journal already yields `running` during dispatch.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [17, 17],
  "contentHash": "6208bd7"
}
```

- List-row `running` and `error` badges populate only from the selected automation's fetched runs; unselected rows cannot surface persisted error or running evidence from run history.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [19, 19],
  "contentHash": "6208bd7"
}
```

- Cron due evaluation matches fields against UTC components; `OPERATION.md` documents cron and launchd one-liners but does not state the UTC assumption for non-UTC operators.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [25, 25],
  "contentHash": "6208bd7"
}
```

- Tick executor wiring is duplicated between `@pancreator/cli` and `client/src/services/scheduler-runs.ts`; a shared factory would reduce drift risk on a follow-up pass.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [21, 21],
  "contentHash": "6208bd7"
}
```

## Usage guidelines

- To evaluate all due enabled automations from cron or launchd, invoke `pnpm -w exec pan scheduler tick` from the repository root; manual dispatch for one automation uses `--id <automation-id>` and records `trigger: manual`.

```json
{
  "kind": "lines",
  "path": "OPERATION.md",
  "range": [453, 463],
  "contentHash": "aa04b26"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [31, 31],
  "contentHash": "dc3dfbd"
}
```

- To trigger Run now from Cockpit, POST to `/api/automations/<id>/run`; the route test creates an agent automation, dispatches a manual run, and asserts HTTP 200 with the automation id in outcomes.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/automations/[id]/run/route.test.ts",
  "range": [43, 51],
  "contentHash": "491eeb3"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [34, 34],
  "contentHash": "dc3dfbd"
}
```

- To inspect run history in Cockpit, select an automation row and expand stdout excerpts; the page test asserts enabled Run now, no-selection empty state, row selection loading run rows, and no-runs empty state for a selected automation without history.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1037, 1103],
  "contentHash": "5818402"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [35, 35],
  "contentHash": "dc3dfbd"
}
```

- To expand run stdout after Run now, click `automation-run-now-<id>` and toggle the run row; the page test captures the POST call and asserts the expandable stdout excerpt renders.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1106, 1135],
  "contentHash": "5818402"
}
```

## Testing

Coverage delta against the prior registry-only Automations baseline adds 28 scheduler Vitest tests across due, lock, run-log, paths, registry, schema, and tick modules; 3 CLI tick tests for manual `--id` dispatch, non-zero exit on failure, and `maxConcurrent` skip; and 39 focused client tests across run and runs API routes plus Automations scenarios in `page.test.tsx`. All five touch-set gate commands exit zero on 2026-06-08: scheduler 28/28 pass, CLI tick 3/3 pass, client lint pass, client typecheck pass, and focused Vitest 39/39 pass. Compliance run emits `status: pass` with 0 block findings. Full-repository `pnpm run build` fails because `scheduler-runs.ts` pulls `@pancreator/runner-cursor` into the Next.js webpack graph; Vitest and typecheck pass and that build failure remains excluded from the touch-set gate per qa-tester scope.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [5, 5],
  "contentHash": "dc3dfbd"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [11, 15],
  "contentHash": "dc3dfbd"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/test-report.md",
  "range": [38, 38],
  "contentHash": "dc3dfbd"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/review.md",
  "range": [41, 41],
  "contentHash": "6208bd7"
}
```
