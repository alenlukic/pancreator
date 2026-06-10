---
id: surface-opt-p10-dashboard-safe-editing
title: "surface-opt P10 — dashboard safe editing"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-02T08:01:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P10
depends_on: ["P9"]
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p10-dashboard-safe-editing.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p10-dashboard-safe-editing.md
    range: [31, 87]
    contentHash: p10-source-2026-06-01
    note: "Source directive: problem statement, goal, touch set, R1–R3, AC1–AC3, out-of-scope, dependencies, and implementation notes for P10 dashboard safe editing."
  - kind: lines
    path: client/src/components/DashboardPage.tsx
    range: [59, 63]
    contentHash: p9-delivered-dashboard
    note: "FileModalState currently carries path, content, draft, and open only; isReadOnly and showDiff are absent."
  - kind: lines
    path: client/src/components/DashboardPage.tsx
    range: [224, 259]
    contentHash: p9-delivered-dashboard
    note: "openFile and saveFile functions present the current unguarded write path; P10 hardens both functions."
---

# Engineering Spec — surface-opt P10 dashboard safe editing

## 1 — Context and motivation

The `DashboardPage` file browser allows an operator to open any repository file
in a modal editor. The modal immediately enables editing: the textarea is
writable on first open, a "Save" button calls `POST /api/file` without any diff
or confirmation step, and no path-based write guard exists. An operator can
accidentally overwrite `run.log.jsonl`, `state.json`, `handoff.md`, or
`next-prompt.md` — generated artifacts that the pipeline runner owns.

P10 hardens the editing surface by enforcing three controls: a read-only default
when any file opens, a diff-plus-confirmation gate before any write commits, and
a hard block on writes to pipeline-owned paths. These controls apply only to the
dashboard file-editor modal and SHALL NOT touch the CLI runner, MCP handlers,
active memory layout, or agent projections.

This piece ships after P9 delivers the Command Center view because P10 modifies
the same `DashboardPage` component. The hard gate P10⇐P9 is load-bearing.

## 2 — Requirements

### R1 — Read-only default

**R1.1** When the file-editor modal opens for any file, the dashboard SHALL
render the textarea in read-only mode.

**R1.2** When the modal is in read-only mode, the dashboard SHALL display an
"Edit" button with `data-testid="edit-button"` and SHALL NOT display a "Save"
button.

**R1.3** When the modal is in read-only mode, the dashboard SHALL display a
visible indicator (for example a label or badge) that communicates the
read-only state to the operator.

### R2 — Explicit edit plus diff confirmation

**R2.1** When an operator activates the "Edit" button, the dashboard SHALL
switch the modal to edit mode, SHALL enable the textarea for input, and SHALL
hide the "Edit" button.

**R2.2** When an operator activates "Save" in edit mode and `draft` differs
from `content`, the dashboard SHALL compute a line-level unified diff between
`content` and `draft`, SHALL display that diff in a `<pre>` element with
`data-testid="diff-view"`, and SHALL NOT call `POST /api/file`.

**R2.3** When the diff view is displayed, the dashboard SHALL show a "Confirm
save" button with `data-testid="confirm-save"` and a "Cancel" button with
`data-testid="cancel-save"`.

**R2.4** When an operator activates "Confirm save", the dashboard SHALL call
`POST /api/file` with the current `draft` and path, subject to the write guard
in R3.

**R2.5** When an operator activates "Cancel" from the diff view, the dashboard
SHALL dismiss the diff view and SHALL return to edit mode without discarding
`draft`.

**R2.6** When `draft` is identical to `content`, the "Save" button SHALL be
visually disabled and SHALL NOT open the diff view on activation.

### R3 — Write guard for pipeline-owned paths

**R3.1** Before calling `POST /api/file`, the dashboard SHALL check whether the
file path ends with any of the following segments: `run.log.jsonl`, `state.json`,
`handoff.md`, `next-prompt.md`.

**R3.2** When the path matches any guarded segment, the dashboard SHALL NOT call
`POST /api/file`, SHALL dismiss the diff view, and SHALL display a visible error
message with `data-testid="write-guard-error"` identifying the blocked path and
explaining that the file is pipeline-owned.

**R3.3** The write guard SHALL apply whether the operator reaches the save action
through the confirm-save button or any other programmatic path.

## 3 — Acceptance criteria

- **AC1:** When an operator opens the dashboard file-editor modal for any file,
  the textarea SHALL be in read-only mode, the "Edit" button with
  `data-testid="edit-button"` SHALL be visible, and no "Save" button SHALL be
  visible.
- **AC2:** When an operator activates the "Edit" button and then modifies the
  draft and activates "Save", the dashboard SHALL display the line-level diff in
  `data-testid="diff-view"`, SHALL display `data-testid="confirm-save"` and
  `data-testid="cancel-save"`, and SHALL NOT write the file until "Confirm save"
  is activated.
- **AC3:** When an operator attempts to confirm a save to a path ending with
  `run.log.jsonl`, `state.json`, `handoff.md`, or `next-prompt.md`, the
  dashboard SHALL NOT write the file and SHALL display
  `data-testid="write-guard-error"` with a visible error message.

## 4 — Technical design

### 4.1 — `FileModalState` extensions

`FileModalState` SHALL gain two boolean fields:

- `isReadOnly: boolean` — `true` by default, switched to `false` when the
  operator activates "Edit".
- `showDiff: boolean` — `false` by default, switched to `true` when the
  operator activates "Save" with a non-empty diff, switched back to `false` on
  cancel or after a successful write.

`openFile` SHALL initialise both fields to `true` and `false` respectively
whenever it sets `modal.open = true`.

### 4.2 — `GUARDED_PATH_SEGMENTS` constant

`DashboardPage.tsx` SHALL declare one module-level constant:

```ts
const GUARDED_PATH_SEGMENTS = [
  "run.log.jsonl",
  "state.json",
  "handoff.md",
  "next-prompt.md",
] as const;
```

The write-guard check SHALL use `GUARDED_PATH_SEGMENTS.some((seg) => modal.path.endsWith(seg))`.

### 4.3 — `computeDiff` utility function

`DashboardPage.tsx` SHALL declare one pure function `computeDiff(original: string, modified: string): string` that returns a human-readable line-level unified diff string. The implementation SHALL use standard `+`/`-`/` ` line prefixes without requiring an external diff library.

### 4.4 — Modal render path changes

When `modal.isReadOnly` is `true`:

- The textarea SHALL carry the `readOnly` HTML attribute.
- A `<span data-testid="readonly-indicator">` element SHALL be visible.
- The "Edit" button with `data-testid="edit-button"` SHALL be rendered.
- No "Save" button SHALL be rendered.

When `modal.isReadOnly` is `false` and `modal.showDiff` is `false`:

- The textarea SHALL NOT carry `readOnly`.
- The "Save" button SHALL be rendered with `disabled` when `modal.draft === modal.content`.
- No "Edit" button SHALL be rendered.
- No diff view SHALL be rendered.

When `modal.isReadOnly` is `false` and `modal.showDiff` is `true`:

- The textarea SHALL carry `readOnly` (operator reviews before confirming).
- A `<pre data-testid="diff-view">` element SHALL render the unified diff string.
- A `<button data-testid="confirm-save">` and a `<button data-testid="cancel-save">` SHALL be rendered.
- No "Save" button SHALL be rendered.

### 4.5 — `saveFile` flow

`saveFile` SHALL apply the write guard before calling `POST /api/file`. When the guard matches, `saveFile` SHALL set `modal.showDiff = false` and SHALL set `status` to a message of the form `"Write blocked: <path> is a pipeline-owned file."`. The element displaying that status SHALL carry `data-testid="write-guard-error"`.

When the guard does not match, `saveFile` SHALL call `POST /api/file`, update `modal.content` on success, and reset `modal.showDiff = false`.

## 5 — Projected touch set

| Path | Change type | Rationale |
|------|-------------|-----------|
| `client/src/components/DashboardPage.tsx` | modify | Extend `FileModalState` with `isReadOnly` and `showDiff`; add `GUARDED_PATH_SEGMENTS` constant; add `computeDiff` function; rework modal render path per §4.4; harden `saveFile` per §4.5. |
| `client/src/components/DashboardPage.test.tsx` | create/modify | Component tests covering AC1–AC3: read-only open, edit-flow with diff gate, and write-guard block, using mocked fetch responses. |

This piece SHALL NOT modify `lib/internal/packages/@pancreator/cli/`, MCP
handlers, `lib/memory/active/`, `state.json` shape, `run.log.jsonl` schema,
any persona spec, or any file outside the `client/` directory.

## 6 — Out of scope

- The dashboard operator-Command Center view (delivered by P9).
- Any CLI or runner engine change (Track O, P5–P8).
- Any MCP handler, active-memory, or agent-projection change.
- Changes to `state.json` shape or `run.log.jsonl` schema.
- Server-side path validation in `POST /api/file`; the guard is client-side only
  in this piece.

## 7 — Dependencies and sequencing

- **P9** (Track D): the Command Center view shipped first. `DashboardPage`
  after P9 contains the two-tab layout, `StageMachineGrid`, `RunEventTimeline`,
  and the file browser under the "Files" tab. P10 SHALL NOT ship before P9 is
  delivered.
- **Sequencing:** P10 ships in Track D step 5, after P9, per source PRD §7
  cross-track sequencing (line 119). Hard gate P10⇐P9.

## 8 — Open questions

_None. The source directive supplies sufficient R, AC, and dependency detail to
proceed to the planning stage._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-02 | intake-analyst | Initial canonical Engineering Spec from source directive `75420_0303_surface-opt-p10-dashboard-safe-editing.md`. |
