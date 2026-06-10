# Delivery Report — Command Center craft polish pass

## Summary

This feature delivery closes design-audit blocker B1 and majors M1–M6 in Command Center through a bounded craft-polish pass limited to `client/src/components/command-center/` and `globals.css`. The implement stage adds WAI-ARIA module tabs with keyboard roving, relocates pre-close validation exclusively to Maintenance, replaces Pipeline hollow dead space with a unified empty-run recovery surface, compacts sidebar triage and active-memory previews, elevates the automation wizard into a focus-trapped overlay, adds Maintenance OUTPUT idle guidance and a dedicated compliance Result column, and de-emphasizes the Files secondary tab. Review passed with `review_passes: true` and zero must-fix findings. Test passed with `qa_passes: true` across 46 focused UI tests plus client lint and typecheck. No API route or backend changes.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/implementation-report.md",
  "range": [8, 12],
  "contentHash": "17e8800"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [3, 5],
  "contentHash": "9df484b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [3, 5],
  "contentHash": "8f04dbb"
}
```

## Architecture

- Command Center craft polish SHALL align live module tabs with the WAI-ARIA tabs pattern, relocate pre-close validation exclusively to Maintenance, replace Pipeline dead space with unified empty-run recovery, compact sidebar triage and active-memory previews, elevate the automation wizard into a focus-trapped overlay, add Maintenance OUTPUT idle guidance and a compliance Result column, and de-emphasize the Files secondary tab—all within existing read-only API contracts.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [5, 15],
  "contentHash": "015a234"
}
```

- Module tabs SHALL expose `role="tablist"` and `role="tab"` with roving `tabIndex`, Left/Right/Home/End keyboard activation, and a retained `2px` accent `:focus-visible` ring at ≥3:1 contrast against the active fill.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [19, 25],
  "contentHash": "f6d1052"
}
```

- Pre-close validation SHALL render only in Maintenance; Pipeline SHALL show a one-line Maintenance navigation link when pre-close context is needed.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [31, 36],
  "contentHash": "36bd368"
}
```

- When `filterNonTerminalTasks` returns zero rows, Pipeline SHALL render `PipelineEmptyRunState` spanning the stage grid and timeline region and SHALL hide `StageMachineGrid` and `RunEventTimeline`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [42, 48],
  "contentHash": "941df40"
}
```

- The automation wizard SHALL use a backdrop dimming and slide-over overlay with `useFocusTrap`, Esc close, and scroll restoration on Cancel or Save, matching the artifact drawer pattern.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [65, 68],
  "contentHash": "74d63d0"
}
```

- Maintenance SHALL render dashed OUTPUT idle guidance when no streamed output exists and SHALL align compliance pass or fail values in a dedicated Result column.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/plan.md",
  "range": [74, 79],
  "contentHash": "f47e4bf"
}
```

- ADR 0011 records the decision to implement craft polish within client presentation layers and rejects palette redesign and new mutating inbox recovery APIs.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/adr-draft.md",
  "range": [46, 54],
  "contentHash": "2ce67b3"
}
```

## Interfaces

- `DashboardModuleShell` exposes WAI-ARIA tablist semantics, roving `tabIndex`, keyboard activation, and tabpanel wiring for Pipeline, Automations, Maintenance, and Files.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/layout/DashboardModuleShell.tsx",
  "range": [17, 25],
  "contentHash": "caca03d"
}
```

- `PipelineModule` gates the stage grid and timeline behind non-terminal task count, renders `PipelineEmptyRunState` when empty, and links to Maintenance for pre-close context.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/PipelineModule.tsx",
  "range": [25, 35],
  "contentHash": "08406ff"
}
```

- `PipelineEmptyRunState` is the unified dashed empty-run recovery surface with "No active runs" copy and inbox-derived recovery CTA.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/PipelineEmptyRunState.tsx",
  "range": [12, 25],
  "contentHash": "5d42e35"
}
```

- `InboxTriagePanel` limits visible row controls to two primary buttons plus an icon copy-path action and hides duplicate slug labels when `title === slug`.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/InboxTriagePanel.tsx",
  "range": [13, 22],
  "contentHash": "04503f4"
}
```

- `ActiveMemoryHeader` renders bold markdown without literal `**` markers and collapses bodies longer than 3 lines behind Show details.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/pipeline/ActiveMemoryHeader.tsx",
  "range": [19, 28],
  "contentHash": "4b2d8e5"
}
```

- `MaintenanceModule` hosts the pre-close panel, compliance audit panel, test suite picker, and OUTPUT stream with optional idle guidance.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/maintenance/MaintenanceModule.tsx",
  "range": [10, 20],
  "contentHash": "54a2c1d"
}
```

- `PreCloseValidationPanel` fetches run-state eligibility, links to OPERATION.md, and exposes the `pan check` CTA for Maintenance-only pre-close validation.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/maintenance/PreCloseValidationPanel.tsx",
  "range": [34, 45],
  "contentHash": "e6dd122"
}
```

- `ComplianceAuditPanel` adds a dedicated Result column with aligned pass or fail values separate from the Severity column.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/maintenance/ComplianceAuditPanel.tsx",
  "range": [32, 42],
  "contentHash": "e883150"
}
```

- `AutomationsModule` captures and restores automation list scroll position when the wizard opens or closes.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/automations/AutomationsModule.tsx",
  "range": [18, 30],
  "contentHash": "863e74b"
}
```

- `AutomationWizardShell` renders a backdrop and slide-over overlay with `useFocusTrap`, Esc close, and four-step wizard navigation.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/automations/AutomationWizard/Shell.tsx",
  "range": [25, 35],
  "contentHash": "2548395"
}
```

- `useFocusTrap` accepts an optional `onEscape` callback for overlay dismissal while retaining focus containment.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/shared/useFocusTrap.ts",
  "range": [8, 20],
  "contentHash": "41d26f2"
}
```

- `OutputStream` renders optional dashed idle guidance when no streamed output exists in the session.

```json
{
  "kind": "lines",
  "path": "client/src/components/command-center/shared/OutputStream.tsx",
  "range": [12, 25],
  "contentHash": "0361af6"
}
```

## Tradeoffs

- Module tab buttons omit `aria-posinset` and `aria-setsize`; screen-reader position metadata ("1 of 4, selected") remains a consider item for operator follow-up before QA spot-check.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [13, 23],
  "contentHash": "8aa990d"
}
```

- Wizard overlay integration lacks focused Esc-close and scroll-restoration tests; M5 regressions may surface only through browser QA until tests land.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [25, 33],
  "contentHash": "8e34e4b"
}
```

- Pipeline hides the Maintenance pre-close link during empty-run state; operators in zero-task mode must navigate to Maintenance manually for pre-close checks.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [35, 39],
  "contentHash": "8237647"
}
```

- Pre-close panel relocation requires Maintenance run-state fetch wiring and test fixture updates per ADR 0011 negative consequences.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/adr-draft.md",
  "range": [72, 76],
  "contentHash": "7e4b089"
}
```

- Consolidated `pan contracts` remains deferred with zero registered clauses; no Spec Contract runner output applies to this Feature folder.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [57, 59],
  "contentHash": "2587f70"
}
```

## Usage guidelines

- To verify WAI-ARIA module tab semantics, render the dashboard and assert the tablist exposes four tabs with ArrowRight roving between Pipeline and Automations.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [416, 438],
  "contentHash": "bec465f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [35, 37],
  "contentHash": "b06da34"
}
```

- To confirm pre-close IA relocation, assert Pipeline lacks `pre-close-validation-panel`, click the Maintenance link, and verify the panel mounts only in Maintenance.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [452, 466],
  "contentHash": "b0bb19b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [5, 13],
  "contentHash": "74d8bf7"
}
```

- To exercise Pipeline empty-run recovery, mock zero run-state tasks and assert `pipeline-empty-run-state` renders while stage grid and timeline stay hidden.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [558, 569],
  "contentHash": "45615a4"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [35, 37],
  "contentHash": "b06da34"
}
```

- To open the automation wizard overlay, navigate to Automations, start the four-step wizard, and assert overlay and backdrop test ids are present.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1331, 1348],
  "contentHash": "690ab75"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [5, 13],
  "contentHash": "74d8bf7"
}
```

- To validate Maintenance OUTPUT idle guidance and compliance Result alignment, navigate to Maintenance and assert idle copy plus `compliance-result-*` pass values after a compliance run.

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1425, 1438],
  "contentHash": "0f06612"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/app/page.test.tsx",
  "range": [1498, 1519],
  "contentHash": "78f18ca"
}
```

## Testing

Coverage delta is high across the 14-file touch-set: `page.test.tsx` adds integration assertions for WAI-ARIA tablist semantics, Files secondary styling, pre-close IA relocation, Pipeline empty-run gating, inbox row compaction, active-memory markdown preview, wizard overlay and backdrop, Maintenance OUTPUT idle guidance, and compliance Result column alignment. All 12 public symbols receive at least one integration assertion; `useFocusTrap` is covered indirectly via wizard overlay open. Three touch-set gate commands exited 0—client lint, typecheck, and 46 focused UI tests—yielding `qa_passes: true`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/test-report.md",
  "range": [5, 13],
  "contentHash": "74d8bf7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172967_06-08-26/8919_2131_command-center-craft-polish-pass/review.md",
  "range": [57, 59],
  "contentHash": "2587f70"
}
```
