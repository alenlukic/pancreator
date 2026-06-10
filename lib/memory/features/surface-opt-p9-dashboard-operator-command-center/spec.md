---
id: surface-opt-p9-dashboard-operator-command-center
title: "surface-opt P9 — dashboard Command Center"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-02T05:43:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P9
depends_on: ["P5", "P6"]
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p9-dashboard-command-center.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p9-dashboard-command-center.md
    range: [31, 100]
    contentHash: 33af51c
    note: "Source directive: problem statement, goal, touch set, R1–R4, AC1–AC5, out-of-scope, dependencies, and implementation notes for the P9 dashboard Command Center."
  - kind: lines
    path: client/src/components/DashboardPage.tsx
    range: [26, 80]
    contentHash: a191b5d
    note: "DashboardPage currently renders domain cards plus an mtime-based activity feed; currentStage, humanGate, nextHumanAction, and nextCommand are absent from the rendered surface."
  - kind: lines
    path: client/src/services/activity.ts
    range: [1, 107]
    contentHash: 0250edf
    note: "getActivityFeed produces mtime-based events from domain-path scans plus a write log; P9 replaces this surface on the default view with run-log events."
---

# Engineering Spec — surface-opt P9 dashboard Command Center

## 1 — Context and motivation

The Pancreator operator dashboard renders domain cards, a file browser, and a
mtime-based activity feed. Run state for active `feature-delivery` tasks —
`currentStage`, `humanGate`, `nextHumanAction`, retry budget, and `nextCommand`
— lives in `.pan/work/<day>/<task-id>/state.json` and in the run log at
`.pan/work/<day>/<task-id>/run.log.jsonl`, but the dashboard never surfaces either
artifact. An operator cannot determine pipeline progress without opening
`state.json` or running `pan status` from a terminal.

P9 promotes the default view to a 9-stage machine grid per active task and
replaces the mtime feed with a real run-event timeline sourced from
`run.log.jsonl`. The grid reads run state through `pan status --json` because
that contract is more stable across schema versions than the raw `state.json`
shape. The file browser moves to a secondary tab to clear the primary surface
for the Command Center view.

This piece is one independently shippable Track-D run through `feature-delivery`.
It ships after Track O delivers `nextCommand` (P5) and decoded timestamps (P6),
both of which the stage cell rendering consumes.

## 2 — Requirements

### R1 — 9-stage machine grid on the default view

**R1.1** The `DashboardPage` component SHALL render a 9-stage machine grid as
the default view when the operator opens the dashboard.

**R1.2** The grid SHALL source run state from `pan status --json` for each
active task located under `.pan/work/`. When `pan status --json` is unavailable, the
grid MAY fall back to reading `state.json` directly and SHALL record a
structured warning in the API response envelope.

**R1.3** When zero active tasks exist, the default view SHALL render an explicit
empty-state message and SHALL NOT render a blank or hidden grid.

### R2 — Stage cell content

**R2.1** Each grid cell SHALL display the following fields for its stage: stage
name, owner persona identifier, `humanGate` status, verbatim `nextHumanAction`
text, and `nextCommand` string.

**R2.2** When a stage has not yet been reached, the cell SHALL render a visually
distinct pending state and SHALL NOT display `nextHumanAction` or `nextCommand`
for that stage.

**R2.3** When a stage is the active stage, the cell SHALL render a visually
distinct active state.

### R3 — File browser as secondary tab

**R3.1** The `DashboardPage` component SHALL render the file browser only within
a secondary tab.

**R3.2** The tab control SHALL be visible when the operator opens the dashboard,
regardless of the active-task count.

### R4 — Run-event timeline

**R4.1** The dashboard activity surface SHALL render a run-event timeline
sourced from `.pan/work/<day>/<task-id>/run.log.jsonl` for each active task.

**R4.2** The dashboard activity surface SHALL NOT render the mtime-based feed
produced by `getActivityFeed()` in `client/src/services/activity.ts`.

**R4.3** When no `run.log.jsonl` exists for a task, the timeline SHALL render an
explicit empty-state entry for that task and SHALL NOT omit the task silently.

## 3 — Acceptance criteria

- **AC1:** When an operator opens the dashboard with at least 1 active
  `feature-delivery` task, the default view SHALL render the 9-stage machine
  grid for each active task.
- **AC2:** When the dashboard renders a stage cell, the cell SHALL display the
  stage name, owner persona identifier, `humanGate` status, verbatim
  `nextHumanAction` text, and `nextCommand` string.
- **AC3:** When an operator opens the dashboard, the file browser SHALL be
  reachable only through a secondary tab.
- **AC4:** When the dashboard renders activity, it SHALL render a run-event
  timeline sourced from `run.log.jsonl` and SHALL NOT render the mtime-based
  feed.
- **AC5:** When zero active tasks exist, the default view SHALL render an
  explicit empty-state message.

## 4 — Technical design

### 4.1 — New API route: `GET /api/run-state`

The dashboard server SHALL expose one new read-only Next.js route at
`client/src/app/api/run-state/route.ts`. The route SHALL return a JSON array of
active-task envelopes. Each envelope SHALL include:

- `taskId` — the task identifier string,
- `stages` — an array of exactly 9 stage objects, each carrying `name`,
  `ownerPersona`, `humanGate`, `nextHumanAction`, `nextCommand`, and `status`
  (`"pending" | "active" | "complete" | "failed"`),
- `runEvents` — an array of run-log events parsed from `run.log.jsonl`, each
  carrying `timestamp`, `event`, and `message`.

The route SHALL locate active tasks by scanning `.pan/work/` for directories that
contain a `state.json` with a non-terminal status. The route SHALL read run
state by invoking `pan status --json <taskId>` for each discovered task. When
that invocation exits non-zero or is unavailable, the route SHALL fall back to
reading `state.json` directly and SHALL add a `sourceWarning` field to the
envelope.

### 4.2 — `StageMachineGrid` component

`DashboardPage` SHALL introduce one new React component, `StageMachineGrid`,
that accepts an array of task envelopes and renders the 9-cell grid. The
component SHALL apply `data-testid="stage-grid"` at the grid root and
`data-testid="stage-cell-<stageName>"` on each cell, where `<stageName>` is the
hyphen-lowercased stage name.

### 4.3 — Tab navigation

`DashboardPage` SHALL introduce a two-tab navigation control. The first tab
SHALL carry `data-testid="tab-command-center"` and SHALL be selected by default. The
second tab SHALL carry `data-testid="tab-files"` and SHALL render the existing
file browser panel.

### 4.4 — `RunEventTimeline` component and activity surface

`DashboardPage` SHALL NOT call `getActivityFeed()` or the existing
`GET /api/activity` route on the default Command Center view. `DashboardPage` SHALL
introduce one new React component, `RunEventTimeline`, that accepts the
`runEvents` array from the run-state envelope and renders the events in reverse
chronological order.

## 5 — Projected touch set

| Path | Change type | Rationale |
|------|-------------|-----------|
| `client/src/components/DashboardPage.tsx` | modify | Add `StageMachineGrid`, `RunEventTimeline`, and tab navigation; remove mtime-feed call from default view (R1–R4). |
| `client/src/app/api/run-state/route.ts` | create | New read-only route returning active-task run-state envelopes (R1, R4). |
| `client/src/services/run-state.ts` | create | Service layer invoking `pan status --json` or `state.json` fallback and parsing `run.log.jsonl` (R1.2, R4.1). |
| `client/src/components/DashboardPage.test.tsx` | create/modify | Component tests covering AC1–AC5 using mocked `/api/run-state` responses. |
| `client/src/app/api/run-state/route.test.ts` | create | Route tests covering the zero-task, one-or-more-task, and JSONL-parse paths. |

This piece SHALL NOT modify `lib/internal/packages/@pancreator/cli/`, MCP
handlers, `lib/memory/active/`, `state.json` shape, `run.log.jsonl` schema,
or any persona spec.

## 6 — Out of scope

- Dashboard safe-editing controls (delivered by P10).
- CLI/runner engine changes (Track O, P5–P8).
- MCP handler, active-memory, or agent-projection changes.
- Changes to `state.json` shape or `run.log.jsonl` schema.
- Modifications to `client/src/services/activity.ts` beyond removing its call
  from the default view.

## 7 — Dependencies and sequencing

- **P5** (Track O): the `nextCommand` field on the `pan status --json` envelope.
  R2.1 requires `nextCommand` in each stage cell. P9 SHALL NOT ship before P5
  is delivered.
- **P6** (Track O): decoded timestamps on `pan status --json` output. P9
  renders those decoded timestamps on run-event entries. P9 SHALL NOT ship
  before P6 is delivered.
- **Sequencing:** P9 ships in Track D step 4 per source PRD §7 cross-track
  sequencing (line 119), after Track O delivers P5 and P6.

## 8 — Open questions

_None. The source directive supplies sufficient R, AC, and dependency detail to
proceed to the planning stage._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-02 | intake-analyst | Initial canonical Engineering Spec from source directive `75420_0303_surface-opt-p9-dashboard-command-center.md`. |
