# Delivery Report — Command Center active memory craft enforcement

## Summary

This feature closes design-craft gates #2, #3, #9, #11, and #12 on the Command Center Pipeline Active memory panel while retaining F-05 expand toggle and F-10 relative timestamp from operator-readability. The implement stage replaces `blockersSummary` prose with structured `blockerItems` chips, hides visible `lib/inbox/in/` path text behind slug metadata plus a ghost copy icon, renames the refresh CTA to **Open OPERATION.md**, applies solid elevated card chrome scoped to `.active-memory-header`, and enforces exactly one accent action button. Review passed with `review_passes: true` on round-3 re-review; test passed with `qa_passes: true` across 46 focused Vitest tests plus client lint and typecheck. Changes stay client-only within a six-file touch set.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/implementation-report.md",
  "range": [8, 10],
  "contentHash": "15aa080"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/review.md",
  "range": [3, 5],
  "contentHash": "03e9834"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [3, 5],
  "contentHash": "388a528"
}
```

## Architecture

- Active memory snapshot enrichment SHALL replace joined `blockersSummary` prose with `blockerItems: string[]`, mapping each `current.md` list item to one chip label with emphasis stripped and 60-character truncation.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/plan.md",
  "range": [19, 26],
  "contentHash": "f65245b"
}
```

- `ActiveMemoryHeader` SHALL hide readable path strings, show slug-only secondary metadata with a ghost copy icon, rename the refresh CTA to **Open OPERATION.md**, render blocker chips with a Files source link, and retain F-05 expand toggle when more than three chips exist.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/plan.md",
  "range": [28, 45],
  "contentHash": "f65245b"
}
```

- Solid elevated card chrome SHALL apply only to `.active-memory-header`; inbox triage and multi-run dashed borders remain unchanged per locked gate #9 scope.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/plan.md",
  "range": [47, 51],
  "contentHash": "f65245b"
}
```

- Locked presentation choices SHALL use copy-only icon path affordance, chip row blockers with Files link for full source, and a single accent **Open OPERATION.md** CTA per ux-spec.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/plan.md",
  "range": [91, 98],
  "contentHash": "f65245b"
}
```

- ADR draft records structured blockers over prose truncation, slug plus ghost copy over visible path text, and solid elevated chrome scoped to the Active memory panel only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/adr-draft.md",
  "range": [57, 72],
  "contentHash": "a98e22b"
}
```

## Interfaces

- `ActiveMemorySnapshot` replaces `blockersSummary` with `blockerItems: string[]` alongside existing path, label, slug, and refresh fields.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [300, 306],
  "contentHash": "1295b48"
}
```

- `parseBlockerItems` maps list lines to chip labels with markdown emphasis stripped, 60-character truncation, and a compact fallback for non-list blocker bodies.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [109, 127],
  "contentHash": "9a12bdc"
}
```

- `loadActiveMemory` emits `blockerItems` from the Risks and blockers section while retaining label, slug, path, and refresh timestamp parsing.

```json
{
  "kind": "lines",
  "path": "client/src/services/active-memory.ts",
  "range": [136, 152],
  "contentHash": "9a12bdc"
}
```

- `formatActiveMemoryRefreshTime` formats ISO timestamps as relative phrasing under 7 days or locale `Intl.DateTimeFormat` strings for older values.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx",
  "range": [13, 49],
  "contentHash": "d7ca773"
}
```

- `BlockersExcerpt` renders `.active-memory-blocker-chip` rows, a Files source link, and an F-05 expand toggle when item count exceeds three.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx",
  "range": [125, 177],
  "contentHash": "d7ca773"
}
```

- `ActiveMemoryHeader` renders slug metadata with ghost `CopyPathButton`, chip blockers, semantic refresh `<time>`, and the **Open OPERATION.md** accent CTA.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx",
  "range": [179, 278],
  "contentHash": "d7ca773"
}
```

- `GET /api/active-memory` passes through the enriched snapshot without route handler changes.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/implementation-report.md",
  "range": [35, 35],
  "contentHash": "15aa080"
}
```

## Tradeoffs

- `CopyPathButton` clipboard activation and **Copied** tooltip feedback lack an automated assertion; manual keyboard checks cover focus but a Vitest click mock would pin F-01 copy affordance.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/review.md",
  "range": [15, 15],
  "contentHash": "03e9834"
}
```

- `parseBlockerItems` compact fallback for non-list blocker bodies is not exercised by route tests; only list-item parsing and 60-character truncation are asserted.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/review.md",
  "range": [16, 16],
  "contentHash": "03e9834"
}
```

- Design QA notes the **View full blockers in Files** link hit target is ~13.5px tall versus the 32px touch floor at 375×812; follow-up MAY add min-height padding without accent fill.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/review.md",
  "range": [17, 17],
  "contentHash": "03e9834"
}
```

- Removing visible path text adds one copy interaction for operators who previously read the path inline; slug plus copy icon mitigates the trade-off per ADR negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/adr-draft.md",
  "range": [88, 90],
  "contentHash": "a98e22b"
}
```

- Chip summarization may lose nuance from long blocker prose; the Files source link preserves full `current.md` access per ADR negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/adr-draft.md",
  "range": [91, 92],
  "contentHash": "a98e22b"
}
```

## Usage guidelines

- To verify snapshot blocker chip parsing and markdown stripping, call `loadActiveMemory` in a temp repo and assert `blockerItems` array shape without literal `**` markers.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/active-memory/route.test.ts",
  "range": [58, 78],
  "contentHash": "13b0092"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [34, 34],
  "contentHash": "388a528"
}
```

- To confirm 60-character chip truncation, call `parseBlockerItems` with an 80-character list item and assert the returned label ends with an ellipsis at length 60.

```json
{
  "kind": "lines",
  "path": "client/src/app/api/active-memory/route.test.ts",
  "range": [98, 104],
  "contentHash": "13b0092"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [34, 34],
  "contentHash": "388a528"
}
```

- To confirm the dashboard hides path text, renders slug metadata, blocker chips, solid border, single accent CTA, and **Open OPERATION.md** label, render the dashboard and assert active-memory test ids.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1032, 1066],
  "contentHash": "a7cb842"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [35, 35],
  "contentHash": "388a528"
}
```

- To exercise idle state when no active feature is set, mock null path and slug fields and assert idle copy without a slug meta row.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1069, 1088],
  "contentHash": "a7cb842"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [35, 35],
  "contentHash": "388a528"
}
```

- To toggle long blocker chips in-panel, click **Show full blockers** and assert `aria-expanded` flips to `true` with five visible chips in the expanded state.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1091, 1118],
  "contentHash": "a7cb842"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [35, 35],
  "contentHash": "388a528"
}
```

- To validate refresh timestamp formatting branches, call `formatActiveMemoryRefreshTime` with minute, yesterday, and locale-age fixtures and assert visible text excludes raw ISO.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1121, 1128],
  "contentHash": "a7cb842"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [9, 13],
  "contentHash": "388a528"
}
```

## Testing

Coverage delta is complete for all public symbols the staged six-file touch-set adds or modifies. Route tests assert `blockerItems` array shape, markdown-free chip labels, 60-character truncation, idle null metadata, and missing-file slug fallback across four cases. Page tests assert hidden path meta, slug row plus ghost copy icon, blocker chips with Files source link, solid non-dashed border, single accent **Open OPERATION.md** CTA with `aria-describedby`, F-05 expand toggle across 3-to-5 chips, and F-10 relative timestamp phrasing across four active-memory craft cases plus formatter unit tests. Three touch-set gate commands exited 0 on 2026-06-09—client lint, typecheck, and 46 focused Vitest tests—yielding `qa_passes: true`; design-QA confirms gates #2, #3, #9, #11, and #12 at 1280×900 and 375×812.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/test-report.md",
  "range": [9, 13],
  "contentHash": "388a528"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/82780_0100_command-center-active-memory-craft-enforcement/review.md",
  "range": [34, 37],
  "contentHash": "03e9834"
}
```
