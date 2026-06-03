# Context-usage redesign

`tests/context-usage` now uses a three-layer structure:

1. deterministic behavior-pattern tests (policy guardrails)
2. deterministic feature-delivery prompt-shape tests (real stage composition path)
3. manual live regression traces (real API spend, tiny FD skeleton)

The goal is to measure **real context-economy behavior patterns** while keeping live spend
isolated to explicit on-demand commands.

## Layer 1: Behavior-pattern tests (CI-safe)

Location:

- `tests/context-usage/lib/expected.mjs` (scenario registry)
- `tests/context-usage/lib/verify-run.mjs` (scenario verifier)
- `tests/context-usage/context-usage.unit.test.mjs`
- `tests/context-usage/fixtures/tier-sandbox/`
- `tests/context-usage/prompts/*.md`

Scenarios cover:

- summary-first routing
- bounded execution
- simple source-only behavior
- inbox/archive exclusions
- generated-artifact preference
- explicit-read override behavior

Each scenario defines:

- prompt fixture path
- required reads
- forbidden reads
- expected tier classifications
- expected answers
- unique read-target bounds

Run:

```bash
pnpm run context:usage:test
```

## Layer 2: Feature-delivery prompt-shape tests (CI-safe)

Location:

- `lib/internal/packages/@pancreator/cli/src/run.test.ts`

This layer exercises the real FD stage prompt path by driving stage transitions and inspecting
the SDK invocation payloads that come from `renderNextPrompt`/`renderHandoff`/stage contracts.
It then composes final SDK prompts with `buildSdkPrompt` and validates representative stage
shapes (`implement`, `review`, `test`, `compliance`).

Focused run:

```bash
pnpm --filter @pancreator/cli test -- src/run.test.ts -t "composes representative sdk prompts"
```

## Layer 3: Manual live regression traces (on-demand)

Location:

- Trace context fixtures: `tests/context-usage/traces/fd-skeleton/*.context.json`
- Tiny FD skeleton fixture: `tests/context-usage/fixtures/fd-skeleton/`
- Trace budget baseline: `tests/context-usage/baselines/fd-skeleton.json`
- Baseline generator: `tests/context-usage/establish-fd-trace-baseline.mjs`
- Live runner: `tests/context-usage/run-fd-trace-live.mjs`
- Utilities/tests: `tests/context-usage/lib/fd-trace.mjs`, `tests/context-usage/fd-trace.unit.test.mjs`

Live runner flow:

1. load normalized trace context fixture
2. copy tiny fixture to temp
3. build SDK prompt from persona + stage prompt + required artifacts
4. run local SDK agent
5. capture `turn-ended` usage + unique read targets
6. verify required/forbidden reads
7. compare metrics against committed deterministic trace budget
8. write report to `tests/context-usage/output/`

Commands:

```bash
# Rebuild deterministic fd-trace budgets from committed trace contexts
pnpm run context:usage:fd-trace:baseline

# Manual live trace run (real API spend)
pnpm run context:usage:fd-trace -- --trace tests/context-usage/traces/fd-skeleton/implement.context.json
```

## Existing bounded live probe

The original bounded sandbox live probe remains available. It compares policy behavior
(required/forbidden reads, tool-read bounds) against deterministic budgets, and compares
opaque SDK metrics (`input_tokens`, `cache_read_tokens`, `total_tokens`) against a
**ratified live envelope** captured from an approved run.

```bash
pnpm run context:usage:baseline
pnpm run context:usage
```

After a verified live run whose policy checks pass, ratify the SDK envelope:

```bash
pnpm run context:usage:ratify -- tests/context-usage/output/<timestamp>-report.json
```

## Empirical overhead calibration

Use calibration to estimate fresh-agent overhead empirically instead of hard-coding runtime
allowances.

Benchmark matrix:

- prompt: no-op termination instruction (no tools, no reads, immediate exit)
- conditions:
  - `repo_root`
  - `empty_dir`
- metrics per run:
  - `input_tokens`
  - `cache_read_tokens`
  - `total_tokens`
  - `output_tokens`
  - `tool_read_count`
- models:
  - cheap exploration models (for variance shape and spend control)
  - target anchor model (`composer-2.5`) for production live ceilings

Commands:

```bash
# Collect raw calibration samples (defaults: composer-2.5, 10 runs/condition)
pnpm run context:usage:calibrate -- --runs 10

# Optional cheap-model exploration pass
pnpm run context:usage:calibrate -- --models gpt-5.4-mini,gpt-5.2-codex --runs 10

# Summarize robust statistics and update baselines/overhead-calibration.json
pnpm run context:usage:calibrate:summary

# Rebuild bounded baseline (keeps existing ratified live envelope)
pnpm run context:usage:baseline

# Ratify scenario live envelope from a verified bounded run report
pnpm run context:usage:ratify -- tests/context-usage/output/<timestamp>-report.json
```

Raw samples are written to `tests/context-usage/calibration/raw/`.
Summaries are written to `tests/context-usage/calibration/summaries/`.
The canonical consumed overhead artifact is `tests/context-usage/baselines/overhead-calibration.json`.
It informs calibration/noise-floor reporting, while bounded live pass/fail remains anchored to
the ratified `live_envelope` in `tests/context-usage/baselines/composer-2.5.json`.

### Statistical method

- centrality: median
- spread: MAD + IQR
- quantiles: p75/p90/p95
- ceiling estimator: one-sided nonparametric upper confidence bound on a target quantile
  (default: q=0.9, confidence=0.8)
- repo-specific overhead signal: repo-root vs empty-dir differential on paired runs
- noise floor: p90 absolute differential; scenario token deltas below this floor are not
  meaningful live regression gates

### Recommended sample sizes

- exploratory pass: 10 runs/condition/model
- defensible p90 envelope: ~30 runs/condition/model
- tighter p95-style envelope: ~60 runs/condition/model

CI runs `context:usage:test` only. It validates deterministic budget math, calibration
statistics logic, scenario guardrails, and envelope comparison logic. It does **not** invoke
the Cursor API.

The explainable budget (`budgets.input_tokens.explained`) is an audit breakdown of visible
inputs. It is not the pass/fail ceiling for live `input_tokens`/`cache_read_tokens`; those
metrics track SDK/runtime cache behavior and are compared against the ratified envelope.

## Invalidation rules

Rebuild `baselines/composer-2.5.json` explainable budget when any of the following changes:

- `tests/context-usage/prompt.md`
- required read lists or budget constants in `tests/context-usage/lib/stats.mjs`
- tier-sandbox fixture content affecting `fixture_hash`

Re-calibrate overhead envelopes when model/provider/runtime behavior changes:

```bash
pnpm run context:usage:calibrate -- --runs 10
pnpm run context:usage:calibrate:summary
pnpm run context:usage:baseline
```

Optionally keep `context:usage:ratify` for direct single-report envelope updates, but calibration
summary is the preferred path because it captures distribution spread and noise floor instead of
a single-point snapshot.

Rebuild `baselines/fd-skeleton.json` when any of the following changes:

- any `*.context.json` under `tests/context-usage/traces/fd-skeleton/`
- stage prompt fixture content referenced by those contexts
- required read lists / forbidden patterns inside trace contexts
- fd-trace budget constants in `tests/context-usage/lib/fd-trace.mjs`
- fd-skeleton fixture content affecting `fixture_hash`

## Cost and runtime notes

- Live scripts require `CURSOR_API_KEY` (shell env or repo-root `.env`).
- Live scripts spend credits and are manual-only.
- `@cursor/sdk` usage is captured from `agent.send({ onDelta })` `turn-ended` events.
- `tool_read_count` is unique read targets, not raw duplicated stream envelopes.
