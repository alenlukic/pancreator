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

Default matrix run: 2 overhead probes + `8 × 4` task runs (~34 API calls). Lower cost:

```bash
node tests/compliance/context-usage/calibrate-matrix.mjs --runs 3
```

Traces: `calibration/traces/<combo>/` (NDJSON + `.summary.json` per run; **gitignored**,
operator-local only). Each matrix run clears prior artifacts for that combo before writing
new ones. `context:usage:analyze` deduplicates by `run_index`, keeping the newest summary.
Findings: `calibration/findings/<combo>.json` (committed).

Rebuild expected baselines from a saved raw file:

```bash
pnpm run context:usage:expected -- --raw tests/compliance/context-usage/calibration/raw/matrix-samples.json
```

## Iterative loop

1. `pnpm run context:usage:calibrate`
2. Inspect `calibration/findings/`
3. Batch-fix prompts, fixtures, or task rules
4. Repeat until violations and inefficiencies are gone or only irreducible overhead remains
