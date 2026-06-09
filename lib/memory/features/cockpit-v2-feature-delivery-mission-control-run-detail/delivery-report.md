# Delivery Report — Cockpit v2 FD Mission Control run detail

## Summary

This feature delivery ships FD Mission Control at `/mission-control` as a single-run inspection surface inside the Cockpit shell. The module polls `GET /api/run-state` every 7500 ms, honors `?task=` deep links, and stacks a run context header, retry-limit banner, nine-stage rail with mission-control chrome, stage detail panel, artifacts-by-stage accordion, and calm-default verbose log drawer. A re-entry pass after `qa_fails` humanizes operator-facing copy: the header shows `featureDisplayLabel` with task id behind technical details; rail cells suppress gate prose when `showMissionControlChrome` is true; stage detail and P10 modal titles map internal runner identifiers through shared display helpers. Review passed with `review_passes: true`, test passed with `qa_passes: true` and `design_qa_passes: true`, and 163 client tests pass including 20 focused mission-control tests.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/implementation-report.md",
  "range": [8, 27],
  "contentHash": "093bfd2"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/review.md",
  "range": [3, 5],
  "contentHash": "0075d23"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [3, 5],
  "contentHash": "eb318d1"
}
```

## Architecture

- FD Mission Control SHALL compose a single-run inspection surface at route `/mission-control` inside the Cockpit shell, fetch task envelopes from `GET /api/run-state`, poll every 7500 ms for non-terminal runs, and render header, banner, rail, detail panel, artifacts accordion, and verbose log drawer in vertical stack order.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/plan.md",
  "range": [3, 5],
  "contentHash": "3fe53ec"
}
```

- `StageMachineGrid` and `RunEventTimeline` SHALL live under `client/src/components/cockpit/mission-control/` as canonical implementations; the Pipeline module SHALL consume thin re-exports so P9 regression behavior stays unchanged.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/plan.md",
  "range": [5, 5],
  "contentHash": "3fe53ec"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [43, 45],
  "contentHash": "cb56fb7"
}
```

- Mission-control chrome (retry badges, current-stage accent, gate-prose suppression) SHALL render only when `showMissionControlChrome` is true on the stage rail; the Pipeline multi-run grid SHALL keep default P9 chrome.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/plan.md",
  "range": [5, 5],
  "contentHash": "3fe53ec"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [45, 45],
  "contentHash": "cb56fb7"
}
```

- Mission Control SHALL consume read-only `GET /api/run-state` envelopes and existing `run-state-shared.ts` helpers; remediation CTAs SHALL stub with operator-visible toasts until `cockpit-v2-quick-fix` lands.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [47, 49],
  "contentHash": "cb56fb7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [49, 49],
  "contentHash": "cb56fb7"
}
```

## Interfaces

- `MissionControlModule` orchestrates fetch, 7500 ms polling, task selection, toast dispatch, and P10 file modal state for the mission-control route.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/MissionControlModule.tsx",
  "range": [27, 29],
  "contentHash": "b718701"
}
```

- `RunContextHeader` renders a humanized feature title via `featureDisplayLabel`, a status pill, live indicator, and a closed technical-details disclosure with copy-task-id control.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/RunContextHeader.tsx",
  "range": [32, 44],
  "contentHash": "8499080"
}
```

- `MissionControlStageRail` renders nine FD stages in canonical order with `showMissionControlChrome={true}` on each `StageCellCard`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/MissionControlStageRail.tsx",
  "range": [5, 17],
  "contentHash": "b4ced7d"
}
```

- `StageCellCard` and `StageMachineGrid` share stage cell rendering; mission-control chrome gates retry badges and suppresses gate prose, human attention, and command hints when `showMissionControlChrome` is true.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/StageMachineGrid.tsx",
  "range": [16, 16],
  "contentHash": "25e3b7e"
}
```

- `StageDetailPanel` exposes persona, status pill, relative times, Critical chip on failed stages, operator-facing event summaries via `operatorFacingEventText`, 280-character truncation with expand, and copy-to-clipboard confirmation.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/StageDetailPanel.tsx",
  "range": [45, 63],
  "contentHash": "b33b54b"
}
```

- `artifactDisplayLabel` maps artifact basenames including `design-qa-report.md` to operator labels; `ArtifactsByStage` groups contract paths per FD stage and marks missing required artifacts as Blocking.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/ArtifactsByStage.tsx",
  "range": [25, 38],
  "contentHash": "698c004"
}
```

- `RetryLimitBanner` surfaces retry-limit summary from `detectRetryLimitFailure` and five remediation buttons routed through `showNotImplementedToast`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/RetryLimitBanner.tsx",
  "range": [4, 12],
  "contentHash": "9a342b1"
}
```

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/remediation.ts",
  "range": [1, 10],
  "contentHash": "ddc31a8"
}
```

- `VerboseLogDrawer` stays closed on first render, opens via **Open run logs**, and embeds `RunEventTimeline` with severity chips and event-type filter.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/VerboseLogDrawer.tsx",
  "range": [7, 7],
  "contentHash": "39f7bd1"
}
```

- `FileModalOverlay` in `dashboard-file-modal.tsx` renders `artifactDisplayLabel(modal.path)` as the modal title and places the repo path in a closed disclosure.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/dashboard-file-modal.tsx",
  "range": [215, 215],
  "contentHash": "07c421d"
}
```

- Shared helpers `detectRetryLimitFailure`, `countStageRetryTransitions`, and `runEventDisplayLabel` in `run-state-shared.ts` power banner, retry badges, and operator-facing event summaries.

```json
{
  "kind": "lines",
  "path": "client/src/services/run-state-shared.ts",
  "range": [1, 30],
  "contentHash": "398f3e9"
}
```

- `stageArtifactPathsForStage` in `stage-artifact-contract.ts` mirrors required-after-stage paths for browser-safe artifact grouping.

```json
{
  "kind": "lines",
  "path": "client/src/services/stage-artifact-contract.ts",
  "range": [6, 29],
  "contentHash": "ab387fa"
}
```

## Tradeoffs

- Remediation CTAs remain stub toasts until `cockpit-v2-quick-fix` lands; operators see action names but no mutating run-control handlers yet.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/implementation-report.md",
  "range": [115, 116],
  "contentHash": "093bfd2"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [77, 78],
  "contentHash": "cb56fb7"
}
```

- The verbose log drawer event-type select still exposes internal dot-separated event slugs; human label mapping is deferred to a polish pass.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/review.md",
  "range": [46, 46],
  "contentHash": "0075d23"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/implementation-report.md",
  "range": [117, 117],
  "contentHash": "093bfd2"
}
```

- The canonical nine-stage `FD_STAGE_ORDER` constant is duplicated across rail, artifacts accordion, and tests; a shared export would reduce order drift when stages change.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/review.md",
  "range": [15, 15],
  "contentHash": "0075d23"
}
```

- Pipeline module retains a dependency on mission-control paths; import direction inverts the historical P9 layout in exchange for one canonical grid and timeline implementation.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [77, 77],
  "contentHash": "cb56fb7"
}
```

- Mutating run-control APIs for retry, cancel, or config rewrite were rejected at this boundary; Mission Control stays read-only against `GET /api/run-state`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/adr-draft.md",
  "range": [47, 47],
  "contentHash": "cb56fb7"
}
```

## Usage guidelines

- To inspect a single FD run with humanized context, mount `MissionControlModule` with a task envelope and assert the header `h1` shows the feature label while raw `taskId` stays hidden until **Show technical details** opens.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/mission-control.test.tsx",
  "range": [167, 183],
  "contentHash": "23af121"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [31, 31],
  "contentHash": "eb318d1"
}
```

- To deep-link a specific task, navigate to `/mission-control?task=<taskId>` and assert the humanized header matches the pre-selected envelope task.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/mission-control.test.tsx",
  "range": [375, 375],
  "contentHash": "23af121"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [37, 37],
  "contentHash": "eb318d1"
}
```

- To verify mission-control rail chrome isolation, render `StageCellCard` with `showMissionControlChrome={true}` and assert no `Gate:` prose or stage command hints appear in the cell output.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/mission-control.test.tsx",
  "range": [201, 201],
  "contentHash": "23af121"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [32, 33],
  "contentHash": "eb318d1"
}
```

- To preview a stage artifact with operator-readable titles, trigger artifact preview and assert the modal `h3` renders `artifactDisplayLabel` for paths such as `design-qa-report.md`.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/mission-control.test.tsx",
  "range": [161, 161],
  "contentHash": "23af121"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [33, 35],
  "contentHash": "eb318d1"
}
```

- To observe retry-limit remediation and calm-default logs, mount `MissionControlModule` with retry-limit fixture events, assert the banner and stage retry badges render, confirm the verbose log drawer is closed on first paint, and open it via **Open run logs**.

```json
{
  "kind": "lines",
  "path": "client/src/components/cockpit/mission-control/mission-control.test.tsx",
  "range": [387, 411],
  "contentHash": "23af121"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [38, 38],
  "contentHash": "eb318d1"
}
```

## Testing

Coverage delta against the prior Cockpit v2 baseline adds 20 focused mission-control tests in `mission-control.test.tsx` and restores the full client suite to 163 passing tests after the operator-readability re-entry. All four touch-set gate commands exit zero: client lint, typecheck, focused mission-control suite (20/20), and full client suite (163/163). New-line statement coverage on changed production paths is 100 percent and branch coverage on new conditionals meets the 70 percent medium-tier `new_lines_only` threshold. Chrome DevTools re-inspection records `design_qa_passes: true` for Tier-1 mission-control surfaces. Full-repository `pnpm run build` and `node --test` failures remain pre-existing issues excluded from the gate.

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/test-report.md",
  "range": [3, 14],
  "contentHash": "eb318d1"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172966_06-09-26/50770_0953_cockpit-v2-feature-delivery-mission-control-run-detail/review.md",
  "range": [93, 99],
  "contentHash": "0075d23"
}
```
