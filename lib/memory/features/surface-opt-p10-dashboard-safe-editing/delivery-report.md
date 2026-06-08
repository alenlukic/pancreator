# Delivery Report — surface-opt P10 dashboard safe editing

## Summary

This feature delivery hardens the dashboard file-editor modal inside `DashboardPage`. Every open starts read-only with an explicit Edit affordance, save intent routes through a unified diff review before any `POST /api/file` write, and guarded pipeline-owned path segments block confirm-save with an in-modal error. Review passed with zero must-fix findings; focused client validation reports 12 passing tests on 2026-06-02.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/implementation-report.md",
  "range": [3, 5],
  "contentHash": "aa18279"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/review.md",
  "range": [1, 6],
  "contentHash": "1cb366b"
}
```

## Architecture

- The modal SHALL keep one local state machine inside `DashboardPage` with read-only, edit, and diff-review branches instead of adding cross-component coordination.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/plan.md",
  "range": [3, 4],
  "contentHash": "17312a2"
}
```

- `openFile` SHALL initialize read-only review state, and `saveFile` SHALL remain the only write boundary with a guarded-path check before `POST /api/file`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/adr-draft.md",
  "range": [29, 30],
  "contentHash": "d6dc865"
}
```

- The implementation SHALL stay inside `client/src/components/DashboardPage.tsx` plus the existing dashboard regression file at `client/src/app/page.test.tsx`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/adr-draft.md",
  "range": [41, 41],
  "contentHash": "d6dc865"
}
```

## Interfaces

- `GUARDED_PATH_SEGMENTS` defines the pipeline-owned filename suffixes rejected at the save boundary.

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [59, 64],
  "contentHash": "a191b5d"
}
```

- `FileModalState` carries `isReadOnly`, `showDiff`, and `writeGuardError` for the three modal modes.

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [66, 74],
  "contentHash": "a191b5d"
}
```

- `computeDiff`, `requestSaveReview`, `cancelSaveReview`, and `saveFile` own diff rendering, save gating, diff dismissal, and the guarded write path.

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [76, 76],
  "contentHash": "a191b5d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [314, 314],
  "contentHash": "a191b5d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [321, 321],
  "contentHash": "a191b5d"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/DashboardPage.tsx",
  "range": [333, 334],
  "contentHash": "a191b5d"
}
```

## Tradeoffs

- The modal state machine adds complexity because one component now owns three operator-visible modes instead of a single writable editor.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/adr-draft.md",
  "range": [57, 57],
  "contentHash": "d6dc865"
}
```

- The diff helper favors readable line-level output over minimal-edit optimality and SHALL not add a new dependency.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/adr-draft.md",
  "range": [58, 58],
  "contentHash": "d6dc865"
}
```

- Review recorded no must-fix findings; a consider note remains for an explicit cancel-save click interaction on `R2.5`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/review.md",
  "range": [8, 9],
  "contentHash": "1cb366b"
}
```

## Usage guidelines

- Open any repository file from the files tab; the modal renders read-only with `readonly-indicator` and `edit-button` before editing is allowed.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [243, 257],
  "contentHash": "adbb9fe"
}
```

- When the draft differs from loaded content, Save opens `diff-view` with `confirm-save` and `cancel-save`; no POST occurs until confirm.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [283, 318],
  "contentHash": "adbb9fe"
}
```

- Unchanged drafts keep Save disabled and SHALL NOT open diff review or issue a write request.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [259, 281],
  "contentHash": "adbb9fe"
}
```

- Confirm-save on guarded paths such as `handoff.md` renders `write-guard-error` inside the modal and blocks the POST.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [320, 370],
  "contentHash": "adbb9fe"
}
```

## Testing

Focused client validation ran lint, typecheck, and 12 tests in `client/src/app/page.test.tsx`. The touch-set maps AC1 through AC3 and `R2.6` to four passing cases; repository-wide automated checks in the test report exited zero. Changed-line coverage on `DashboardPage.tsx` cleared medium-risk `new_lines_only` thresholds during review.

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/test-report.md",
  "range": [43, 45],
  "contentHash": "71da9bd"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/implementation-report.md",
  "range": [41, 47],
  "contentHash": "aa18279"
}
```
