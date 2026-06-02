# Delivery Report — context-usage-test-harness

## Summary

The context-usage-test-harness Feature ships a manual-only runtime probe under
`tests/context-usage/` that copies a synthetic eight-tier sandbox fixture, runs a
frozen five-read agent task through `@cursor/sdk@1.0.13`, verifies Layer A routing
policy via imported `classifyExclusiveTier()`, aggregates eight token metrics from
`turn-ended` events, and gates live runs against a committed baseline with 3-sigma
thresholds. CI executes only `pnpm run context:usage:test` (12 unit tests); live
entry points require both `CURSOR_CONTEXT_USAGE=1` and `CURSOR_API_KEY`. Review
and QA gates pass with zero `must fix` findings on 2026-06-02.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/implementation-report.md",
  "range": [12, 16],
  "contentHash": "b8cece4"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/review.md",
  "range": [3, 5],
  "contentHash": "cd8ba0f"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/test-report.md",
  "range": [3, 5],
  "contentHash": "e01caf2"
}
```

## Architecture

- The harness copies `fixtures/tier-sandbox/` to a temp directory and invokes
  `@cursor/sdk` with `local.cwd` set to that copy, keeping live reads off the
  production daedaline tree.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [54, 56],
  "contentHash": "ee97627"
}
```

- Layer A verification compares structured answers and observed read paths against
  `expected.mjs`, fails on forbidden paths (including full `docs/PRD.md`), and
  classifies paths with production `classifyExclusiveTier()` imported from
  `context-budget-report.mjs`.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [61, 64],
  "contentHash": "ee97627"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/plan.md",
  "range": [71, 79],
  "contentHash": "1f986ab"
}
```

- Layer B metrics aggregate eight fields from `turn-ended` events and fail loudly
  when `usage` is absent rather than recording zeros.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [66, 68],
  "contentHash": "ee97627"
}
```

- Pure logic runs in `context-usage.unit.test.mjs` via dedicated
  `context:usage:test`; live scripts require both env vars and MUST NOT enter root
  `pnpm test` or CI.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/plan.md",
  "range": [28, 35],
  "contentHash": "1f986ab"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [58, 59],
  "contentHash": "ee97627"
}
```

- Baseline establishment writes `baselines/composer-2.5.json` from five samples with
  `fixture_hash`, `prompt_version`, and per-metric `mean` / `sd`; `stats.mjs`
  applies 3-sigma thresholds with documented degenerate-sigma guardrails.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [70, 74],
  "contentHash": "ee97627"
}
```

## Interfaces

- `resolveSdkModelId`, `HARNESS_MODEL` — model-id stripping and fixed harness model.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/model.mjs",
  "range": [9, 16],
  "contentHash": "29ef986"
}
```

- `PROMPT_VERSION`, `EXPECTED_ANSWERS`, `FORBIDDEN_PATH_PATTERNS`,
  `REQUIRED_READ_PATTERNS`, `REQUIRED_READ_TIERS`, `REPORT_REL_PATH`,
  `READ_TOOL_NAMES`, `normalizePath`, `isForbiddenPath`, `findForbiddenPaths`,
  `findMissingRequiredReads`, `promptMentionsForbiddenPrd` — frozen task anchors
  and Layer A expectations.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/expected.mjs",
  "range": [3, 93],
  "contentHash": "636cdbc"
}
```

- `FIXTURE_ROOT`, `copySandboxToTemp` — fixture copy to temp sandbox.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/copy-sandbox.mjs",
  "range": [7, 47],
  "contentHash": "81da1dc"
}
```

- `TurnEndedUsageMissingError`, `createEmptyMetrics`, `normalizeUsageFields`,
  `addUsageToMetrics`, `extractReadPathsFromToolEvent`, `processStreamEvent`,
  `collectFromStream`, `collectFromRun` — eight-metric stream aggregation.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/collect-usage.mjs",
  "range": [14, 171],
  "contentHash": "9f18bde"
}
```

- `verifyAnswers`, `verifyForbiddenPaths`, `verifyRequiredReads`,
  `verifyRequiredReadTiers`, `verifyRun`, `readReportFromSandbox`,
  `verifySandboxRun` — Layer A verification orchestration.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/verify-run.mjs",
  "range": [26, 133],
  "contentHash": "7adf468"
}
```

- `METRIC_KEYS`, `DEGENERATE_GUARDRAILS`, `computeFixtureHash`,
  `readPromptVersion`, `exceedsThreshold`, `compareToBaseline`,
  `buildBaselineFromSamples` — baseline metadata guards and 3-sigma gating.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/stats.mjs",
  "range": [10, 136],
  "contentHash": "610abda"
}
```

- `requireLiveEnv` — live-run env gate (`CURSOR_CONTEXT_USAGE=1` and
  `CURSOR_API_KEY`).

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/live-env.mjs",
  "range": [15, 15],
  "contentHash": "172c5a3"
}
```

- `resolveCursorRipgrepBinaryPath`, `ensureCursorSdkRipgrepConfigured` — SDK
  ripgrep resolution before `Agent.prompt`.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/ripgrep.mjs",
  "range": [49, 85],
  "contentHash": "9833c8d"
}
```

- `runContextUsageOnce` — single live probe orchestration entry.

```json
{
  "kind": "lines",
  "path": "tests/context-usage/lib/run-once.mjs",
  "range": [19, 19],
  "contentHash": "5d53f0f"
}
```

- Root scripts `context:usage`, `context:usage:baseline`, `context:usage:test`
  and `@cursor/sdk@1.0.13` devDependency.

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [17, 19],
  "contentHash": "a488976"
}
```

```json
{
  "kind": "lines",
  "path": "package.json",
  "range": [37, 37],
  "contentHash": "a488976"
}
```

## Tradeoffs

- Live baseline calibration is deferred: `composer-2.5.json` is absent (`.gitkeep`
  only), so sigma comparison skips until the operator ratifies a baseline after
  API spend.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/review.md",
  "range": [19, 19],
  "contentHash": "cd8ba0f"
}
```

- SDK token totals complement but do not match the handbook ~770K IDE cache-read
  baseline one-to-one; README keeps that distinction explicit.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [94, 95],
  "contentHash": "ee97627"
}
```

- Wiring `sdk-transport.ts` usage capture for `pan run` remains out of scope;
  CI safety relies on unit tests and manual gating.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/adr-draft.md",
  "range": [76, 78],
  "contentHash": "ee97627"
}
```

- `compareToBaseline` compares `prompt_version` via the `PROMPT_VERSION` constant
  instead of `readPromptVersion`; symmetry drift is a known follow-up.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/review.md",
  "range": [15, 15],
  "contentHash": "cd8ba0f"
}
```

- `run-live.mjs` exits before writing `output/` when baseline comparison fails,
  which complicates post-calibration debugging; persisting the report first is a
  documented improvement.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/review.md",
  "range": [17, 17],
  "contentHash": "cd8ba0f"
}
```

## Usage guidelines

**Example 1 — CI-safe unit suite.** Operators run the harness logic without SDK or
network calls:

```bash
pnpm run context:usage:test
```

The gate reports 12 passing tests covering model stripping, sigma pass/spike,
forbidden-path failure, missing required-read failure, and prompt regression.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/test-report.md",
  "range": [11, 11],
  "contentHash": "e01caf2"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-usage/context-usage.unit.test.mjs",
  "range": [23, 30],
  "contentHash": "c90c750"
}
```

**Example 2 — Baseline calibration (manual, costs API credits).** After exporting
both required env vars, operators establish a committed baseline from five samples:

```bash
export CURSOR_CONTEXT_USAGE=1
export CURSOR_API_KEY=<key>
pnpm run context:usage:baseline
```

Review and ratify `tests/context-usage/baselines/composer-2.5.json` before merge
gating relies on sigma comparison.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/implementation-report.md",
  "range": [91, 98],
  "contentHash": "b8cece4"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-usage/context-usage.unit.test.mjs",
  "range": [122, 147],
  "contentHash": "c90c750"
}
```

**Example 3 — Single live smoke run.** With env vars set, operators execute one
probe and inspect per-run output under `tests/context-usage/output/`:

```bash
pnpm run context:usage
```

Without env vars, `run-live.mjs` prints operator instructions and exits 0, keeping
root `pnpm test` free of live harness entry points.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/implementation-report.md",
  "range": [61, 61],
  "contentHash": "b8cece4"
}
```

```json
{
  "kind": "lines",
  "path": "tests/context-usage/context-usage.unit.test.mjs",
  "range": [150, 156],
  "contentHash": "c90c750"
}
```

## Testing

Coverage delta adds 12 new unit tests under `tests/context-usage/context-usage.unit.test.mjs`
exercising every exported harness symbol, plus three root scripts isolated from
`pnpm test`. Touch-set gate commands all pass on 2026-06-02: `context:usage:test`
(12/12), `context-budget-report.test.mjs` (9/9), scaffold and budget report tools
(exit 0), and root-test isolation check (exit 0). Full-repository `pnpm test` and
`node --test tests/*.test.mjs` failures remain pre-existing and excluded from the
QA gate per `qa-tester` Gate scope.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/15493_1941_context-usage-test-harness/test-report.md",
  "range": [7, 20],
  "contentHash": "e01caf2"
}
```
