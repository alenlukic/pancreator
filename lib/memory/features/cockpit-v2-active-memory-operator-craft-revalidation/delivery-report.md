# Delivery Report — Cockpit v2 active memory operator craft revalidation

## Summary

This feature revalidates the Cockpit v2 Pipeline Active memory panel under tightened design-craft gates 1, 2, 3, 5, 9, and 11 while restoring F-05 expand toggle and F-10 relative timestamp remediations. The implement stage extends `ActiveMemorySnapshot` and `loadActiveMemory` with `activeFeatureLabel`, `activeFeatureSlug`, and `blockerChips`, refactors `ActiveMemoryHeader` to show a semibold human-first label with copy-only path icon, chip-summarized blockers with expand toggle, semantic `<time>` refresh timestamp, and the **Open OPERATION.md** CTA, and applies solid elevated card chrome scoped to `.active-memory-header`. Review passed with `review_passes: true`; test passed with `qa_passes: true` across 49 focused Vitest tests. The `GET /api/active-memory` route passes through the enriched snapshot without shape change.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/implementation-report.md",
  "range": [8, 10],
  "contentHash": "5c60784"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/review.md",
  "range": [3, 5],
  "contentHash": "4a5304a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [3, 5],
  "contentHash": "75ad68e"
}
```

## Architecture

- Active memory snapshot enrichment SHALL add `activeFeatureLabel`, optional `activeFeatureSlug`, and `blockerChips: string[]` by reading the inbox Markdown file referenced in `current.md`, splitting `## Risks and blockers` into short chip labels, and keeping `activeFeaturePath` for clipboard only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/plan.md",
  "range": [30, 38],
  "contentHash": "bf60229"
}
```

- `ActiveMemoryHeader` SHALL render a Mobbin-fidelity orientation card with semibold primary label, copy-only path icon without visible repo path, chip rows with expand toggle when more than three chips exist, relative `<time>` timestamp, and sole **Open OPERATION.md** CTA with `aria-describedby`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/plan.md",
  "range": [41, 55],
  "contentHash": "bf60229"
}
```

- Scoped CSS in `globals.css` SHALL replace dashed wireframe chrome with solid elevated card styling using `--surface-elevated`, solid border, box-shadow, `min-width: 0`, and `overflow: hidden` on `.active-memory-header` only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/plan.md",
  "range": [57, 63],
  "contentHash": "bf60229"
}
```

- ADR draft records server-side snapshot enrichment with chip-summarized blockers, solid elevated card presentation, and scoped `.active-memory-*` CSS without altering `current.md` authoring format or sibling orientation panels.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/adr-draft.md",
  "range": [29, 38],
  "contentHash": "ca5c478"
}
```

- The plan rejects visible monospace path rows, banned refresh CTA labels, and prose blockers dumps because they violate design-craft gates 2, 3, and 11.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/adr-draft.md",
  "range": [40, 42],
  "contentHash": "ca5c478"
}
```

## Interfaces

- `ActiveMemorySnapshot` adds `activeFeatureLabel: string | null`, `activeFeatureSlug: string | null`, and `blockerChips: string[]` alongside existing path, blockers summary, and refresh fields.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [300, 307],
  "contentHash": "dcc536d"
}
```

- `formatActiveMemoryRefreshTime` formats ISO timestamps as relative phrasing under 7 days or locale `Intl.DateTimeFormat` strings for older values.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [311, 345],
  "contentHash": "dcc536d"
}
```

- `loadActiveMemory` reads `lib/memory/active/current.md`, resolves inbox title and slug metadata, parses `blockerChips` from the blockers section, and returns the enriched snapshot.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [156, 175],
  "contentHash": "83cad8a"
}
```

- `parseBlockerChips` splits list items or compact sentence boundaries into chip labels capped at 60 characters.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [89, 113],
  "contentHash": "83cad8a"
}
```

- `ActiveMemoryHeader` renders primary label row with copy-only icon, `BlockersChips` expand toggle, semantic refresh `<time>`, and **Open OPERATION.md** CTA wired to `onOpenRefreshProcedure`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/pipeline/ActiveMemoryHeader.tsx",
  "range": [106, 184],
  "contentHash": "c4e105f"
}
```

- `GET /api/active-memory` passes through the enriched `loadActiveMemory` snapshot without route shape change.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/implementation-report.md",
  "range": [33, 33],
  "contentHash": "5c60784"
}
```

## Tradeoffs

- `deriveSlugFromFilename` and `extractTitle` remain duplicated in `active-memory.ts` rather than imported from `inbox.ts` to stay within the declared touch set; shared extraction would reduce title or slug drift risk.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/review.md",
  "range": [17, 17],
  "contentHash": "4a5304a"
}
```

- Containment probes run at jsdom default dimensions without explicit viewport resize at 1280×900 and 375×812; Playwright or jsdom resize helpers would align automated evidence with design-audit viewports.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/review.md",
  "range": [19, 19],
  "contentHash": "4a5304a"
}
```

- `blockersSummary` is retained alongside `blockerChips` for backward compatibility while the header renders chips only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/implementation-report.md",
  "range": [71, 71],
  "contentHash": "5c60784"
}
```

- Inbox triage and multi-run dashed borders remain unchanged because gate 9 is scoped to `.active-memory-header` only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/implementation-report.md",
  "range": [73, 73],
  "contentHash": "5c60784"
}
```

- `loadActiveMemory` performs an extra filesystem read when an active inbox path is set; acceptable for a single orientation panel on dashboard load per ADR negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/adr-draft.md",
  "range": [51, 53],
  "contentHash": "ca5c478"
}
```

## Usage guidelines

- To verify snapshot label parsing and blocker chip extraction, call `loadActiveMemory` in a temp repo and assert `activeFeatureLabel`, slug metadata, and `blockerChips` array without markdown emphasis.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/active-memory/route.test.ts",
  "range": [86, 108],
  "contentHash": "d81e897"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [32, 32],
  "contentHash": "75ad68e"
}
```

- To confirm the dashboard hides raw inbox paths and renders human label, copy icon, and **Open OPERATION.md** CTA, render the dashboard and assert active-memory test ids.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1041, 1054],
  "contentHash": "0cfc85a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [33, 33],
  "contentHash": "75ad68e"
}
```

- To exercise craft gates including solid border, relative timestamp, and F-05 expand toggle, mock five blocker chips and assert containment probe, CTA `aria-describedby`, and collapsed chip count of three.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1057, 1095],
  "contentHash": "0cfc85a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [33, 33],
  "contentHash": "75ad68e"
}
```

- To toggle expanded blocker chips in-panel, click **Show all blockers** and assert `aria-expanded` flips to `true` with `data-expanded="true"` on the blockers container.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1115, 1121],
  "contentHash": "0cfc85a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [33, 33],
  "contentHash": "75ad68e"
}
```

- To validate refresh timestamp formatting branches, call `formatActiveMemoryRefreshTime` with minute, yesterday, and locale-age fixtures and assert visible text excludes raw ISO.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1492, 1508],
  "contentHash": "0cfc85a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [34, 34],
  "contentHash": "75ad68e"
}
```

## Testing

Coverage delta is complete for all public symbols the staged six-file touch-set adds or modifies. Route tests assert label and slug parsing, `blockerChips` array extraction, 60-character chip truncation, idle `(none)` null metadata, and missing-file slug fallback across four integration cases. Page tests assert no visible `lib/inbox/in/` path, solid border containment probe, human label dominance, copy-path icon presence, **Open OPERATION.md** CTA with `aria-describedby`, F-05 expand toggle with `aria-expanded`, F-10 relative timestamp without raw ISO, idle copy when path is null, and three `formatActiveMemoryRefreshTime` age-branch unit tests. Touch-set Vitest gate exited 0 with 49 passing tests on 2026-06-09, yielding `qa_passes: true`; three embedded ux-spec llm-judge contracts passed per reviewer evidence.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/test-report.md",
  "range": [5, 13],
  "contentHash": "75ad68e"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/77283_0231_cockpit-v2-active-memory-operator-craft-revalidation/review.md",
  "range": [43, 45],
  "contentHash": "4a5304a"
}
```
