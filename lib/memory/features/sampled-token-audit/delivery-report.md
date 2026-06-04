# Delivery Report — sampled-token-audit

## Summary

The sampled-token-audit Feature adds phase-1 token observability to feature-delivery
SDK invocations. The implementation SHALL expose `runner.cursor.sdkSampling` in
`pancreator.yaml`, route roughly 10 percent of stage invocations through a
deterministic hash gate to a streamed SDK transport, persist redacted traces under
`work/<day>/<task-id>/sdk-traces/`, emit `gen_ai.usage` and `pancreator.sampling`
fields in `run.log.jsonl`, and provide `pnpm -w exec pan token-economy sample-audit`
for watermark-based incremental scans with production heuristics and bounded
`--repair`. The shared stream collector lives in `@pancreator/runner-cursor` and
the prototype harness re-exports it. Review and QA gates pass with zero `must fix`
findings; 311 offline tests pass across package, compliance, and repository suites.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/implementation-report.md",
  "range": [9, 20],
  "contentHash": "c397ed4"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [9, 16],
  "contentHash": "c9b1631"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/test-report.md",
  "range": [9, 11],
  "contentHash": "ee9969d"
}
```

## Architecture

- The project SHALL add `runner.cursor.sdkSampling` with default `enabled: true`,
  `ratePercent: 10`, and `scope: feature-delivery`; `readSdkSamplingConfig` SHALL
  honor `PAN_SDK_SAMPLING_FORCE_ON` and `PAN_SDK_SAMPLING_FORCE_OFF` overrides.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/adr-draft.md",
  "range": [60, 63],
  "contentHash": "c07e608"
}
```

- `invokeFeatureDeliveryEnteringStage` SHALL evaluate a stable hash over
  `{taskId, stageId, persona, model, invocationIndex}`; unsampled invocations SHALL
  keep the existing `Agent.prompt` fast path.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/plan.md",
  "range": [30, 34],
  "contentHash": "c4c0cc3"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/adr-draft.md",
  "range": [65, 68],
  "contentHash": "c07e608"
}
```

- Stream handling SHALL live in a shared `@pancreator/runner-cursor` module
  extracted from `collect-usage.mjs`; sampled runs SHALL persist NDJSON traces and
  summaries under `work/<day>/<task-id>/sdk-traces/`.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/plan.md",
  "range": [36, 49],
  "contentHash": "c4c0cc3"
}
```

- The CLI SHALL add `pan token-economy sample-audit` with watermark scans, rolling
  baselines under `.pan/token-economy/`, production heuristics, and optional
  `--repair` that defers high-complexity findings to `pan intake new`.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/adr-draft.md",
  "range": [76, 80],
  "contentHash": "c07e608"
}
```

- Phase 1 SHALL NOT expand the prototype matrix, SHALL NOT add Phoenix export, and
  SHALL NOT sample non-feature-delivery invocations except via documented hooks.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/adr-draft.md",
  "range": [82, 84],
  "contentHash": "c07e608"
}
```

## Interfaces

- `shouldSampleSdkInvocation` and `sampleRateForKeys` SHALL implement the
  deterministic SHA-256 bucket gate for feature-delivery scope.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/sdk-sampling.ts",
  "range": [15, 61],
  "contentHash": "49fc2bc"
}
```

- `readSdkSamplingConfig` SHALL parse `runner.cursor.sdkSampling` from
  `pancreator.yaml` and apply force-on or force-off environment overrides.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/pan-init.ts",
  "range": [607, 627],
  "contentHash": "ea06c86"
}
```

- `processStreamEvent`, `createTraceSink`, and `assertUsageCaptured` SHALL provide
  shared stream capture in `@pancreator/runner-cursor`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/sdk-trace-collector.ts",
  "range": [1, 80],
  "contentHash": "aa03639"
}
```

- `createStreamedCursorSdkTransport` SHALL feed SDK stream events through the
  collector and write trace artifacts for sampled invocations.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts",
  "range": [157, 200],
  "contentHash": "6ea39c1"
}
```

- `runTokenEconomySampleAudit`, `runBoundedRepair`, and `createDeferredInboxItem`
  SHALL implement incremental audit, repair grouping, and high-scope inbox deferral.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/commands/token-economy-sample-audit.ts",
  "range": [18, 36],
  "contentHash": "3153a4a"
}
```

- `classifyProductionFindings`, `groupFindingsByComplexity`, and rolling baseline
  helpers SHALL adapt prototype analyzer patterns for production summaries.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/token-economy-analyzer.ts",
  "range": [163, 220],
  "contentHash": "21d898a"
}
```

- `runLogRecordFromRunnerEnvelope` SHALL emit `gen_ai.usage` and
  `pancreator.sampling` when the runner captures usage on sampled invocations.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts",
  "range": [186, 228],
  "contentHash": "b5f70be"
}
```

## Tradeoffs

- Sampled invocations incur higher latency and disk use than the fast path; the hash
  gate limits exposure to roughly 10 percent by default.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/adr-draft.md",
  "range": [102, 103],
  "contentHash": "c07e608"
}
```

- `--repair` records `auto-fix:*` markers and defers live repair-agent wiring to
  operator dogfood; offline tests satisfy defer-and-apply acceptance.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [27, 27],
  "contentHash": "c9b1631"
}
```

- Companion harness edits to `paths.mjs` and `tasks.mjs` sit outside declared
  `allowed_paths`; operators MAY amend the touch-set via tech-lead if alignment is
  required before ship.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [26, 26],
  "contentHash": "c9b1631"
}
```

- Compliance harness imports `@pancreator/runner-cursor` dist; operators MUST build
  runner-cursor before `node --test` on context-usage unit tests.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [28, 28],
  "contentHash": "c9b1631"
}
```

- `pancreator-model-escalation.yaml` sets `active_config: auto` for SDK dogfood;
  operators SHALL revert to `default` when dogfood sampling is complete.

```json
{
  "kind": "lines",
  "path": "pancreator-model-escalation.yaml",
  "range": [15, 18],
  "contentHash": "e27d109"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [32, 32],
  "contentHash": "c9b1631"
}
```

## Usage guidelines

- Run incremental token-economy audit after feature-delivery runs produce
  `sdk-traces/*.summary.json` artifacts; the command advances
  `.pan/token-economy/last-audit.json` after each report.

```bash
cd /Users/alen/Dev/daedaline
pnpm -w exec pan token-economy sample-audit
pnpm -w exec pan token-economy sample-audit --since 2026-06-04T00:00:00.000Z
pnpm -w exec pan token-economy sample-audit --sampled-only-task 53589_0906_sampled-token-audit
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/implementation-report.md",
  "range": [17, 17],
  "contentHash": "c397ed4"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/commands/token-economy-sample-audit.test.ts",
  "range": [30, 67],
  "contentHash": "170f811"
}
```

- Apply bounded repair for low- and medium-complexity findings; high-scope items
  defer to an inbox slug under `lib/inbox/in/`.

```bash
pnpm -w exec pan token-economy sample-audit --repair
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/commands/token-economy-sample-audit.test.ts",
  "range": [69, 97],
  "contentHash": "170f811"
}
```

- Keep SDK sampling off in unit and CI harness runs via `PAN_SDK_SAMPLING_FORCE_OFF`;
  dogfood operators MAY set `PAN_SDK_SAMPLING_FORCE_ON` to exercise the streamed path.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/implementation-report.md",
  "range": [54, 54],
  "contentHash": "c397ed4"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/sdk-sampling.test.ts",
  "range": [38, 62],
  "contentHash": "931e48d"
}
```

- Build `@pancreator/runner-cursor` before compliance context-usage tests that import
  the shared collector from dist.

```bash
pnpm --filter @pancreator/runner-cursor build
node --test tests/compliance/context-usage/context-usage.unit.test.mjs
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/implementation-report.md",
  "range": [71, 72],
  "contentHash": "c397ed4"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/test-report.md",
  "range": [20, 20],
  "contentHash": "ee9969d"
}
```

## Testing

Coverage adds nine production modules plus four extended compliance helpers. Each new
exported symbol carries offline tests: 25 runner-cursor tests, 119 CLI tests, 23
context-usage unit tests, and 144 repository tests pass for a total of 311 offline
tests. Touch-set gate commands exit 0 including scaffold, context-budget, and hook
syntax checks. Live repair-agent invocation and matrix re-calibration remain
operator-on-demand; QA validates committed behavior via offline suites only.

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/test-report.md",
  "range": [9, 44],
  "contentHash": "ee9969d"
}
```

```json
{
  "kind": "lines",
  "path": "work/172971_06-04-26/53589_0906_sampled-token-audit/review.md",
  "range": [46, 80],
  "contentHash": "c9b1631"
}
```
