# Delivery Report — surface-opt P9 dashboard operator cockpit

## Summary

This feature delivery ships a read-only dashboard operator cockpit. The default view renders one 9-stage grid and a run-event timeline per active `feature-delivery` task. A server-side aggregation layer at `GET /api/run-state` discovers non-terminal runs under `work/`, prefers `pnpm -w exec pan status <taskId> --format json` over persisted `state.json`, and parses `run.log.jsonl` into timeline entries. The file browser remains on a secondary tab. Review passed with zero must-fix findings; focused client tests and coverage thresholds passed on 2026-06-02.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/implementation-report.md",
  "range": [3, 26],
  "contentHash": "d4a9356"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/review.md",
  "range": [1, 8],
  "contentHash": "496e84f"
}
```

## Architecture

- The cockpit SHALL use one server-side aggregation boundary at `client/src/services/run-state.ts` plus `GET /api/run-state` instead of browser-side filesystem or CLI coupling.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/adr-draft.md",
  "range": [78, 90],
  "contentHash": "5d661df"
}
```

- The service SHALL discover active runs from `work/<day>/<task-id>/state.json`, invoke `pnpm -w exec pan status <taskId> --format json`, and fall back to persisted state with a `sourceWarning` when the CLI path fails.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/plan.md",
  "range": [5, 6],
  "contentHash": "3af0386"
}
```

- `DashboardPage` SHALL default to the cockpit tab, render the stage grid and timeline, and keep the file browser behind a visible secondary files tab.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/plan.md",
  "range": [57, 57],
  "contentHash": "3af0386"
}
```

## Interfaces

- `GET /api/run-state` returns a JSON array of active task envelopes via `getActiveRunState()`.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/run-state/route.ts",
  "range": [1, 6],
  "contentHash": "a80a06a"
}
```

- `getActiveRunState`, `synthesizeStageCells`, and `parseRunLogFile` export the aggregation, stage-cell synthesis, and run-log parsing surfaces from `run-state.ts`.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state.ts",
  "range": [131, 131],
  "contentHash": "2344bf5"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state.ts",
  "range": [218, 218],
  "contentHash": "2344bf5"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state.ts",
  "range": [341, 341],
  "contentHash": "2344bf5"
}
```

- `TaskRunStateEnvelope`, `StageCell`, and `RunLogEvent` define the cockpit payload shapes consumed by `DashboardPage`.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state.ts",
  "range": [24, 44],
  "contentHash": "2344bf5"
}
```

## Tradeoffs

- The route accepts filesystem traversal plus CLI execution dependency and SHALL degrade cleanly via `sourceWarning` when `pan status` is unavailable.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/adr-draft.md",
  "range": [121, 121],
  "contentHash": "5d661df"
}
```

- The service synthesizes concise timeline messages from run-log attributes because `run.log.jsonl` does not carry a ready-made message field.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/adr-draft.md",
  "range": [122, 122],
  "contentHash": "5d661df"
}
```

- Review recorded no must-fix, consider, or nit findings; medium-risk `new_lines_only` coverage cleared the 80% statement and 70% branch thresholds.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/review.md",
  "range": [4, 12],
  "contentHash": "496e84f"
}
```

## Usage guidelines

- Fetch active cockpit state with `GET /api/run-state`; an empty array yields the explicit zero-task empty state in the dashboard UI.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/run-state/route.test.ts",
  "range": [62, 73],
  "contentHash": "9948ae8"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [153, 160],
  "contentHash": "51fc6c3"
}
```

- The default cockpit tab renders a 9-stage grid with gate and next-command fields on non-pending cells when run-state data exists.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [136, 151],
  "contentHash": "51fc6c3"
}
```

- Switch to the files tab to browse repository entries; the mtime activity feed no longer appears on the default cockpit view.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [175, 189],
  "contentHash": "51fc6c3"
}
```

## Testing

Focused client validation ran lint, typecheck, 19 tests across `page.test.tsx` and `route.test.ts`, and coverage on the touch-set paths. Coverage on new cockpit code met medium-risk thresholds: `route.ts` at 100% statements and 100% branches, `run-state.ts` at 86.53% / 72.46%, and `DashboardPage.tsx` at 91.08% / 91.13%. Repository JSON formatting checks now pass after canonical reformat of `index.json` and `touch-set.json`.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/test-report.md",
  "range": [14, 27],
  "contentHash": "7f56c6d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/implementation-report.md",
  "range": [48, 58],
  "contentHash": "d4a9356"
}
```
