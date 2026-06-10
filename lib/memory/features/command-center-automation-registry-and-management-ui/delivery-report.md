# Delivery Report — Command Center automation registry and management UI

## Summary

This feature delivery ships a Pancreator-native automation registry and Command Center Automations management UI. The `@pancreator/scheduler` package validates schema v1 YAML, enforces path guards under `.pan/automations/`, and exposes registry CRUD plus enabled-only due filtering. Next.js routes at `/api/automations` wrap the primitive server-side so the client never reads `.pan/` directly. `DashboardModuleShell` renders `AutomationsModule` with a two-column list, run-history stub, inline enabled toggles, and a four-step create/edit wizard. Run now and run-history population remain disabled until `command-center-automations-scheduler` ships. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and 54 focused tests pass across scheduler, API, UI, and browser-safe client helpers.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [8, 12],
  "contentHash": "352ce2b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/review.md",
  "range": [8, 13],
  "contentHash": "80a3cf0"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [3, 7],
  "contentHash": "5220cf7"
}
```

## Architecture

- Automations SHALL persist as schema v1 YAML under `.pan/automations/<id>.yaml`, SHALL validate and read/write through `@pancreator/scheduler`, and SHALL expose CRUD only via Next.js API routes consumed by `AutomationsModule`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/adr-draft.md",
  "range": [48, 53],
  "contentHash": "afe4368"
}
```

- The scheduler primitive SHALL own schema validation, path guards, and registry CRUD; it SHALL exclude `enabled: false` records from due-evaluation lists and SHALL NOT host tick execution or run-log append in this Feature.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/adr-draft.md",
  "range": [60, 63],
  "contentHash": "afe4368"
}
```

- The implement stage SHALL scaffold `@pancreator/scheduler` with path guards mirroring `@pancreator/intervention` discipline, schema v1 validation with field-path errors, and Vitest coverage for valid documents, rejection cases, path traversal, and disabled-record exclusion.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/plan.md",
  "range": [17, 23],
  "contentHash": "c98929a"
}
```

- The client automation service SHALL call `@pancreator/scheduler` from the repository root, discover persona slugs from `lib/personas/*.md`, and materialize `.pan/automations/` on first access; browser components SHALL use `automations-client.ts` so the client bundle does not import Node-only scheduler modules.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/plan.md",
  "range": [25, 29],
  "contentHash": "c98929a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [12, 12],
  "contentHash": "352ce2b"
}
```

- The Automations UI SHALL render a two-column list plus stub run-history panel, inline enabled toggles, and a four-step Schedule → Persona → Prompt → Review wizard; Run now SHALL render disabled with helper text citing `command-center-automations-scheduler`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/plan.md",
  "range": [9, 13],
  "contentHash": "c98929a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/adr-draft.md",
  "range": [69, 72],
  "contentHash": "afe4368"
}
```

## Interfaces

- `@pancreator/scheduler` exports `validateAutomationDocument`, `isValidCronExpression`, `formatScheduleLabel`, path guards (`assertSafeAutomationId`, `assertAutomationPathInRegistry`, `automationFilePath`), and registry I/O (`listAutomations`, `listDueAutomations`, `createAutomation`, `updateAutomation`, `deleteAutomation`).

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [42, 47],
  "contentHash": "352ce2b"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/scheduler/src/registry.ts",
  "range": [57, 74],
  "contentHash": "ca6a088"
}
```

- The server automation service exports `discoverPersonaSlugs`, `loadAutomationSummaries`, `saveAutomationCreate`, `saveAutomationUpdate`, `removeAutomation`, `CRON_PRESETS`, `deriveAutomationId`, and `defaultAgentAutomationDraft`.

```json
{
  "kind": "lines",
  "path": "client/src/services/automations.ts",
  "range": [59, 96],
  "contentHash": "0ab9173"
}
```

- The browser facade `automations-client.ts` re-exports cron presets, validation, schedule labels, and draft builders without Node-only scheduler imports.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [55, 58],
  "contentHash": "352ce2b"
}
```

- `GET/POST/PUT/DELETE /api/automations` return JSON summaries or HTTP 400 with field-scoped `errors`; `GET` includes `{ automations, personas }` and supports single-record fetch via `?id=`.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/automations/route.ts",
  "range": [30, 48],
  "contentHash": "22a2c43"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [60, 65],
  "contentHash": "352ce2b"
}
```

- Command Center UI surfaces include `AutomationsModule`, `AutomationListView`, `AutomationWizardShell` with Schedule/Persona/Prompt/Review steps, `AutomationRunHistory` empty state, `StatusBadge`, and shared `useFocusTrap` for delete-confirm dialogs.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [67, 74],
  "contentHash": "352ce2b"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/layout/DashboardModuleShell.tsx",
  "range": [80, 84],
  "contentHash": "3e2d5b9"
}
```

## Tradeoffs

- Scheduler tick execution and run-log population SHALL remain deferred to `command-center-automations-scheduler`; Run now renders disabled and run history shows a dashed empty state.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/implementation-report.md",
  "range": [76, 79],
  "contentHash": "352ce2b"
}
```

- The wizard SHALL cover `trigger.kind: agent` create/edit paths only; schema v1 accepts pan subcommands but no pan-trigger UI ships in this Feature.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/adr-draft.md",
  "range": [69, 70],
  "contentHash": "afe4368"
}
```

- `.pan/automations/` is gitignored runtime state; operators MUST back up YAML separately from version control.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/adr-draft.md",
  "range": [89, 90],
  "contentHash": "afe4368"
}
```

- Cron validation logic is duplicated between `@pancreator/scheduler` and the browser facade; future schema changes risk client/server drift unless an isomorphic subset is shared.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/review.md",
  "range": [36, 39],
  "contentHash": "80a3cf0"
}
```

- The API layer accepts any non-empty `trigger.persona` string; the wizard dropdown constrains UI input but direct POST bypasses persona discovery validation.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/review.md",
  "range": [40, 43],
  "contentHash": "80a3cf0"
}
```

- `AutomationsModule` issues two `GET /api/automations` calls on mount via separate loaders; merging into one loader would reduce redundant network work.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/review.md",
  "range": [47, 49],
  "contentHash": "80a3cf0"
}
```

## Usage guidelines

- To create, list, update, and delete automations through the API, POST a valid schema v1 record, GET the `{ automations, personas }` envelope, PUT an enabled toggle, and DELETE by id; the route test asserts 201 on create, 200 on update, and 204 on delete.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/automations/route.test.ts",
  "range": [43, 80],
  "contentHash": "36b97fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [50, 52],
  "contentHash": "5220cf7"
}
```

- To render the Automations tab with list rows, disabled Run now, and run-history stub, mount `DashboardPage`, click `module-tab-automations`, and assert `automations-module`, schedule label, and stub helper text.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1020, 1034],
  "contentHash": "adbb9fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [53, 55],
  "contentHash": "5220cf7"
}
```

- To toggle automation enabled state from the list, click `automation-toggle-<id>`; the UI issues one PUT with `{ id, enabled: false }` and the test captures the payload.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1037, 1053],
  "contentHash": "adbb9fe"
}
```

- To create an agent automation through the four-step wizard, open the wizard, select the hourly preset, choose a persona, enter a prompt, and save on Review; the POST body includes `schedule: "0 * * * *"` and an agent trigger.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1056, 1109],
  "contentHash": "adbb9fe"
}
```

- To validate cron presets and schedule labels in the browser without Node imports, call `isValidCronExpression`, `formatScheduleLabel`, and `deriveAutomationId` from `automations-client.ts`; five unit tests cover preset labels and draft builders.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [56, 57],
  "contentHash": "5220cf7"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/services/automations-client.test.ts",
  "range": [1, 20],
  "contentHash": "9f30096"
}
```

## Testing

Coverage delta against the prior Command Center shell baseline adds 14 scheduler Vitest tests across schema, paths, and registry (including disabled-record filtering), 3 API route tests covering CRUD and validation failures, 35 focused client tests in `page.test.tsx` with 3 Automations scenarios, and 5 browser-facade tests in `automations-client.test.ts`. All four touch-set gate commands exit zero on 2026-06-08: scheduler 14/14 pass, client lint pass, client typecheck pass, and focused Vitest 35/35 pass. Full-repository `pnpm test` (85/85) and `node --test tests/*.test.mjs` (160/160) both pass on rerun and remain excluded from the touch-set gate per qa-tester scope. Three embedded UX contract clauses (list-enabled-toggle, wizard-four-steps, run-now-stub) pass manual evaluation.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [3, 7],
  "contentHash": "5220cf7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [11, 16],
  "contentHash": "5220cf7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/test-report.md",
  "range": [29, 30],
  "contentHash": "5220cf7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/47315_1051_command-center-automation-registry-and-management-ui/review.md",
  "range": [64, 74],
  "contentHash": "80a3cf0"
}
```
