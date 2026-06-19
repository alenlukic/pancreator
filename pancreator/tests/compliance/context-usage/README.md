# Token economy prototype harness

Canonical root: `tests/compliance/context-usage/`

This harness implements the **token-economy prototype**: exactly four live calibration
combinations (`task-low` / `task-high` × `composer-2.5` / `gpt-5.5`), overhead-anchored
expected consumption, NDJSON traces, and an analyzer for policy violations and
inefficiencies.

Legacy `tests/context-usage/`, fd-trace, tier-sandbox, and live-envelope flows are
removed from this tree.

## Prototype matrix

|  | `composer-2.5` | `gpt-5.5` |
|---|---|---|
| **task-low** (routing, no writes) | ✓ | ✓ |
| **task-high** (multi-read + one artifact write) | ✓ | ✓ |

Fixtures: `fixtures/task-low/`, `fixtures/task-high/` (each includes decoy `.docs/PRD.md`).

## Expected consumption formula

For each observed task run:

`variable_tokens = observed_total_tokens - overhead.median(model)`

Expected upper bound:

`overhead.upper_confidence_bound(model) + variable.upper_confidence_bound(task, model)`

Baselines:

- `baselines/overhead.<model>.json`
- `baselines/expected.<task>.<model>.json`

## Offline commands (CI-safe)

```bash
pnpm run context:usage:test
```

## Operator-only live calibration

Requires `CURSOR_API_KEY` and `CURSOR_CONTEXT_USAGE=1` (set automatically by `pnpm run context:usage:*`).

```bash
pnpm run context:usage:calibrate
pnpm run context:usage:analyze
```

Manual RTK token comparison (`auto` model by default):

```bash
pnpm run context:usage:rtk-compare
```

This run creates a synthetic Git sandbox with local bare remote and a large generated
project surface (services, docs, config, tests, and many decoy files). It then runs
once with plain commands and once with RTK wrappers.

Execution contract:

- Each mode uses a fixed 5-turn shell command plan (deterministic command string per turn).
- The harness rejects any non-shell tool calls.
- The harness rejects runs that diverge from the fixed command plan order/content.
- Turns must consume the prior turn artifact chain:
  - turn 1 writes `.work/rtk-bench/candidates.json`
  - turn 2 consumes candidates and writes `.work/rtk-bench/extracts.json`
  - turn 3 consumes extracts and writes `.work/rtk-bench/comparisons.json`
  - turn 4 consumes comparisons and writes `.work/rtk-bench/mutation-result.json`
  - turn 5 consumes mutation result and writes `.work/rtk-bench/final-report.json`
- Turns 2-5 are audited for rediscovery violations (`find`/`rg`/`rtk find`/`rtk grep`).

Retry semantics:

- Retries are clean-slate only: fresh sandbox + fresh agent session.
- The prompt text is identical across attempts for a given `(mode, run_index)`.
- The harness does not inject retry guidance or corrective scaffolding into prompts.
- Failed attempts are discarded; accepted attempts are reported with discarded-attempt metadata.

Token reporting:

- Comparison payloads separate `input_tokens` and `output_tokens` for each scenario and summary.
- `total_tokens` remains a derived aggregate for compatibility.
- `tool_call_tokens` are intentionally not tracked.
- Summaries include an accumulation window (`turns 3-5`) for input/output/total deltas.

Reports are written to `calibration/raw/rtk-vs-plain.latest.json` plus a timestamped sibling file.

The scenario executes as explicit SDK turn invocations (5 turns per mode), and logs
stdout progress lines in this format:

`turn <N>: running <TOOL> in <mode> mode`

Default matrix run: 2 overhead probes + `8 × 4` task runs (~34 API calls). Lower cost:

```bash
node tests/compliance/context-usage/calibrate-matrix.mjs --runs 3
```

Traces: `calibration/traces/<combo>/` (NDJSON + `.summary.json` per run). Each matrix run
clears prior artifacts for that combo before writing new ones. `context:usage:analyze`
deduplicates by `run_index`, keeping the newest summary.

`baselines/` and `calibration/` (except `.gitkeep` placeholders) are **gitignored** and
operator-local only. Run calibration locally, then inspect findings and baselines on disk.

Rebuild expected baselines from a saved raw file:

```bash
pnpm run context:usage:expected -- --raw tests/compliance/context-usage/calibration/raw/matrix-samples.json
```

## Iterative loop

1. `pnpm run context:usage:calibrate`
2. Inspect `calibration/findings/`
3. Batch-fix prompts, fixtures, or task rules
4. Repeat until violations and inefficiencies are gone or only irreducible overhead remains
