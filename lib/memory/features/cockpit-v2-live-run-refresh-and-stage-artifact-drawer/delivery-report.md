# Delivery Report — Cockpit v2 live run refresh and stage artifact drawer

## Summary

This feature delivery adds live run observation to the Cockpit v2 Pipeline module. The client polls `GET /api/run-state` every 7.5 seconds while any task carries an active stage cell, merges envelopes without remounting the dashboard, and surfaces escalation, retry, and deferral telemetry from run-log records. Active stage cells pulse with elapsed time and a telemetry chip; the run-event timeline appends new events on each poll tick. A stage artifact drawer lists contract paths with present and missing rows and hands present files to the P10 read-only Files modal. The canonical stage order inserts `compliance` between `report` and `ship`. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and 42 focused client tests pass.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/implementation-report.md",
  "range": [8, 38],
  "contentHash": "fd1c885"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [3, 6],
  "contentHash": "1000a8d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/test-report.md",
  "range": [3, 5],
  "contentHash": "3250220"
}
```

## Architecture

- Cockpit v2 Pipeline SHALL poll `GET /api/run-state` on a 5-second to 10-second interval while any non-terminal task has an active stage cell, SHALL merge envelopes into React state without remounting `DashboardPage`, and SHALL stop polling when every task is terminal.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/plan.md",
  "range": [5, 10],
  "contentHash": "f6b7f3d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/adr-draft.md",
  "range": [44, 50],
  "contentHash": "2de14bd"
}
```

- The server SHALL insert `compliance` between `report` and `ship` in `FEATURE_DELIVERY_STAGE_ORDER`, SHALL expose `featureId` on each task envelope, and SHALL enrich parsed run-log records with telemetry fields for escalation, retry, and deferral badges.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/plan.md",
  "range": [10, 13],
  "contentHash": "f6b7f3d"
}
```

- A read-only client mirror of `stageArtifactContract` in `stage-artifact-contract.ts` SHALL resolve per-stage artifact paths without importing `@pancreator/cli` into the browser bundle; present rows SHALL hand off to the existing P10 read-only Files modal via `onOpenArtifact`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/plan.md",
  "range": [45, 50],
  "contentHash": "f6b7f3d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/adr-draft.md",
  "range": [37, 40],
  "contentHash": "2de14bd"
}
```

- `RunEventTimeline` SHALL append new events on poll ticks in reverse-chronological order, and `StageMachineGrid` SHALL pulse active cells with elapsed time and a compact telemetry chip for the newest escalation, retry, or deferral record on that stage.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/plan.md",
  "range": [13, 15],
  "contentHash": "f6b7f3d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/plan.md",
  "range": [80, 84],
  "contentHash": "f6b7f3d"
}
```

## Interfaces

- `FEATURE_DELIVERY_STAGE_ORDER` inserts `"compliance"` after `"report"` and before `"ship"`; `RunLogEvent` gains optional telemetry fields; `TaskRunStateEnvelope` exposes `featureId`; helpers `formatElapsedDuration`, `activeStageElapsedMs`, `newestStageTelemetryChip`, and `isRetryTransitionEvent` export from `run-state-shared.ts`.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [1, 26],
  "contentHash": "552206b"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [132, 201],
  "contentHash": "552206b"
}
```

- `stageArtifactPathsForStage(input, stageName)` resolves contract paths from `StageArtifactContractInput` in the browser-safe `stage-artifact-contract.ts` module.

```json
{
  "kind": "lines",
  "path": "client/src/services/stage-artifact-contract.ts",
  "range": [6, 29],
  "contentHash": "ab387fa"
}
```

- `PipelineModule` starts a 7.5-second poll interval when `hasActiveStage` is true, renders `data-testid="live-refresh-indicator"`, manages drawer state, and mounts `ArtifactDrawer` with present-row `onOpenArtifact` handoff.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/PipelineModule.tsx",
  "range": [161, 192],
  "contentHash": "668d507"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/PipelineModule.tsx",
  "range": [244, 271],
  "contentHash": "668d507"
}
```

- `ArtifactDrawer` lists stage artifact rows with present and missing states, exposes `data-testid="artifact-drawer"`, and calls `onOpenArtifact` for present files.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/ArtifactDrawer.tsx",
  "range": [1, 30],
  "contentHash": "4b912e6"
}
```

## Tradeoffs

- The live refresh indicator renders between `NextActionPanel` and `StageMachineGrid` instead of the stage grid header row in the ux-spec wireframe; behavior matches acceptance criteria but layout diverges from the design placement.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [15, 16],
  "contentHash": "1000a8d"
}
```

- Polling starts when any task has an active stage cell rather than whenever a non-terminal task exists; a between-stage non-terminal gap would skip polling until the next stage activates.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [17, 18],
  "contentHash": "1000a8d"
}
```

- The poll interval is fixed at 7.5 seconds within the 5-second to 10-second spec band; no operator tuning knob was added in this delivery.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/implementation-report.md",
  "range": [54, 54],
  "contentHash": "fd1c885"
}
```

- Client-side artifact contract mirroring can drift from CLI `requiredAfterStageWork` paths until a shared package extraction lands; drawer presence checks issue one `/api/file` GET per path on open.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/adr-draft.md",
  "range": [70, 73],
  "contentHash": "2de14bd"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/implementation-report.md",
  "range": [55, 56],
  "contentHash": "fd1c885"
}
```

- Server-sent events and websocket streaming of SDK progress were rejected as out of scope; client-side polling remains compatible with a future streaming upgrade.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/adr-draft.md",
  "range": [35, 37],
  "contentHash": "2de14bd"
}
```

## Usage guidelines

- To observe live refresh during an active run, mount `DashboardPage` with a non-terminal task that has an active stage cell; assert `data-testid="live-refresh-indicator"` appears while polling runs and disappears when all tasks reach terminal status.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [507, 553],
  "contentHash": "de61734"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/test-report.md",
  "range": [33, 33],
  "contentHash": "3250220"
}
```

- To verify append-only timeline merge on poll ticks, load a task with existing run events, trigger a poll update with new log records, and assert prior events remain while new entries prepend at the top.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [555, 607],
  "contentHash": "de61734"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [39, 39],
  "contentHash": "1000a8d"
}
```

- To inspect stage artifacts, activate a non-pending stage cell to open `data-testid="artifact-drawer"`, confirm present rows call `onOpenArtifact` and switch to the Files tab with `data-testid="readonly-indicator"`, and confirm missing rows render disabled with a Missing label.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [610, 684],
  "contentHash": "de61734"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [32, 32],
  "contentHash": "1000a8d"
}
```

- To validate compliance stage order and telemetry parsing, assert `stage-cell-compliance` renders in the grid, `FEATURE_DELIVERY_STAGE_ORDER` places `compliance` after `report`, and run-log records map escalation, retry, and deferral events to badge fields.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [295, 295],
  "contentHash": "de61734"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/run-state/route.test.ts",
  "range": [372, 417],
  "contentHash": "39f2d5d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/run-state/route.test.ts",
  "range": [439, 466],
  "contentHash": "39f2d5d"
}
```

## Testing

Coverage delta against the prior Cockpit v2 Pipeline baseline adds 42 focused client tests across `page.test.tsx` and `run-state/route.test.ts`. All three touch-set gate commands exit zero: client lint, typecheck, and the focused 42-test suite. New-line statement coverage on the touch-set is estimated at or above 90 percent and branch coverage at or above 85 percent, exceeding medium-tier `new_lines_only` thresholds of 80 percent statement and 70 percent branch. Every public symbol in the touch-set carries at least one test. Full-repository `pnpm run build` and `node --test` failures are pre-existing issues excluded from the gate.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/test-report.md",
  "range": [3, 5],
  "contentHash": "3250220"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/test-report.md",
  "range": [9, 13],
  "contentHash": "3250220"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/review.md",
  "range": [37, 39],
  "contentHash": "1000a8d"
}
```
