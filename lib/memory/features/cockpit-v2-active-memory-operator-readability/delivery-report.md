# Delivery Report — Cockpit v2 active memory operator readability

## Summary

This feature refines the Cockpit v2 Pipeline sidebar Active memory panel for operator readability, addressing design audit findings F-01, F-02, F-05, and F-10. The implement stage extends `ActiveMemorySnapshot` and `loadActiveMemory` to parse inbox title and slug metadata from the active-feature path, refactors `ActiveMemoryHeader` to show a human primary label, a demoted path row with copy affordance, locale or relative refresh timestamp inside semantic `<time>`, the locked **Open refresh procedure** CTA with `aria-describedby`, and an accessible in-panel blockers expand toggle. Blockers summary strips markdown emphasis; CSS changes stay scoped to `.active-memory-*`. Review passed with `review_passes: true`; test passed with `qa_passes: true` across 45 focused Vitest tests plus client lint and typecheck. No API route shape change beyond new snapshot fields.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/implementation-report.md",
  "range": [8, 12],
  "contentHash": "0b73ee5"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [3, 5],
  "contentHash": "9afdb89"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [3, 5],
  "contentHash": "b0f341f"
}
```

## Architecture

- Active memory snapshot enrichment SHALL add `activeFeatureLabel` and `activeFeatureSlug` by reading the inbox Markdown file referenced in `current.md`, with filename slug fallback on read failure and null fields when the active feature is `(none)`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/plan.md",
  "range": [20, 28],
  "contentHash": "1178cb7"
}
```

- `ActiveMemoryHeader` SHALL render human label as primary content, demote the repo-relative path to a truncated secondary row with `CopyCommandButton`, format refresh time as relative or locale text inside `<time datetime>`, rename the CTA to **Open refresh procedure**, and add an accessible in-panel expand toggle when blockers exceed three visible lines.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/plan.md",
  "range": [30, 41],
  "contentHash": "1178cb7"
}
```

- Locked presentation choices SHALL use in-panel blockers expand (not Files deep link), relative phrasing under 7 days and `Intl.DateTimeFormat` for older timestamps, and the **Open refresh procedure** CTA label per ux-spec.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/plan.md",
  "range": [82, 88],
  "contentHash": "1178cb7"
}
```

- ADR draft records server-side snapshot enrichment over client-side inbox fetch, in-panel blockers disclosure over Files modal, and human label primary over raw path with tooltip.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/adr-draft.md",
  "range": [45, 50],
  "contentHash": "b1869b6"
}
```

- Changes SHALL stay within the declared client touch set; `current.md` authoring format and sibling cockpit modules remain unchanged.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/adr-draft.md",
  "range": [66, 67],
  "contentHash": "b1869b6"
}
```

## Interfaces

- `ActiveMemorySnapshot` adds `activeFeatureLabel: string | null` and `activeFeatureSlug: string | null` alongside existing path, blockers, and refresh fields.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [300, 306],
  "contentHash": "023740d"
}
```

- `loadActiveMemory` reads `lib/memory/active/current.md`, resolves inbox title and slug metadata, strips markdown emphasis from blockers summary, and returns the enriched snapshot.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [127, 145],
  "contentHash": "6aa448f"
}
```

- `formatActiveMemoryRefreshTime` formats ISO timestamps as relative phrasing under 7 days or locale `Intl.DateTimeFormat` strings for older values.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx",
  "range": [12, 48],
  "contentHash": "edc994b"
}
```

- `ActiveMemoryHeader` renders primary label, secondary path meta, blockers excerpt with expand toggle, semantic refresh `<time>`, and the **Open refresh procedure** CTA wired to `onOpenRefreshProcedure`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx",
  "range": [118, 184],
  "contentHash": "edc994b"
}
```

- `GET /api/active-memory` passes through the enriched `loadActiveMemory` snapshot without route shape change.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/implementation-report.md",
  "range": [39, 39],
  "contentHash": "0b73ee5"
}
```

## Tradeoffs

- `deriveSlugFromFilename` and `extractTitle` remain duplicated in `active-memory.ts` rather than imported from `inbox.ts` to avoid touch-set expansion; shared extraction would reduce title or slug drift risk.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [15, 15],
  "contentHash": "9afdb89"
}
```

- `formatActiveMemoryRefreshTime` exports from the component module for test import; a dedicated formatter file would narrow the component surface per plan allowance.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [17, 17],
  "contentHash": "9afdb89"
}
```

- Blockers overflow detection ORs DOM measurement with a 180-character heuristic fallback for jsdom environments, which can surface **Show full blockers** when text still fits three visible lines in production.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [19, 19],
  "contentHash": "9afdb89"
}
```

- Focus ring visibility on the blockers toggle and refresh CTA relies on design-QA browser inspection and manual keyboard checks; no automated `:focus-visible` CSS probe exists yet.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [21, 21],
  "contentHash": "9afdb89"
}
```

- `loadActiveMemory` performs an extra filesystem read when an active inbox path is set; acceptable for a single orientation panel on dashboard load per ADR negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/adr-draft.md",
  "range": [84, 85],
  "contentHash": "b1869b6"
}
```

## Usage guidelines

- To verify snapshot label parsing and markdown-free blockers, call `loadActiveMemory` in a temp repo and assert `activeFeatureLabel`, slug metadata, and blockers summary without literal `**` markers.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/active-memory/route.test.ts",
  "range": [58, 77],
  "contentHash": "37b4220"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [34, 34],
  "contentHash": "b0f341f"
}
```

- To confirm the dashboard renders human-readable primary label, secondary path meta, relative timestamp, and **Open refresh procedure** CTA with `aria-describedby`, render the dashboard and assert active-memory test ids.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1027, 1045],
  "contentHash": "3d0e84f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [35, 35],
  "contentHash": "b0f341f"
}
```

- To exercise idle state when no active feature is set, mock null path and label fields and assert idle copy without a path meta row.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1048, 1067],
  "contentHash": "3d0e84f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [36, 36],
  "contentHash": "b0f341f"
}
```

- To toggle long blockers in-panel, click **Show full blockers** and assert `aria-expanded` flips to `true` with `data-expanded="true"` on the excerpt paragraph.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1070, 1095],
  "contentHash": "3d0e84f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [36, 36],
  "contentHash": "b0f341f"
}
```

- To validate refresh timestamp formatting branches, call `formatActiveMemoryRefreshTime` with minute, yesterday, and locale-age fixtures and assert visible text excludes raw ISO.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1098, 1105],
  "contentHash": "3d0e84f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [5, 13],
  "contentHash": "b0f341f"
}
```

## Testing

Coverage delta is complete for all public symbols the staged six-file touch-set adds or modifies. Route tests assert label and slug parsing, idle `(none)` null metadata, missing-file slug fallback, and markdown-free blockers summary across three cases. Page tests assert human-readable primary label hierarchy, **Open refresh procedure** CTA with `aria-describedby`, relative timestamp phrasing, idle copy without path row, blockers expand toggle with `aria-expanded`, and `formatActiveMemoryRefreshTime` age branches across five active-memory cases. Three touch-set gate commands exited 0 on 2026-06-08—client lint, typecheck, and 45 focused Vitest tests—yielding `qa_passes: true`; design-QA confirms F-01, F-02, F-05, and F-10 at 1280×900 and 375×812.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/test-report.md",
  "range": [5, 13],
  "contentHash": "b0f341f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/review.md",
  "range": [37, 39],
  "contentHash": "9afdb89"
}
```
