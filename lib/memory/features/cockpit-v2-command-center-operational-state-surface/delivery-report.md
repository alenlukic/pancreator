# Delivery Report — Cockpit v2 Command Center operational state surface

## Summary

This feature delivery ships Cockpit v2 Command Center as the default operator landing inside the ten-surface shell. The client redirects `/` to `/command-center`, composes `(cockpit)/layout.tsx` with `CockpitNavRail`, optional inspector, and mobile tabs, and renders six card regions from existing `GET /api/run-state` aggregation without forking the P9 envelope. A design-QA re-entry removes the desktop inspector column on Command Center routes and confines pipeline stage identifiers to closed **Show technical details** overflow disclosure. Shared row helpers migrate human gate and next-action patterns from Pipeline components. Review passed with `review_passes: true`, test passed with `qa_passes: true` across 78 touch-set client tests. The `GET /api/run-state` schema and `run-state-shared.ts` classification helpers remain unchanged.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/implementation-report.md",
  "range": [3, 12],
  "contentHash": "4a39563"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/review.md",
  "range": [3, 5],
  "contentHash": "e5453a7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [3, 5],
  "contentHash": "082ae9d"
}
```

## Architecture

- Command Center SHALL become the Cockpit v2 default landing at `/` and `/command-center` inside the ten-surface shell, composing six card regions exclusively from existing `GET /api/run-state` aggregation and `run-state-shared.ts` helpers without restoring three-module tabs as the primary navigation model.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/adr-draft.md",
  "range": [44, 46],
  "contentHash": "ed77faa"
}
```

- The implement stage SHALL wire `(cockpit)/layout.tsx` composing `CockpitNavRail`, main content, optional `CockpitInspectorSlot`, and `CockpitMobileTabs`, and SHALL mark Command Center active per `getSurfaceByRoute` when the operator opens `/` or `/command-center`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/plan.md",
  "range": [9, 9],
  "contentHash": "77b493a"
}
```

- Each Command Center row SHALL show feature label, status pill, severity chip, relative age, and one accent primary CTA; raw repo paths, task ids, ISO timestamps, and stage ids SHALL NOT appear on the default meta row and SHALL expose only through overflow actions including closed-by-default **Show technical details**.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/plan.md",
  "range": [55, 55],
  "contentHash": "77b493a"
}
```

- On Command Center routes the shell SHALL omit the inspector column at desktop widths by applying `cockpit-v2-shell-no-inspector` so the 1280px grid stays `auto 1fr` without a 320px inspector column.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/implementation-report.md",
  "range": [11, 11],
  "contentHash": "4a39563"
}
```

- `useCommandCenterData` SHALL suppress the page-level guided empty state when compliance, automation, or activity preview rows exist by evaluating `hasOperationalRows` across all six card regions.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/plan.md",
  "range": [65, 65],
  "contentHash": "77b493a"
}
```

## Interfaces

- `(cockpit)/layout.tsx` exports the default Cockpit shell layout; `isCommandCenterRoute` gates inspector visibility and applies `cockpit-v2-shell-no-inspector` on `/` and `/command-center`.

```json
{
  "kind": "lines",
  "path": "client/src/app/(cockpit)/layout.tsx",
  "range": [9, 31],
  "contentHash": "4bc482f"
}
```

- `COCKPIT_SURFACES`, `FIRST_SLICE_SURFACES`, `MOBILE_TAB_SURFACES`, and `getSurfaceByRoute` define the ten-surface route registry consumed by nav rail and mobile tabs.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/surface-config.ts",
  "range": [23, 132],
  "contentHash": "ce1fd78"
}
```

- `CockpitNavRail` and `CockpitMobileTabs` render first-slice navigation with active-route highlighting from `usePathname`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitNavRail.tsx",
  "range": [11, 11],
  "contentHash": "eabf40d"
}
```

- `CommandCenterSurface` mounts the six-card grid; `buildCommandCenterRows` maps run-state inputs into `CommandCenterCardModel[]`; `useCommandCenterData` fetches run-state, automations, and compliance previews.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/command-center-data.ts",
  "range": [269, 269],
  "contentHash": "60113fd"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/useCommandCenterData.ts",
  "range": [114, 114],
  "contentHash": "49f5a5f"
}
```

- `CommandCenterRowOverflow` accepts optional `stageName` and renders stage context only after the operator expands **Show technical details**; `CommandCenterRowOverflow` type adds `stageName` to the overflow model.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/command-center-types.ts",
  "range": [18, 24],
  "contentHash": "c6ec204"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/CommandCenterRowOverflow.tsx",
  "range": [5, 16],
  "contentHash": "ec3a81d"
}
```

- `buildTaskOverflow` and `gateQueueEntryLabel` colocate shared overflow and gate-label helpers consumed by `HumanGateBanner` and `NextActionPanel`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/command-center-row-helpers.ts",
  "range": [11, 26],
  "contentHash": "19ad185"
}
```

- Root `page.tsx` redirects the operator from `/` to `/command-center`.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.tsx",
  "range": [1, 5],
  "contentHash": "fb9bbc9"
}
```

## Tradeoffs

- `HumanGateBanner` uses `gateQueueEntryLabel` for the task label but still renders raw `stageName`, `ownerPersona`, and `status` on the default Pipeline row meta line; full overflow-style disclosure remains a follow-on pass.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/review.md",
  "range": [15, 15],
  "contentHash": "e5453a7"
}
```

- Card `emptyCopy` strings in `buildCommandCenterRows` differ from ux-spec verbatim phrases; aligning copy would tighten operator scan predictability without changing data mapping.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/review.md",
  "range": [25, 25],
  "contentHash": "e5453a7"
}
```

- `buildRecentActivityPreview` returns up to 10 rows with no in-card scroll bound, which can lengthen the mobile scan path when many runs emit events.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/review.md",
  "range": [35, 35],
  "contentHash": "e5453a7"
}
```

- Root `DashboardPage` and legacy Pipeline routes remain reachable without duplicating Command Center card regions as the primary orientation surface, preserving Pipeline grid and timeline for deep workflows.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/adr-draft.md",
  "range": [56, 58],
  "contentHash": "ed77faa"
}
```

## Usage guidelines

- To land operators on Command Center by default, mount `CommandCenterPage` at `/command-center` and assert all six card test ids after run-state fetch resolves; the page test suite covers the operational grid and compliance-preview integration path.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1668, 1680],
  "contentHash": "6567dff"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [39, 39],
  "contentHash": "082ae9d"
}
```

- To hide the inspector column on Command Center while preserving it on mission-control routes, render `CockpitLayout` and assert `cockpit-v2-shell-no-inspector` plus absence of `cockpit-inspector-slot` on `/command-center`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitNavRail.test.tsx",
  "range": [63, 74],
  "contentHash": "70daa25"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [35, 35],
  "contentHash": "082ae9d"
}
```

- To keep pipeline stage slugs off default row meta, call `buildCommandCenterRows` and assert `metaHint` is undefined while `overflow.stageName` carries the stage identifier for Needs you and Running now rows.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/command-center-data.test.ts",
  "range": [344, 349],
  "contentHash": "93788fe"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [36, 36],
  "contentHash": "082ae9d"
}
```

- To expose stage context only through overflow disclosure, render `CommandCenterRowOverflow` with `stageName`, open the row menu, expand **Show technical details**, and assert the stage label appears inside the details panel.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/command-center/CommandCenterRowOverflow.test.tsx",
  "range": [6, 15],
  "contentHash": "906d7e9"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [37, 37],
  "contentHash": "082ae9d"
}
```

## Testing

Coverage delta against the Pipeline-first Cockpit baseline adds approximately 96 percent new-line statement coverage on 21 of 22 changed exported functions and components, with branch coverage on the `hasOperationalRows` global-empty path and compliance-only preview path exercised by integration tests. All five touch-set gate commands exit 0 with 78 client tests and zero failures; client lint and typecheck pass. Full-repository `pnpm test` and `node --test tests/*.test.mjs` each fail two repo-structure assertions because `.pan/archive/work` is absent in this worktree; those failures are pre-existing and excluded from the touch-set gate. Visual QA for combined design-reviewer gate advance remains deferred pending a design-reviewer re-run after P1 fixes.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [3, 5],
  "contentHash": "082ae9d"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/test-report.md",
  "range": [9, 15],
  "contentHash": "082ae9d"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-command-center-operational-state-surface/review.md",
  "range": [66, 68],
  "contentHash": "e5453a7"
}
```
