# Delivery Report — Command Center Pipeline command center and human gate queue

## Summary

This feature delivery ships the Command Center Pipeline command center: run-state field split, enriched task envelopes, a read-only config API, DashboardModuleShell extraction, and P9 grid and timeline migration. The server exposes `humanAttention` and `nextCommand` as separate `StageCell` fields, adds `runDir` and optional `inboxSource` to each `TaskRunStateEnvelope`, and serves live runtime policy through `GET /api/config`. The client renders `DashboardModuleShell` with Pipeline as the default module, a sticky Next Action panel, a global human gate queue banner, and a read-only config panel. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and 33 focused client tests pass after relocating gate helpers into client-safe `run-state-shared.ts`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/implementation-report.md",
  "range": [3, 16],
  "contentHash": "382f480"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [3, 6],
  "contentHash": "17ed879"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/test-report.md",
  "range": [3, 5],
  "contentHash": "4cd3d45"
}
```

## Architecture

- Command Center Pipeline command center SHALL expose `humanAttention` and `nextCommand` as separate string fields on every `StageCell`, SHALL add read-only `GET /api/config` for live `pancreator.yaml` and escalation policy display, and SHALL extract pipeline UI into `client/src/components/command-center/` rendered through `DashboardModuleShell` with Pipeline as the default module tab.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/adr-draft.md",
  "range": [45, 49],
  "contentHash": "badc10c"
}
```

- The implement stage SHALL split operator guidance from machine commands in the run-state envelope, enrich each `TaskRunStateEnvelope` with `runDir` and optional inbox source metadata, and expose `GET /api/config` that parses live repository-root YAML without adding a new dependency.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/plan.md",
  "range": [5, 16],
  "contentHash": "315a764"
}
```

- The client SHALL render `DashboardModuleShell` with Pipeline as the default module, compose the sticky Next Action panel, global human gate queue, read-only config panel, and migrated P9 grid and timeline, and SHALL preserve P10 read-only defaults and write guards on Files-tab actions.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/plan.md",
  "range": [63, 80],
  "contentHash": "315a764"
}
```

- Gate-queue helpers and the `HumanGateQueueEntry` type SHALL reside in `run-state-shared.ts` so `"use client"` Command Center components import only client-safe modules and production build avoids transitive Node built-in loading from `run-state.ts`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/implementation-report.md",
  "range": [18, 20],
  "contentHash": "382f480"
}
```

## Interfaces

- `StageCell` gains `humanAttention: string`; `TaskRunStateEnvelope` gains `runDir` and optional `inboxSource`; client-safe helpers `deriveRunDirFromTaskId`, `collectHumanGateQueue`, `findActiveStage`, and `taskLevelNextCommand` export from `run-state-shared.ts`.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [15, 40],
  "contentHash": "4c92fae"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [49, 110],
  "contentHash": "4c92fae"
}
```

- `loadRuntimeConfig` reads repository-root YAML via targeted regex and returns `RuntimeConfigSnapshot` with invocation mode, design steps, stage remediation, SDK sampling summary, and persona escalation badges; `GET /api/config` serves the snapshot as JSON.

```json
{
  "kind": "lines",
  "path": "client/src/services/config.ts",
  "range": [6, 11],
  "contentHash": "beb5a36"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/config/route.ts",
  "range": [1, 12],
  "contentHash": "64d6bda"
}
```

- `DashboardModuleShell` exposes module tabs (`pipeline`, `automations`, `maintenance`, `files`); pipeline surfaces include `NextActionPanel`, `HumanGateBanner`, `ConfigReadOnlyPanel`, `StageMachineGrid`, and `RunEventTimeline`; shared affordances include `CopyCommandButton`, `AttentionBanner`, `LoadingState`, `EmptyState`, and `ErrorState`.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/layout/DashboardModuleShell.tsx",
  "range": [7, 9],
  "contentHash": "3e2d5b9"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/NextActionPanel.tsx",
  "range": [15, 15],
  "contentHash": "db1477d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/HumanGateBanner.tsx",
  "range": [12, 12],
  "contentHash": "310d959"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ConfigReadOnlyPanel.tsx",
  "range": [8, 8],
  "contentHash": "b4b6ccc"
}
```

## Tradeoffs

- Gate artifact links in `HumanGateBanner` open `/api/file?path=…` anchor hrefs instead of routing through the Files-tab artifact modal; operators may leave the Command Center shell context when following gate links.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [15, 19],
  "contentHash": "17ed879"
}
```

- `collectHumanGateQueue` includes stages where synthesized cell status is `active` only; persisted stage status `ready` on a non-current stage maps to `pending` and is omitted from the queue.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [21, 25],
  "contentHash": "17ed879"
}
```

- Regex-based YAML parsing in `loadRuntimeConfig` covers documented keys only; unexpected nesting may silently yield fallback defaults until a dedicated config service lands.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/adr-draft.md",
  "range": [69, 71],
  "contentHash": "badc10c"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [33, 37],
  "contentHash": "17ed879"
}
```

- `PipelineModule` issues three file-existence fetches per task on each run-state load; the pattern is acceptable for MVP active-run cardinality but scales linearly with task count.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [47, 51],
  "contentHash": "17ed879"
}
```

## Usage guidelines

- To render the default Pipeline module with shell tabs, mount `DashboardPage` and assert `dashboard-module-shell`, `module-tab-pipeline`, and `pipeline-module` test ids after `GET /api/run-state` resolves.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [185, 195],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/test-report.md",
  "range": [11, 13],
  "contentHash": "4cd3d45"
}
```

- To surface next-action guidance with copy, open next-prompt, and open run folder actions, read the active stage `nextCommand` and envelope `runDir` from `GET /api/run-state` and wire `NextActionPanel` with `CopyCommandButton`; the copy test asserts clipboard write and `aria-live="polite"` Copied feedback.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [197, 230],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [57, 57],
  "contentHash": "17ed879"
}
```

- To aggregate human_approval gates across non-terminal runs, call `collectHumanGateQueue` from `run-state-shared.ts` and render `HumanGateBanner`; dismiss a row to hide the banner while persisting dismissed gate ids in Next Action local state.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [233, 248],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/test-report.md",
  "range": [33, 34],
  "contentHash": "4cd3d45"
}
```

- To display live runtime policy without server restart, fetch `GET /api/config` on page load; the panel renders invocation mode, stage remediation, SDK sampling, and persona escalation badges with `aria-readonly="true"`.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [251, 263],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/config/route.test.ts",
  "range": [1, 20],
  "contentHash": "18fb298"
}
```

## Testing

Coverage delta against the P9 dashboard baseline adds 33 focused client tests across `page.test.tsx` (17 tests), `run-state/route.test.ts` (15 tests), and `config/route.test.ts` (1 test). All three touch-set gate commands exit zero: client lint, typecheck, and focused tests. Production client build succeeds after gate helpers moved to `run-state-shared.ts`. New-line statement coverage on changed paths is estimated at or above 85 percent; branch coverage on acceptance-critical paths meets medium-tier `new_lines_only` thresholds. Full-repository `node --test` and `pnpm test` failures are pre-existing sibling-run `pending_close_artifacts` issues excluded from the gate.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/test-report.md",
  "range": [3, 5],
  "contentHash": "4cd3d45"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/test-report.md",
  "range": [9, 13],
  "contentHash": "4cd3d45"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/52646_0922_command-center-pipeline-command-center-and-human-gate-queue/review.md",
  "range": [61, 63],
  "contentHash": "17ed879"
}
```
