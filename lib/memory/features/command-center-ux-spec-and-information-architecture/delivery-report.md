# Delivery Report — Command Center UX spec and information architecture

## Summary

This feature delivery ratifies documentation-only UX authority for Command Center before any production React or API code lands. The implement stage aligned `spec.md` and `ux-spec.md` frontmatter, populated `index.json` with feature metadata and dual-anchor citations, and confirmed every Engineering Spec acceptance criterion against the design-engineer companion. The ux-spec defines a three-module shell—Pipeline (default), Automations, and Maintenance—with Files on a secondary tab, P9 run-state composition via `GET /api/run-state`, P10 safe-editing guards, WCAG 2.2 AA contract blocks, and a proposed `client/src/components/command-center/` inventory. Review passed with `review_passes: true`, test passed with `qa_passes: true`, and zero executable lines changed under `client/` or `lib/internal/packages/`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/implementation-report.md",
  "range": [3, 12],
  "contentHash": "2d11112"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/review.md",
  "range": [3, 9],
  "contentHash": "0b1b33b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [3, 5],
  "contentHash": "31dcbaf"
}
```

## Architecture

- Command Center SHALL adopt exactly three primary module tabs—Pipeline (default), Automations, and Maintenance—with Files as a visually de-emphasized secondary tab, composing run state from existing `GET /api/run-state` and P10 write-guard contracts without inventing new runner APIs.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/adr-draft.md",
  "range": [46, 51],
  "contentHash": "f2a43c1"
}
```

- The implement stage SHALL ratify and index ux-spec artifacts without touching production React or API code; downstream Command Center implementation inbox items consume `ux-spec.md` as the sole UX source of truth.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/plan.md",
  "range": [5, 13],
  "contentHash": "034366d"
}
```

- The ux-spec SHALL document P9 run-state composition, P10 safe-editing in artifact surfaces, WCAG 2.2 AA contract blocks, a proposed `client/src/components/command-center/` inventory, and `globals.css` token extensions as frozen UX contracts for review.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/plan.md",
  "range": [68, 74],
  "contentHash": "034366d"
}
```

## Interfaces

- `lib/memory/features/command-center-ux-spec-and-information-architecture/spec.md` defines the Engineering Spec acceptance criteria, delivery boundary, and out-of-scope boundaries for documentation-only delivery.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/spec.md",
  "range": [87, 168],
  "contentHash": "8502a88"
}
```

- `lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md` defines the three-module information architecture, module interaction requirements, component inventory, wireframes, and two embedded `llm-judge` UX contract blocks.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md",
  "range": [46, 55],
  "contentHash": "96d5a8f"
}
```

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md",
  "range": [202, 241],
  "contentHash": "96d5a8f"
}
```

- `lib/memory/features/command-center-ux-spec-and-information-architecture/index.json` indexes feature metadata, the touch-set snapshot, artifact paths, and dual-anchor citations with `metadata.documentation_only: true`.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/index.json",
  "range": [45, 62],
  "contentHash": "561d497"
}
```

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/index.json",
  "range": [120, 125],
  "contentHash": "561d497"
}
```

- No runtime symbols changed; the touch-set declares empty `symbols` and `tests` arrays because this Feature delivers spec artifacts only.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/implementation-report.md",
  "range": [116, 118],
  "contentHash": "2d11112"
}
```

## Tradeoffs

- The ADR draft records the three-module IA decision as `proposed`; human ratification at ship SHALL copy ADR 0009 to `lib/memory/adr/` before downstream implementation binds to it.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/adr-draft.md",
  "range": [53, 56],
  "contentHash": "f2a43c1"
}
```

- Domain-card demotion removes quick-jump navigation; operators rely on the Files secondary tab or module deep links instead of the P9 left-rail Domains grid.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/adr-draft.md",
  "range": [71, 74],
  "contentHash": "f2a43c1"
}
```

- Embedded `llm-judge` contract blocks lack `contracts.index.json` registration; downstream runners cannot auto-discover clauses until ship or a follow-on task registers them.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/review.md",
  "range": [17, 26],
  "contentHash": "0b1b33b"
}
```

- `spec.md` frontmatter marks `status: ratified` while `intake_closure.human_approval_gate` remains `pending`; the ship stage SHALL reconcile terminology before ADR copy.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/review.md",
  "range": [36, 43],
  "contentHash": "0b1b33b"
}
```

## Usage guidelines

- To bind a downstream Command Center implementation run, read `ux-spec.md` §Layout and navigation for the three primary module tabs and Files secondary demotion before authoring React components.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md",
  "range": [50, 55],
  "contentHash": "96d5a8f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [31, 32],
  "contentHash": "31dcbaf"
}
```

- To implement the Pipeline module, source run state from `GET /api/run-state` only and enforce P10 read-only default, explicit edit activation, and diff confirmation in artifact surfaces per ux-spec §Interaction requirements.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/ux-spec.md",
  "range": [124, 136],
  "contentHash": "96d5a8f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [28, 29],
  "contentHash": "31dcbaf"
}
```

- To validate accessibility contracts before implementation, evaluate the two embedded `llm-judge` blocks (`module-tab-focus` and `stage-status-contrast`); review recorded manual scores of 1.0 against the 0.75 threshold.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/review.md",
  "range": [60, 67],
  "contentHash": "0b1b33b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [27, 28],
  "contentHash": "31dcbaf"
}
```

- To scope implement writes, restrict the touch-set to `spec.md`, `ux-spec.md`, and `index.json`; staged diffs SHALL exclude `client/`, `lib/internal/packages/`, `pancreator.yaml`, and `lib/memory/active/current.md`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [29, 30],
  "contentHash": "31dcbaf"
}
```

```json
{
  "kind": "lines",
  "path": "lib/memory/features/command-center-ux-spec-and-information-architecture/spec.md",
  "range": [161, 165],
  "contentHash": "8502a88"
}
```

## Testing

Coverage delta against the prior baseline is not applicable because this pass changes only Markdown and JSON artifacts under the three-path touch-set. Statement and branch coverage on changed executable lines are N/A (0/0) per `new_lines_only` policy. All 160 repository node tests pass, phase-0a scaffold check passes, context-budget report passes, and `qa_passes: true` with `design_qa_passes: true` (browser inspection excluded for documentation-only delivery).

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/test-report.md",
  "range": [3, 5],
  "contentHash": "31dcbaf"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/review.md",
  "range": [69, 76],
  "contentHash": "0b1b33b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/53639_0906_command-center-ux-spec-and-information-architecture/implementation-report.md",
  "range": [120, 126],
  "contentHash": "2d11112"
}
```
