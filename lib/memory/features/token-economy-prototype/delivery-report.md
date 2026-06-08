# Delivery Report — token-economy-prototype

## Summary

The token-economy-prototype Feature replaces the legacy context-usage harness under
`tests/compliance/context-usage/` with a 2×2 prototype matrix: `task-low` and
`task-high` crossed with `composer-2.5` and `gpt-5.5`. The harness separates
model overhead from task-variable token cost via an additive upper-bound formula,
captures NDJSON traces during calibration, and runs an offline analyzer for policy
violations and inefficiencies. Root scripts trim to four `context:usage:*` entry
points; live calibration remains operator-only. Review and QA gates pass on
2026-06-03 with zero `must fix` findings; the offline suite passes 21 of 21 tests.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [14, 20],
  "contentHash": "7658f2f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/review.md",
  "range": [16, 18],
  "contentHash": "061cda2"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/test-report.md",
  "range": [15, 15],
  "contentHash": "d5783eb"
}
```

## Architecture

- The harness SHALL keep two task fixtures, two model ids, one trace format, one
  expected-consumption formula, and one matrix runner under the canonical root.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/plan.md",
  "range": [5, 5],
  "contentHash": "5b7385c"
}
```

- Expected consumption SHALL equal model overhead upper confidence bound plus
  task-model variable upper confidence bound, with variable samples computed as
  observed total tokens minus the model overhead median.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/plan.md",
  "range": [5, 5],
  "contentHash": "5b7385c"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/adr-draft.md",
  "range": [17, 25],
  "contentHash": "e658c71"
}
```

- The analyzer SHALL consume the same trace and summary artifacts that calibration
  emits so each calibrate → analyze → batch-fix iteration produces machine-readable
  findings instead of manual transcript inspection.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/plan.md",
  "range": [5, 5],
  "contentHash": "5b7385c"
}
```

- Legacy fd-trace, tier-sandbox, session-suite, live-envelope, and hand-ratified
  budget paths are removed; only the four-combination prototype matrix remains.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [14, 18],
  "contentHash": "7658f2f"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/adr-draft.md",
  "range": [9, 11],
  "contentHash": "e658c71"
}
```

## Interfaces

- `TASK_IDS`, `PROTOTYPE_MODELS`, `getTaskSpec`, `buildTaskPrompt`, `comboKey` —
  prototype task contract and 4-combination matrix surface.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/tasks.mjs",
  "range": [8, 9],
  "contentHash": "831b865"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/tasks.mjs",
  "range": [98, 111],
  "contentHash": "831b865"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/tasks.mjs",
  "range": [179, 179],
  "contentHash": "831b865"
}
```

- `computeVariableSamples`, `buildExpectedBaseline`, `expectedUpperBound` —
  overhead-plus-variable expected consumption math.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/expected.mjs",
  "range": [7, 52],
  "contentHash": "bdd6d24"
}
```

- `createEmptyMetrics`, `processStreamEvent`, `createTraceSink` — stream metrics
  aggregation and NDJSON trace capture during calibration runs.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/collect-usage.mjs",
  "range": [47, 94],
  "contentHash": "267e609"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/collect-usage.mjs",
  "range": [195, 195],
  "contentHash": "267e609"
}
```

- `classifyPolicyViolations`, `classifyInefficiencies`, `analyzeTraceSummary`,
  `writeFindings` — trace analyzer for forbidden reads, allowlist breaches, decoy
  reads, and excess turns.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/analyzer.mjs",
  "range": [30, 30],
  "contentHash": "0466b0f"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/analyzer.mjs",
  "range": [133, 133],
  "contentHash": "0466b0f"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/analyzer.mjs",
  "range": [180, 206],
  "contentHash": "0466b0f"
}
```

- `resolveSdkModelId`, `parseModelArg`, `assertPrototypeModel`,
  `resolveOverheadBaselinePath` — model-id normalization and per-model baseline paths.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/model.mjs",
  "range": [13, 56],
  "contentHash": "99330b1"
}
```

- `normalizePath`, `findForbiddenPaths`, `findMissingRequiredReads` — path
  normalization and task-contract path checks.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/paths.mjs",
  "range": [17, 53],
  "contentHash": "f74e659"
}
```

- `copyTaskFixtureToTemp` — copies committed fixture roots to temp sandboxes for
  live runs.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/copy-sandbox.mjs",
  "range": [48, 48],
  "contentHash": "763f512"
}
```

- Root scripts `context:usage:test`, `context:usage:calibrate`, `context:usage:expected`,
  and `context:usage:analyze`.

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [17, 20],
  "contentHash": "22317d8"
}
```

## Tradeoffs

- Committed overhead and expected baselines use offline placeholder statistics until
  the operator runs live calibration and refreshes medians from API spend.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [102, 103],
  "contentHash": "7658f2f"
}
```

- Live calibration and matrix runs remain operator-only and SHALL NOT enter CI, so
  offline tests cover math, parsing, and analyzer behavior without an API key.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/adr-draft.md",
  "range": [35, 35],
  "contentHash": "e658c71"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [73, 73],
  "contentHash": "7658f2f"
}
```

- Historical baselines and runner names lose compatibility; operators MUST use the
  four trimmed `context:usage:*` scripts instead of legacy fd-trace or tier-sandbox
  entry points.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/adr-draft.md",
  "range": [34, 34],
  "contentHash": "e658c71"
}
```

- The matrix runner default of two overhead probes per model costs four extra noop
  calls versus the spec's approximate 34-call budget; lowering `--overhead-runs` to
  1 is a documented follow-up.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/review.md",
  "range": [31, 38],
  "contentHash": "061cda2"
}
```

- The live-envelope and hand-ratified expected-consumption gate is rejected in favor
  of the additive overhead-plus-variable formula.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/adr-draft.md",
  "range": [25, 25],
  "contentHash": "e658c71"
}
```

## Usage guidelines

**Example 1 — CI-safe offline suite.** Operators run harness logic without SDK or
network calls:

```bash
pnpm run context:usage:test
```

The gate reports 21 passing tests covering expected math, analyzer violations,
analyzer inefficiencies, and task-contract parsing.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/test-report.md",
  "range": [21, 21],
  "contentHash": "d5783eb"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/context-usage.unit.test.mjs",
  "range": [88, 91],
  "contentHash": "344eea0"
}
```

**Example 2 — Live matrix calibration (manual, costs API credits).** After exporting
required env vars, operators run the full prototype matrix:

```bash
export CURSOR_CONTEXT_USAGE=1
export CURSOR_API_KEY=<key>
pnpm run context:usage:calibrate
pnpm run context:usage:expected
pnpm run context:usage:analyze
```

Default matrix run executes 2 overhead probes plus 8 samples for each of the four
combinations (~34 API calls). Operators MAY lower cost with `--runs 3`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [86, 94],
  "contentHash": "7658f2f"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/README.md",
  "range": [44, 58],
  "contentHash": "eb01f8d"
}
```

**Example 3 — Task contract and fixture copy.** Unit tests verify both task specs,
prompt builders, and temp fixture copies for `task-low` and `task-high`:

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/context-usage.unit.test.mjs",
  "range": [69, 86],
  "contentHash": "344eea0"
}
```

`task-high` requires a runtime artifact at `.pan/work/99999_probe/task/answer.md` in the
temp sandbox, not in the committed fixture tree.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/implementation-report.md",
  "range": [104, 105],
  "contentHash": "7658f2f"
}
```

## Testing

Coverage delta replaces the prior tier-sandbox and fd-trace harness with 21 new
offline tests under `tests/compliance/context-usage/` exercising expected math,
analyzer policy-violation detection, analyzer inefficiency detection, and
task-contract parsing. Touch-set gate commands all pass on 2026-06-03:
`pnpm run context:usage:test` (21 of 21), scaffold and budget report tools (exit 0),
and policy-compliance hook syntax check (exit 0). The sole remaining failure in
`node --test tests/*.test.mjs` is the pre-existing `pan-init` embedded-install
conflict and is excluded from the QA gate.

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/test-report.md",
  "range": [15, 25],
  "contentHash": "d5783eb"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172972_06-03-26/18834_1846_token-economy-prototype/review.md",
  "range": [69, 76],
  "contentHash": "061cda2"
}
```
