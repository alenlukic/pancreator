# Delivery Report — Cockpit v2 Maintenance toolkit (compliance and tests)

## Summary

This feature delivery replaces the Cockpit Maintenance placeholder with a full operator toolkit for compliance audits, allowlisted test-suite runs, and index-adjacent pre-close validation. Server routes delegate compliance to `runCompliance()` and spawn fixed-argv suite commands with shell-metacharacter rejection mirroring `pan-execute.ts`. The client exposes `POST` and `GET /api/compliance-run`, SSE `POST /api/test-run`, shared `OutputStream` log rendering, and `PreCloseValidationPanel` gated on `ship` or `index` stages beneath `NextActionPanel`. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and 53 focused Vitest tests exit zero.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/implementation-report.md",
  "range": [7, 32],
  "contentHash": "bf21b85"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [3, 6],
  "contentHash": "885364f"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [3, 5],
  "contentHash": "ad9f15d"
}
```

## Architecture

- The Maintenance toolkit SHALL wrap existing repository tools rather than reimplement them: `POST /api/compliance-run` delegates to `runCompliance()` and returns structured JSON; `POST /api/test-run` spawns allowlisted suite commands and streams combined stdout/stderr through `text/event-stream`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/plan.md",
  "range": [5, 20],
  "contentHash": "add52c3"
}
```

- The Feature SHALL adopt a dual-route response model: compliance routes return finite structured JSON synchronously; test-run routes return SSE because Vitest and long-running checks produce unbounded stdout/stderr.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/adr-draft.md",
  "range": [62, 65],
  "contentHash": "f437098"
}
```

- Compliance API routes SHALL import and call `runCompliance()` from `lib/internal/tools/run-compliance.mjs` and SHALL read descriptor metadata through the same discovery helpers the CLI uses.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/adr-draft.md",
  "range": [67, 70],
  "contentHash": "f437098"
}
```

- Test-run routes SHALL map suite ids to fixed command argv arrays without shell interpolation and SHALL reject shell metacharacters using the same pattern as `validatePanCommand()` in `pan-execute.ts`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/adr-draft.md",
  "range": [72, 76],
  "contentHash": "f437098"
}
```

- Pre-close validation SHALL render in `PipelineModule` beneath `NextActionPanel` because eligibility depends on the selected task `currentStage` from `GET /api/run-state`, not the Maintenance tab context.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/adr-draft.md",
  "range": [83, 85],
  "contentHash": "f437098"
}
```

## Interfaces

- `runCompliance()`, `listComplianceDescriptors()`, and descriptor id validation export from `maintenance-compliance.ts`; the compliance-run route delegates POST handlers to these functions and GET returns descriptor table metadata.

```json
{
  "kind": "lines",
  "path": "client/src/services/maintenance-compliance.ts",
  "range": [1, 30],
  "contentHash": "9ec8262"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/compliance-run/route.ts",
  "range": [1, 25],
  "contentHash": "12f9602"
}
```

- `streamSuiteOutput()` and allowlisted `SUITE_COMMANDS` map export from `maintenance-test-run.ts`; suite labels and validation share `maintenance-suite-presets.ts`.

```json
{
  "kind": "lines",
  "path": "client/src/services/maintenance-test-run.ts",
  "range": [1, 40],
  "contentHash": "5537af1"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/maintenance-suite-presets.ts",
  "range": [1, 30],
  "contentHash": "91a7c28"
}
```

- `POST /api/test-run` accepts `{ "suite": "<id>" }`, returns `Content-Type: text/event-stream` with framed `data:` chunks and a terminal `event: exit` payload carrying `exitCode`.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/test-run/route.ts",
  "range": [1, 35],
  "contentHash": "17bb530"
}
```

- `OutputStream` renders append-only monospace logs with auto-scroll, optional `CopyCommandButton`, and `aria-live="polite"` exit-code footer with `.output-stream-exit-nonzero` styling for non-zero codes.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/shared/OutputStream.tsx",
  "range": [1, 70],
  "contentHash": "6da8dbf"
}
```

- `MaintenanceModule` composes `ComplianceAuditPanel` and `TestSuitePicker`; `PreCloseValidationPanel` gates on `ship`/`index` via `findActiveStage` and runs sequential preset bundles with checklist rows.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/maintenance/MaintenanceModule.tsx",
  "range": [1, 25],
  "contentHash": "0265170"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/maintenance/PreCloseValidationPanel.tsx",
  "range": [1, 50],
  "contentHash": "c4c808e"
}
```

- Optional session run metadata MAY persist under `.pan/maintenance/runs/` through `maintenance-runs.ts` on first write.

```json
{
  "kind": "lines",
  "path": "client/src/services/maintenance-runs.ts",
  "range": [1, 25],
  "contentHash": "6d6936d"
}
```

## Tradeoffs

- `streamSuiteOutput` awaits full process completion in `spawnStep` before yielding stdout/stderr lines; long Vitest runs do not update the browser incrementally until each step finishes.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [15, 15],
  "contentHash": "885364f"
}
```

- Session history rows in `TestSuitePicker` render as static list items with no click handler; operators cannot reload prior logs without re-running the suite.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [17, 17],
  "contentHash": "885364f"
}
```

- Pre-close failure navigation calls `onNavigateToMaintenance` without passing failed bundle context; the Maintenance tab opens without pre-selecting the relevant preset.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [19, 19],
  "contentHash": "885364f"
}
```

- UI branch coverage gaps remain on compliance failure expand paths; component code implements expandable findings but page tests cover only descriptor table render.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [23, 23],
  "contentHash": "885364f"
}
```

- `data-testid` naming uses `output-stream-panel` and `output-stream-log` instead of the ux-spec `output-stream` identifier; behavior matches the contract but selectors differ.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [27, 27],
  "contentHash": "885364f"
}
```

## Usage guidelines

- To load the Maintenance module with a compliance descriptor table, click `module-tab-maintenance` and assert `maintenance-module`, `compliance-audit-panel`, and `compliance-descriptor-json-formatting` test ids after `GET /api/compliance-run` resolves.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1296, 1307],
  "contentHash": "5f6f3aa"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [40, 41],
  "contentHash": "ad9f15d"
}
```

- To run an allowlisted test suite and surface exit code in OutputStream, select a preset button in `TestSuitePicker`, POST to `/api/test-run`, and assert `output-stream-exit-code` renders with the terminal exit value.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1310, 1327],
  "contentHash": "5f6f3aa"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/test-run/route.test.ts",
  "range": [1, 30],
  "contentHash": "280a1b7"
}
```

- To gate pre-close validation on index-adjacent stages, mount `PreCloseValidationPanel` beneath `NextActionPanel` and assert `pre-close-run-button` is disabled when `currentStage` is not `ship` or `index`, with `pre-close-eligibility-helper` visible.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1329, 1338],
  "contentHash": "5f6f3aa"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [38, 39],
  "contentHash": "ad9f15d"
}
```

- To invoke run-all compliance from the API, POST to `/api/compliance-run` without a body and assert structured JSON with per-descriptor results; route tests mock `runCompliance` output covering run-all, run-one, and invalid descriptor rejection.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/compliance-run/route.test.ts",
  "range": [1, 40],
  "contentHash": "4aedb77"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [35, 36],
  "contentHash": "ad9f15d"
}
```

## Testing

Coverage delta against the Maintenance placeholder baseline adds 53 focused Vitest tests across compliance-run and test-run API routes (8 tests), maintenance services (6 tests), and page integration scenarios (4 Maintenance and pre-close cases in `page.test.tsx`). Client lint and typecheck exit zero. Full-repository `node --test tests/*.test.mjs` reports 159/160 pass; the sole failure is pre-existing `pending_close_artifacts` hygiene for this active feature-delivery run and is excluded from the gate. Three ux-spec block contracts adjudicated pass with `design_qa_passes: true`.

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [3, 5],
  "contentHash": "ad9f15d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/test-report.md",
  "range": [9, 13],
  "contentHash": "ad9f15d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/review.md",
  "range": [43, 45],
  "contentHash": "885364f"
}
```
