# Context usage test harness

Manual runtime probe for `@cursor/sdk` on a **synthetic tier sandbox** (`fixtures/tier-sandbox/`).
Complements static index-policy checks in `tests/context-budget-report.test.mjs`.

This harness measures **SDK local runs** on the committed fixture. It is **not** comparable
one-to-one with the manual ~770K IDE cache-read baseline in
`lib/memory/handbook/context-cost-audit.md` — SDK `cacheReadTokens` from `turn-ended` events
are the closest analog.

## Prerequisites

- `CURSOR_API_KEY` in the shell or repo-root `.env` (gitignored)
- Root `devDependencies`: `@cursor/sdk@1.0.13` and platform `@cursor/sdk-<platform>-<arch>` optional packages (same pattern as `@pancreator/runner-cursor`)
- Ripgrep: set `CURSOR_RIPGREP_PATH` to an absolute `rg` binary, or install platform SDK optional deps so the harness can auto-resolve `rg`

## Cost warning

Every live run invokes `composer-2.5` against the real API and spends credits. Live scripts
exit immediately unless `CURSOR_API_KEY` is available (shell env or repo-root `.env`).
`pnpm run context:usage` and `pnpm run context:usage:baseline` also enable the live gate
for that process; direct `node tests/context-usage/run-live.mjs` still requires
`CURSOR_CONTEXT_USAGE=1`.

## Commands

```bash
# Automated (CI-safe): stats + verify logic only
pnpm run context:usage:test

# Manual: establish baseline (5 samples)
pnpm run context:usage:baseline

# Manual: single run vs committed baseline
pnpm run context:usage
```

Repo-root `.env` is loaded automatically when the key is not already exported.

Per-run JSON reports are written under `output/` (gitignored).

## Baseline refresh

Re-run `context:usage:baseline` when:

- `fixtures/tier-sandbox/` changes (`fixture_hash` mismatch)
- `prompt.md` `prompt_version` changes
- Indexing policy materially changes tier routing expectations

The baseline file `baselines/composer-2.5.json` should be ratified by a human operator before
merge gating relies on it.

## Degenerate-sigma guardrails

When `samples < 3` or `sd === 0` for a metric, `stats.mjs` uses minimum absolute caps instead of
`mean + 3σ`:

| Metric | Cap (provisional) |
|--------|-------------------|
| `input_tokens` | 500,000 |
| `output_tokens` | 100,000 |
| `cache_read_tokens` | 2,000,000 (also capped at 2× calibration mean when mean > 0) |
| `cache_write_tokens` | 500,000 |
| `total_tokens` | 2,500,000 |
| `duration_ms` | 600,000 |
| `turn_count` | 50 |
| `tool_read_count` | 100 |

Revisit these after the first successful live calibration.

## Token usage capture

`@cursor/sdk` emits `turn-ended` events with `usage` on `agent.send({ onDelta })`, **not**
on `run.stream()`. The harness aggregates usage from `onDelta` and tool paths from
`run.stream()` `tool_call` messages. If no `turn-ended` usage is captured, live runs fail.

If usage is still missing, re-run with:

```bash
pnpm run context:usage -- --debug-stream
```

## Missing `turn-ended.usage` on a captured turn

If a `turn-ended` delta arrives without `usage`, live runs fail loudly. Re-run with:

```bash
pnpm run context:usage -- --debug-stream
```

## Model note

IDE personas may specify `composer-2.5[fast=false]`; the SDK receives `composer-2.5` only
(bracket stripping per `resolveSdkModelId`).

## CI isolation

Root `pnpm test` does **not** invoke `context:usage` or `context:usage:baseline`. Only
`context:usage:test` runs in automation.
