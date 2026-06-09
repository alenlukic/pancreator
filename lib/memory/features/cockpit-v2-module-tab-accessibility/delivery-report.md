# Delivery Report — Cockpit v2 module tab accessibility

## Summary

This feature delivery closes design-audit findings F-01 and F-09 by refactoring `CockpitShell` module navigation to the WAI-ARIA tabs pattern with roving `tabIndex`, `aria-controls` / `tabpanel` pairing, and manual activation where arrow keys and Home/End move focus only and Enter or Space switch modules. Focus visibility retains a `2px` accent `:focus-visible` outline with an active-tab `box-shadow` halo for eggshell contrast. Review passed with `review_passes: true` and zero must-fix findings; contract `ux.module-tab-focus` passed llm-judge evaluation. Test passed with `qa_passes: true` across 43 focused `page.test.tsx` tests plus client lint and typecheck. Touch-set scope is three files only; no API or backend changes.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/implementation-report.md",
  "range": [8, 12],
  "contentHash": "16e9155"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/review.md",
  "range": [3, 5],
  "contentHash": "80925e7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [3, 5],
  "contentHash": "57171c7"
}
```

## Architecture

- Cockpit v2 module navigation SHALL adopt the WAI-ARIA tabs pattern with roving `tabIndex`, `aria-controls` / `tabpanel` pairing, and manual activation so arrow keys move focus only and Enter or Space switch modules through existing `onActiveModuleChange`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/plan.md",
  "range": [5, 15],
  "contentHash": "3a05475"
}
```

- Focus and activation SHALL split: `focusTab(index)` moves DOM focus without calling `onActiveModuleChange`; `ArrowLeft`, `ArrowRight`, `Home`, and `End` invoke `focusTab` only; `Enter` and `Space` activate the focused tab with `event.preventDefault()`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/plan.md",
  "range": [19, 25],
  "contentHash": "fb5f7a2"
}
```

- Active-tab focus visibility SHALL retain `2px solid var(--accent)` outline plus a `box-shadow: 0 0 0 2px var(--surface-primary)` halo on the inverted active tab over eggshell `--surface-primary`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/plan.md",
  "range": [35, 41],
  "contentHash": "55270fd"
}
```

- ADR 0010 records the decision to implement WAI-ARIA manual-activation tabs and rejects plain buttons with `aria-selected` only and automatic selection-follows-focus on arrow keys.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/adr-draft.md",
  "range": [43, 48],
  "contentHash": "e453189"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/adr-draft.md",
  "range": [50, 56],
  "contentHash": "0b7e9c1"
}
```

## Interfaces

- `CockpitModule` is the union type for Pipeline, Automations, Maintenance, and Files module identifiers.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitShell.tsx",
  "range": [8, 8],
  "contentHash": "fc0ab74"
}
```

- `MODULE_TABS` is the single source for tab order and labels, including the Files `›` secondary label.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitShell.tsx",
  "range": [10, 15],
  "contentHash": "921ad8b"
}
```

- `CockpitShell` exposes WAI-ARIA `tablist` semantics, roving `tabIndex`, manual keyboard activation, and `tabpanel` wiring for all four modules.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitShell.tsx",
  "range": [17, 35],
  "contentHash": "8e09492"
}
```

- `focusTab` and `handleTabKeyDown` implement focus-only arrow and Home/End moves plus Enter and Space activation through `onActiveModuleChange`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitShell.tsx",
  "range": [38, 78],
  "contentHash": "0dad438"
}
```

- Module tab buttons expose `role="tab"`, stable ids, `aria-controls`, `aria-selected`, and roving `tabIndex` tied to the active module.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/layout/CockpitShell.tsx",
  "range": [82, 109],
  "contentHash": "4d6322a"
}
```

- `.cockpit-module-tab:focus-visible` and `.cockpit-module-tab-active:focus-visible` define the accent outline and active-tab halo for keyboard focus visibility.

```json
{
  "kind": "lines",
  "path": "client/src/app/globals.css",
  "range": [521, 530],
  "contentHash": "6105dc2"
}
```

## Tradeoffs

- Active-tab `:focus-visible` CSS lacks an automated style probe; keyboard focus-ring visibility on the inverted active tab relies on qa-tester manual verification per the implementation report checklist.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/review.md",
  "range": [13, 23],
  "contentHash": "f8b83f2"
}
```

- `tabIndex` remains tied to `aria-selected` rather than the focused tab; arrow and Home/End move DOM focus to tabs carrying `tabIndex={-1}` while the selected tab retains `tabIndex={0}`, matching WAI-ARIA manual-activation guidance but potentially confusing Tab-return operators.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/review.md",
  "range": [25, 33],
  "contentHash": "c9e2838"
}
```

- Manual activation adds one extra keystroke versus selection-follows-focus; operators accustomed to immediate arrow switching must press Enter or Space per ADR 0010 negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/adr-draft.md",
  "range": [72, 76],
  "contentHash": "5f85f40"
}
```

- Consolidated `pan lint contracts` remains deferred at M1 with zero registered clauses under this Feature folder; dependency contract `ux.module-tab-focus` passed manual llm-judge evaluation only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/review.md",
  "range": [43, 51],
  "contentHash": "d96a886"
}
```

## Usage guidelines

- To verify WAI-ARIA tablist semantics and roving `tabIndex`, render the dashboard and assert the tablist exposes four tabs with `aria-selected`, `tabIndex`, and `aria-controls` / `tabpanel` id linkage.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [416, 456],
  "contentHash": "550fd09"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [34, 35],
  "contentHash": "8f1ec01"
}
```

- To confirm manual activation, press ArrowRight, Home, End, and ArrowLeft on module tabs and assert focus moves without changing the active module or panel content.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [458, 498],
  "contentHash": "a1197bd"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [9, 13],
  "contentHash": "e1d2f86"
}
```

- To activate modules with keyboard parity to click, press Enter or Space on each focused tab across Pipeline, Automations, Maintenance, and Files and assert the active class and matching `tabpanel` id update.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [500, 562],
  "contentHash": "1e425cc"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [9, 13],
  "contentHash": "e1d2f86"
}
```

- To validate keyboard-only focus visibility at 1280×900, Tab into the module strip and confirm each tab stop shows a visible `2px` accent `:focus-visible` ring including on the inverted active tab over eggshell `--surface-primary`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/implementation-report.md",
  "range": [58, 66],
  "contentHash": "994479a"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [35, 35],
  "contentHash": "ad1881d"
}
```

## Testing

Coverage delta is strong on the three-path touch-set: four integration tests in `page.test.tsx` assert tablist and tabpanel linkage, roving `tabIndex`, inactive `aria-selected="false"`, manual Arrow/Home/End focus without module switch, Enter and Space activation across all four tabs, and Files secondary label styling. Public symbols `CockpitShell`, `MODULE_TABS`, and `handleTabKeyDown` each receive direct keyboard integration coverage. Three touch-set gate commands exited 0—client lint, typecheck, and 43 focused UI tests—yielding `qa_passes: true`. CSS `:focus-visible` rules lack automated style probes; qa-tester confirmed source and served stylesheet include the accent outline and active-tab halo.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/test-report.md",
  "range": [9, 13],
  "contentHash": "e1d2f86"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/review.md",
  "range": [53, 55],
  "contentHash": "6536e6f"
}
```
