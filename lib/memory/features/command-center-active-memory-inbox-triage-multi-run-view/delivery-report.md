# Delivery Report — Command Center active memory, inbox triage, and multi-run view

## Summary

This feature delivery ships Command Center Pipeline orientation surfaces: active-memory and inbox triage read APIs, a guarded pan execute route, and sidebar panels for multi-run selection. The Next.js client stacks `ActiveMemoryHeader`, `InboxTriagePanel`, and conditional `MultiRunTable` above the read-only config panel in `PipelineModule`. Orientation components fetch data only through `GET /api/active-memory`, `GET /api/inbox`, and `POST /api/execute`; browser-safe helpers and snapshot types live in `run-state-shared.ts`. Mutating pan verbs require a confirmation modal; `batch status` returns structured deferral until the CLI subcommand ships. Review passed with `review_passes: true`; QA passed with `qa_passes: true` and 35 touch-set Vitest tests across 4 files (69 total client tests).

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/implementation-report.md",
  "range": [8, 12],
  "contentHash": "7588d02"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [3, 5],
  "contentHash": "ee4ff9b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/test-report.md",
  "range": [3, 5],
  "contentHash": "09445e1"
}
```

## Architecture

- Orientation data SHALL flow through server-side read APIs and a guarded write API; the client SHALL NOT access the filesystem or MCP for active memory or inbox triage panels.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/adr-draft.md",
  "range": [48, 49],
  "contentHash": "63c3fdc"
}
```

- `GET /api/active-memory` SHALL parse `lib/memory/active/current.md` server-side and return Active Feature path, blockers summary, and refresh timestamp fields.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/adr-draft.md",
  "range": [51, 54],
  "contentHash": "63c3fdc"
}
```

- `GET /api/inbox` SHALL enumerate Markdown under `lib/inbox/in/**` and SHALL exclude every path under `lib/inbox/notes/**` via the existing `isNotesPath` guard.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/adr-draft.md",
  "range": [56, 59],
  "contentHash": "63c3fdc"
}
```

- `POST /api/execute` SHALL accept only allowlisted pan verbs, spawn `pnpm -w exec pan` from the repository root, and require UI confirmation before mutating verbs reach the route.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/adr-draft.md",
  "range": [61, 65],
  "contentHash": "63c3fdc"
}
```

- `PipelineModule` SHALL render the sidebar stack `ActiveMemoryHeader` → `InboxTriagePanel` → conditional `MultiRunTable` → `ConfigReadOnlyPanel`, and SHALL call `loadRunState` after execute completes.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/plan.md",
  "range": [49, 52],
  "contentHash": "e38ec45"
}
```

- Multi-run row selection SHALL drive `StageMachineGrid`, `RunEventTimeline`, and `ArtifactDrawer`; accordion expand SHALL render a preview grid without changing `selectedTaskId`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/plan.md",
  "range": [11, 13],
  "contentHash": "e38ec45"
}
```

- Client-safe orientation helpers and snapshot types SHALL export from `run-state-shared.ts` so the Next.js client bundle does not import Node-only service modules.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/implementation-report.md",
  "range": [12, 12],
  "contentHash": "7588d02"
}
```

## Interfaces

- `loadActiveMemory` parses `lib/memory/active/current.md` and returns `ActiveMemorySnapshot`; `GET /api/active-memory` serves the snapshot as JSON.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [75, 89],
  "contentHash": "48eb636"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/active-memory/route.ts",
  "range": [1, 6],
  "contentHash": "b44f0cf"
}
```

- `loadInboxEntries` walks `lib/inbox/in/**`, filters notes paths, and returns typed `InboxEntrySnapshot` rows; `GET /api/inbox` returns `{ entries }`.

```json
{
  "kind": "lines",
  "path": "client/src/services/inbox.ts",
  "range": [71, 88],
  "contentHash": "404ce54"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/inbox/route.ts",
  "range": [1, 6],
  "contentHash": "931249b"
}
```

- `validatePanCommand`, `executePanCommand`, and `ALLOWLISTED_VERBS` guard pan subprocess execution; `POST /api/execute` accepts `{ command: string }` and returns stdout, stderr, and exit code or HTTP 400 on rejection.

```json
{
  "kind": "lines",
  "path": "client/src/services/pan-execute.ts",
  "range": [11, 18],
  "contentHash": "d6b1ad1"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/pan-execute.ts",
  "range": [34, 53],
  "contentHash": "d6b1ad1"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/api/execute/route.ts",
  "range": [7, 26],
  "contentHash": "8d22da7"
}
```

- Orientation helpers in `run-state-shared.ts` add `isNonTerminalTask`, `sortTasksForMultiRunTable`, `taskDisplayLabel`, `PanExecuteResult`, `ActiveMemorySnapshot`, `InboxEntrySnapshot`, and `inboxRunCommand`.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [54, 59],
  "contentHash": "4c92fae"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [205, 256],
  "contentHash": "4c92fae"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [278, 315],
  "contentHash": "4c92fae"
}
```

- `ActiveMemoryHeader`, `InboxTriagePanel`, and `MultiRunTable` fetch orientation data on mount; `PipelineModule` composes the sidebar stack and wires execute refresh.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx",
  "range": [8, 12],
  "contentHash": "48ae4b4"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/InboxTriagePanel.tsx",
  "range": [13, 17],
  "contentHash": "2a85c4e"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/MultiRunTable.tsx",
  "range": [19, 29],
  "contentHash": "4f4782f"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/PipelineModule.tsx",
  "range": [276, 291],
  "contentHash": "22bcb53"
}
```

- `NextActionPanel` exposes the execute action bar with confirm modal and result panel; `DashboardPage` wires Files-tab deep links for inbox entries and refresh procedure.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/NextActionPanel.tsx",
  "range": [25, 34],
  "contentHash": "db1477d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [221, 231],
  "contentHash": "a191b5d"
}
```

## Tradeoffs

- Sixteen staged files sit outside the declared 21-path touch-set because sibling Command Center infrastructure (config route, stage grid, shared states) ships bundled with `PipelineModule` integration; review recommends widening the touch-set or splitting delivery commits.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [15, 15],
  "contentHash": "ee4ff9b"
}
```

- The Engineering Spec places the multi-run table above the stage grid, while implementation follows the ux-spec sidebar stack; operators see multi-run selection in the right sidebar rather than the main column.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [16, 16],
  "contentHash": "ee4ff9b"
}
```

- Accordion expand in `MultiRunTable` renders a preview grid without calling `onSelectTask`, matching the ux-spec contract, but page tests do not yet assert that expand leaves `selectedTaskId` unchanged.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [17, 17],
  "contentHash": "ee4ff9b"
}
```

- Files deep-link callbacks are wired in `DashboardPage`, yet orientation page tests stop at panel render without asserting Files-tab navigation or P10 read-only modal behavior.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [18, 18],
  "contentHash": "ee4ff9b"
}
```

- `batch status` returns structured deferral with exit code 125 until the CLI subcommand ships; the UI disables the Batch status button per ux-spec rather than failing silently.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/implementation-report.md",
  "range": [62, 62],
  "contentHash": "7588d02"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/adr-draft.md",
  "range": [72, 74],
  "contentHash": "63c3fdc"
}
```

- Raw `JSON.stringify` in `NextActionPanel` and execute route tests may fail repo-wide json-formatting compliance until approved `json-io` helpers replace them; this does not block the touch-set Vitest gate.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [20, 20],
  "contentHash": "ee4ff9b"
}
```

## Usage guidelines

- To render active memory orientation fields, mount `DashboardPage` and assert `active-memory-header`, `active-memory-path`, `active-memory-blockers`, and `active-memory-refreshed` test ids after `GET /api/active-memory` resolves.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [885, 895],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/test-report.md",
  "range": [33, 33],
  "contentHash": "09445e1"
}
```

- To list inbox triage entries with age labels and exclude notes paths, fetch `GET /api/inbox`; the route test verifies `loadInboxEntries` skips `lib/inbox/notes/**` and the page test asserts row title and age text.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/inbox/route.test.ts",
  "range": [33, 56],
  "contentHash": "353098f"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [898, 907],
  "contentHash": "adbb9fe"
}
```

- To sort multi-run rows by last event or human gate and drive main-column context, render with two non-terminal tasks, click sort controls, and select a row; the page test verifies row order and `aria-selected` on the stage grid.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [910, 949],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/test-report.md",
  "range": [27, 27],
  "contentHash": "09445e1"
}
```

- To execute a guarded pan command, click an execute action button, confirm in the modal, and inspect the result panel; the execute route test rejects allowlist violations with HTTP 400 and the page test verifies zero POST calls until confirmation.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/execute/route.test.ts",
  "range": [26, 30],
  "contentHash": "ff053ca"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [952, 979],
  "contentHash": "adbb9fe"
}
```

## Testing

Coverage delta against the prior Command Center command-center baseline adds 35 focused touch-set Vitest tests across 4 files (1 active-memory route, 1 inbox route, 4 execute route, 29 page tests) on top of the existing 12-file client suite totaling 69 passing tests. All four touch-set gate commands exit zero; client lint, typecheck, and production build succeed. Full-repository `pnpm test` and `node --test tests/*.test.mjs` each report 2 pre-existing failures (json-formatting guard and active-run close-artifacts check) excluded from the gate; design QA companion records `design_qa_passes: true`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/test-report.md",
  "range": [3, 5],
  "contentHash": "09445e1"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/test-report.md",
  "range": [11, 11],
  "contentHash": "09445e1"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/49726_1011_command-center-active-memory-inbox-triage-multi-run-view/review.md",
  "range": [35, 35],
  "contentHash": "ee4ff9b"
}
```
