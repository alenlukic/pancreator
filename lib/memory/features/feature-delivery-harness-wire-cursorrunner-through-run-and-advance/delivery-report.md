# Delivery Report — feature-delivery harness CursorRunner wiring

## Summary

This delivery wires `feature-delivery` to an opt-in Cursor SDK path shared by `run` and `advance`, while manual mode remains the default operator flow. It also resolves real personas, loads repo-root `.env`, executes SDK-backed stage work through a compiled one-stage slice, and records SDK outcomes in the run log without opening the report gate or shipping past the human decision point.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md",
  "range": [97, 103],
  "contentHash": "b0ff0a3"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [12, 24],
  "contentHash": "a96eccf"
}
```

## Architecture

- The CLI preserves manual delegation as the default and routes SDK execution through the same feature-delivery contract on both `run` and `advance`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/plan.md",
  "range": [1, 15],
  "contentHash": "a96eccf"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [250, 343],
  "contentHash": "7c5e4d7"
}
```

- SDK-backed stage work runs through a compiled one-stage slice, so the intervention graph stays in use without advancing unrelated stages.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/plan.md",
  "range": [12, 25],
  "contentHash": "a96eccf"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/execute.ts",
  "range": [69, 95],
  "contentHash": "d86f5e2"
}
```

- The runtime keeps a bounded automatic loopback regime, adds retry-limit halt and report-approval outbox artifacts, and pauses after `report` for a human decision.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/adr-draft.md",
  "range": [15, 38],
  "contentHash": "3574b43"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-runner.ts",
  "range": [412, 547],
  "contentHash": "87b4929"
}
```

## Interfaces

- `parseAndRun` now forwards feature-delivery commands into the shared orchestration path, and `startFeatureDelivery` plus `advanceFeatureDelivery` own the run and advance transitions that the report stage depends on.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.ts",
  "range": [251, 423],
  "contentHash": "7c5e4d7"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [250, 562],
  "contentHash": "7c5e4d7"
}
```

- `loadRepoEnv` and `configureCursorSdkTransportPrereqs` provide the repo-root `.env` load and the Cursor SDK prereq handoff before any live SDK runner starts.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/repo-env.ts",
  "range": [1, 46],
  "contentHash": "87b4929"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-runner.ts",
  "range": [131, 145],
  "contentHash": "87b4929"
}
```

- `resolveCursorRipgrepBinaryPath`, `ensureCursorSdkRipgrepConfigured`, and `createDefaultCursorSdkTransport` make the local Cursor SDK transport self-sufficient when bundled `rg` is available.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-sdk-prereqs.ts",
  "range": [53, 110],
  "contentHash": "87b4929"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/sdk-transport.ts",
  "range": [40, 87],
  "contentHash": "87b4929"
}
```

- `executeStageSlice` and `slicePipelineDefinitionForStage` bound compiled pipeline execution to one stage, and the pipeline tests exercise that slice boundary directly.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/execute.ts",
  "range": [5, 95],
  "contentHash": "d86f5e2"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/pipeline.test.ts",
  "range": [10, 50],
  "contentHash": "d86f5e2"
}
```

## Tradeoffs

- Manual mode stays inert, so operators who do not opt in still get the existing paste-based flow instead of implicit SDK execution.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/adr-draft.md",
  "range": [17, 24],
  "contentHash": "3574b43"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/review.md",
  "range": [16, 20],
  "contentHash": "6cdeefa"
}
```

- The runner resolves and configures the bundled `rg` path before importing `@cursor/sdk`, because the SDK local runtime fails early without that prerequisite.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/implementation-report.md",
  "range": [8, 24],
  "contentHash": "90832d5"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-sdk-prereqs.ts",
  "range": [53, 110],
  "contentHash": "87b4929"
}
```

- The implementation accepts broader regression coverage instead of a thin happy-path proof, so it can keep retry halts, review/test loopbacks, and persona-resolution failures stable.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/review.md",
  "range": [33, 35],
  "contentHash": "6cdeefa"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [12, 24],
  "contentHash": "a96eccf"
}
```

## Usage Guidelines

- To start an SDK-backed run, set `runner.cursor.invocation: sdk`, run `pan run feature-delivery`, and expect one runner invocation plus `state.json` and `run.log.jsonl` output.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [1319, 1365],
  "contentHash": "7c5e4d7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [14, 24],
  "contentHash": "a96eccf"
}
```

- To keep manual mode quiet, leave invocation at `manual`; `run` and `advance` should skip SDK transport across the full path.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [1367, 1399],
  "contentHash": "7c5e4d7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [16, 24],
  "contentHash": "a96eccf"
}
```

- To bound the pipeline to one entering stage, call `executeStageSlice`; the helper should visit only the requested stage and ignore a mismatched compiled entry node.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/pipeline.test.ts",
  "range": [10, 50],
  "contentHash": "d86f5e2"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/implementation-report.md",
  "range": [12, 24],
  "contentHash": "90832d5"
}
```

- To exercise the auto-chain behavior, keep `review.md` at `review_passes: true` after a `must_fix` re-entry and let `advance` chain `implement` to `test` in one step.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [410, 482],
  "contentHash": "7c5e4d7"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [20, 24],
  "contentHash": "a96eccf"
}
```

## Testing

The coverage delta adds SDK `run` and `advance`, manual no-SDK, persona-resolution failure, `.env` loading, review/test auto-chain, retry-limit halt, and pipeline stage-slice coverage. The targeted package tests passed, the parent validation suite stayed green, and the remaining evidence shows the new loopback paths exercised end to end.

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [12, 24],
  "contentHash": "a96eccf"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/test-report.md",
  "range": [32, 47],
  "contentHash": "a96eccf"
}
```
