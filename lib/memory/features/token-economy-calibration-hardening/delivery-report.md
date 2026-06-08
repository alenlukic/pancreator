# Delivery Report — token-economy-calibration-hardening

## Summary

The token-economy-calibration-hardening Feature hardens the shipped prototype
calibration harness under `tests/compliance/context-usage/` without expanding the
2×2 matrix or harness root. The pass tightens `task-high` prompts and allowlists,
normalizes temp-sandbox paths in analyzer findings, raises default overhead sampling
to 8 runs per model, compares each matrix run against committed expected upper bounds
with warn-only default and optional `--fail-on-exceedance`, and re-establishes
overhead and expected baselines from live calibration on 2026-06-04 with
`policy_violation_count: 0` across all four combos. Review and QA gates pass with
zero `must fix` findings; the offline suite passes 28 of 28 tests and repository
compliance passes 144 of 144.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/implementation-report.md",
  "range": [9, 55],
  "contentHash": "7e6faf4"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/review.md",
  "range": [9, 14],
  "contentHash": "cbae4b9"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/test-report.md",
  "range": [9, 11],
  "contentHash": "87b487b"
}
```

## Architecture

- The `task-high` contract SHALL add `lib/memory/features/token-economy-probe/spec.md`
  to the read allowlist and required reads; the prompt SHALL forbid discovery tools
  and duplicate reads of named paths.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/plan.md",
  "range": [16, 20],
  "contentHash": "351b6df"
}
```

- Analyzer classification SHALL strip temporary sandbox prefixes from trace paths
  before findings serialize, while duplicate-read detection SHALL use raw trace
  read order.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/plan.md",
  "range": [20, 20],
  "contentHash": "351b6df"
}
```

- Default `--overhead-runs` SHALL change to 8; committed overhead and expected
  baselines SHALL refresh from `calibration/raw/matrix-samples.json` via
  `establishExpectedFromRaw`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/plan.md",
  "range": [22, 36],
  "contentHash": "351b6df"
}
```

- The matrix runner SHALL compare each successful run's observed `total_tokens`
  against the committed expected baseline for the same `{task, model}`; default
  behavior SHALL warn only, and `--fail-on-exceedance` SHALL exit non-zero after
  findings and raw samples are written.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/adr-draft.md",
  "range": [29, 30],
  "contentHash": "ccf54af"
}
```

- The canonical 2×2 prototype matrix and harness root SHALL remain unchanged.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/adr-draft.md",
  "range": [24, 24],
  "contentHash": "ccf54af"
}
```

## Interfaces

- `stripTempSandboxPrefix(relPath)` SHALL return fixture-relative paths by stripping
  `context-usage-task-{low|high}-*` sandbox prefixes.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/paths.mjs",
  "range": [26, 33],
  "contentHash": "f74e659"
}
```

- `compareObservedToExpectedUpper(input)` SHALL return a structured pass or
  exceedance result comparing `observedTotal` to
  `expectedBaseline.expected_total_tokens.upper_confidence_bound`.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/expected.mjs",
  "range": [64, 76],
  "contentHash": "bdd6d24"
}
```

- `selectLatestSummariesByRunIndex(entries)` SHALL keep the lexicographically newest
  trace summary per `run_index` when multiple generations exist for the same run.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/analyzer.mjs",
  "range": [194, 207],
  "contentHash": "0466b0f"
}
```

- `buildTaskPrompt("task-high")` SHALL include the durable spec allowlist entry and
  SHALL forbid discovery tools and duplicate required reads.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/lib/tasks.mjs",
  "range": [152, 162],
  "contentHash": "831b865"
}
```

- `parseArgs(argv)` in `calibrate-matrix.mjs` SHALL default `overheadRuns` to 8 and
  SHALL accept `--fail-on-exceedance` and `--skip-overhead`.

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/calibrate-matrix.mjs",
  "range": [35, 57],
  "contentHash": "1ee6ae6"
}
```

## Tradeoffs

- Expected-upper exceedance SHALL warn by default so operators can iterate during
  baseline re-establishment; strict non-zero exit requires `--fail-on-exceedance`.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/adr-draft.md",
  "range": [54, 57],
  "contentHash": "ccf54af"
}
```

- `selectLatestSummariesByRunIndex` is exported with offline test coverage only; the
  production consumer `analyze-calibration.mjs` remains unstaged and outside the
  touch-set for this slice.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/review.md",
  "range": [24, 24],
  "contentHash": "cbae4b9"
}
```

- README provenance uses matrix-samples `generated_at` `2026-06-04T07:04:46Z` while
  individual baseline and findings files carry earlier or later per-artifact stamps;
  operators SHALL treat README § Baseline provenance as the unified delivery note.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/review.md",
  "range": [25, 25],
  "contentHash": "cbae4b9"
}
```

- Untracked `calibration/traces/**` NDJSON and summary files remain local evidence
  only and are outside the touch-set for commit.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/implementation-report.md",
  "range": [35, 35],
  "contentHash": "7e6faf4"
}
```

- Remaining `duplicate_read` inefficiencies on required paths and optional
  `AGENTS.md` reads are documented as irreducible agent behavior rather than relaxed
  analyzer policy.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/implementation-report.md",
  "range": [40, 40],
  "contentHash": "7e6faf4"
}
```

## Usage guidelines

- Run the offline harness suite before live calibration; CI executes only this path.

```bash
pnpm run context:usage:test
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/README.md",
  "range": [37, 41],
  "contentHash": "eb01f8d"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/test-report.md",
  "range": [17, 17],
  "contentHash": "87b487b"
}
```

- Run live matrix calibration when `CURSOR_API_KEY` is set (48 API calls: 8 overhead
  × 2 models + 8 × 4 combos); re-analyze committed traces without re-running live
  calibration when trace artifacts already exist.

```bash
pnpm run context:usage:calibrate
pnpm run context:usage:analyze
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/README.md",
  "range": [43, 50],
  "contentHash": "eb01f8d"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/test-report.md",
  "range": [19, 19],
  "contentHash": "87b487b"
}
```

- Enforce strict expected-upper failure in ratification gates by passing
  `--fail-on-exceedance`; default runs emit warn-only stderr lines per combo.

```bash
node tests/compliance/context-usage/calibrate-matrix.mjs --fail-on-exceedance
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/README.md",
  "range": [58, 67],
  "contentHash": "eb01f8d"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/context-usage.unit.test.mjs",
  "range": [246, 268],
  "contentHash": "344eea0"
}
```

- Rebuild committed expected baselines from a saved raw matrix file without live API
  calls when `matrix-samples.json` already exists.

```bash
pnpm run context:usage:expected -- --raw tests/compliance/context-usage/calibration/raw/matrix-samples.json
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/README.md",
  "range": [72, 76],
  "contentHash": "eb01f8d"
}
```

```json
{
  "kind": "lines",
  "path": "tests/compliance/context-usage/context-usage.unit.test.mjs",
  "range": [317, 327],
  "contentHash": "344eea0"
}
```

## Testing

Coverage grows to 28 offline tests in `context-usage.unit.test.mjs`, with statement
and branch evidence for `buildTaskPrompt("task-high")`, `stripTempSandboxPrefix()`,
`compareObservedToExpectedUpper()`, `selectLatestSummariesByRunIndex()`, normalized
duplicate-read paths, and `establishExpectedFromRaw` against committed baselines.
All touch-set gate commands exit 0: offline suite 28 of 28, analyze with zero policy
violations across four combos, and repository tests 144 of 144. Live matrix
re-calibration remains operator-on-demand; QA validates committed baselines via analyze
rather than re-running calibrate in this slice.

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/test-report.md",
  "range": [9, 44],
  "contentHash": "87b487b"
}
```

```json
{
  "kind": "lines",
  "path": ".pan/work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/review.md",
  "range": [64, 79],
  "contentHash": "cbae4b9"
}
```
