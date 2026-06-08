---
title: Context Usage Test Harness Engineering Spec
feature_id: context-usage-test-harness
status: intake-closed
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
next_owner: supervisor
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds required; the directive is fully actionable on its face with explicit acceptance criteria, complete directory layout, bounded agent task steps, verification logic, and an unambiguous automated/manual split.
intake_notes:
  - The directive is fully actionable with no material ambiguities. The directory layout, bounded agent task, verification layers, baseline/3-sigma logic, and automated-vs-manual split are all explicitly defined.
  - The intake-analyst opted out of the clarifying-question dialogue loop because no open questions exist; the human_approval gate is satisfied by an empty Open questions section and this explicit intake_closure block.
  - Feature ID disambiguated from directive feature_id "context-usage-test" to "context-usage-test-harness" to match the task id slug and avoid collision with the existing context-budget test suite.
references:
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [14, 22]
    contentHash: cf9d9a3
    note: Directive Goal section enumerates the six runtime-probe objectives this spec normalises.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [24, 56]
    contentHash: cf9d9a3
    note: Directive Directory layout section specifies the full tests/context-usage/ tree.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [58, 75]
    contentHash: cf9d9a3
    note: Directive Synthetic sandbox design section defines tier coverage, file types, and deterministic-anchor requirement.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [79, 96]
    contentHash: cf9d9a3
    note: Directive Bounded agent task section specifies the five read steps and the output artifact schema.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [98, 127]
    contentHash: cf9d9a3
    note: Directive Verification section defines Layer A deterministic correctness checks and Layer B token aggregation metrics.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [129, 145]
    contentHash: cf9d9a3
    note: Directive Baseline and 3-sigma gate section defines the fixture-hash guard, per-metric failure condition, and degenerate-sigma guardrails.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [147, 153]
    contentHash: cf9d9a3
    note: Directive Automated vs manual split table mandates that only the unit test file enters pnpm test; live harness files MUST NOT.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [155, 159]
    contentHash: cf9d9a3
    note: Directive Documentation updates section names README, context-cost-audit pointer, and relationship to the ~770K IDE baseline.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [161, 167]
    contentHash: cf9d9a3
    note: Directive Key constraints/risks section enumerates five constraints this spec preserves.
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/15509_1941_context-usage-test.md
    range: [169, 176]
    contentHash: cf9d9a3
    note: Directive Acceptance criteria section provides the six gate conditions this spec mirrors.
---

# Spec

This Feature SHALL add a manual-only runtime context-usage probe under
`tests/context-usage/` that verifies tier-routing behaviour and aggregates
token consumption from live `@cursor/sdk` runs against a committed synthetic
mini-repo fixture. The Feature SHALL keep the probe fully isolated from the
root `pnpm test` script. The Feature SHALL provide a pure-logic unit-test
file that covers statistical helpers and verification logic without invoking
the SDK.

## Acceptance criteria

### Directory and file structure

- When the Feature creates the harness, the Feature MUST create the directory
  `tests/context-usage/` and all subdirectories and files enumerated in the
  Directive Directory layout section.
- When the Feature creates the harness, the Feature MUST commit
  `tests/context-usage/fixtures/tier-sandbox/` as a synthetic mini-repo with
  maximum directory depth of 4 and a total text footprint between 150 000 and
  300 000 characters.
- When the Feature populates the sandbox fixture, the Feature MUST include at
  least one representative file for each of the eight tiers defined in the
  Directive Synthetic sandbox design table:
  `active_memory`, `active_work`, `durable_memory`, `archival_memory`,
  `internal_operating`, `product_context`, `source_code`, and
  `generated_machine`.
- When the Feature populates the sandbox fixture, the Feature MUST embed a
  unique deterministic anchor string in each fixture file so correctness
  verification does not depend on model judgment.
- When the Feature creates the sandbox fixture, the Feature MUST include a
  sandbox-local `.cursorindexingignore` that mirrors the production exclusion
  intent with sandbox-relative paths.
- When the Feature creates the sandbox fixture, the Feature MUST include a
  minimal `AGENTS.md` routing card that directs agents to summary-first
  documentation.
- When the Feature creates `tests/context-usage/prompt.md`, the file MUST
  contain the five frozen read instructions and the write instruction for
  `.pan/work/99999_sandbox/task/context-usage-report.json` exactly as enumerated in
  the Directive Bounded agent task section.
- When the Feature creates `tests/context-usage/baselines/`, the Feature MUST
  create the directory with a placeholder or gitkeep; no committed baseline
  JSON is required until the operator runs `establish-baseline.mjs`.

### Package scripts

- When the Feature adds package scripts, the Feature MUST add exactly two
  manual scripts to the root `package.json`: `"context:usage"` invoking
  `node tests/context-usage/run-live.mjs` and `"context:usage:baseline"`
  invoking `node tests/context-usage/establish-baseline.mjs --samples 5`.
- When the Feature adds package scripts, the Feature MUST add exactly one
  automated script `"context:usage:test"` invoking
  `node --test tests/context-usage/context-usage.unit.test.mjs`.
- When the Feature adds `run-live.mjs` or `establish-baseline.mjs`, each
  entry-point MUST exit immediately with a printed instruction message unless
  both environment variables `CURSOR_CONTEXT_USAGE=1` and `CURSOR_API_KEY` are
  set in the process environment.
- When the Feature configures root package scripts, the Feature MUST NOT add
  `tests/context-usage/run-live.mjs` or
  `tests/context-usage/establish-baseline.mjs` to any script that is invoked
  by the root `test` script or by CI.

### `.gitignore`

- When the Feature creates the output directory, the Feature MUST add
  `tests/context-usage/output/` to `.gitignore` so that per-run report JSON
  files are not committed.

### `copy-sandbox.mjs`

- When `copy-sandbox.mjs` runs, it MUST copy
  `tests/context-usage/fixtures/tier-sandbox/` to a temporary directory via
  `fs.mkdtemp` and MUST pass the resulting path as `cwd` to the SDK agent
  invocation.
- When `copy-sandbox.mjs` runs, it MUST perform sanity checks that confirm the
  copied tree is non-empty before returning the temp path.

### `collect-usage.mjs`

- When `collect-usage.mjs` wraps an SDK stream, it MUST aggregate the
  following eight metrics across all `turn-ended` events: `input_tokens`,
  `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`,
  `duration_ms`, `turn_count`, and `tool_read_count`.
- When a `turn-ended` event is missing the `usage` field, `collect-usage.mjs`
  MUST fail with an actionable error message that instructs the operator to
  re-run with `--debug-stream` and MUST NOT silently pass with zero counts.

### `verify-run.mjs` — Layer A deterministic correctness

- When `verify-run.mjs` parses the output artifact, it MUST compare every
  field in `context-usage-report.json`.`answers` against the expected values
  defined in `tests/context-usage/lib/expected.mjs`.
- When `verify-run.mjs` evaluates tool call paths, it MUST fail the run if any
  observed read path matches one of the three forbidden patterns:
  `.docs/PRD.md`, `.docs/BOOTSTRAP.md`, or any path under `.pan/archive/work/**` or
  `.pan/archive/inbox/**`.
- When `verify-run.mjs` evaluates tool call paths, it MUST fail the run if any
  observed read path matches any path under `lib/inbox/**`.
- When `verify-run.mjs` evaluates required reads, it MUST fail the run if the
  union of tool log paths and `files_read` entries does not include a path
  matching each of the five required read steps: active memory file, handbook
  file, PRD summary file, explicit handoff file, and handler source file.
- When `verify-run.mjs` classifies observed paths, it MUST call
  `classifyExclusiveTier()` imported from
  `lib/internal/tools/context-budget-report.mjs` on each path and MUST assert
  the returned tier matches the expected tier bucket for the corresponding
  bounded-task step.

### `stats.mjs` — 3-sigma gate

- When `stats.mjs` computes the 3-sigma gate, it MUST fail a metric when the
  observed value exceeds `mean + 3 × sd` for that metric as recorded in the
  active baseline JSON.
- When the baseline has fewer than 3 samples or `sd === 0` for a metric,
  `stats.mjs` MUST apply the minimum absolute guardrails documented in
  `tests/context-usage/README.md` rather than the sigma formula.
- When a run baseline has a `fixture_hash` or `prompt_version` that differs
  from the current fixture and prompt, `stats.mjs` MUST reject the comparison
  and MUST print an instruction that the operator MUST re-establish the
  baseline before proceeding.

### `establish-baseline.mjs`

- When `establish-baseline.mjs` runs, it MUST execute exactly 5 live SDK runs
  when invoked with `--samples 5` and MUST write the aggregated baseline to
  `tests/context-usage/baselines/composer-2.5.json`.
- When `establish-baseline.mjs` writes the baseline, the JSON MUST include the
  fields `fixture_hash`, `prompt_version`, `samples`, and per-metric `mean` and
  `sd` values for all eight metrics enumerated in the collect-usage contract
  above.

### `run-live.mjs`

- When `run-live.mjs` completes a single run, it MUST write a per-run report
  JSON to `tests/context-usage/output/<iso8601-timestamp>-report.json`.
- When `run-live.mjs` invokes the SDK agent, it MUST pass `composer-2.5` as
  the model identifier, applying bracket-stripping per `resolveSdkModelId` in
  `lib/internal/packages/@pancreator/runner-cursor/src/sdk-model.ts`.

### `context-usage.unit.test.mjs`

- When the unit test suite runs under `node --test`, it MUST test
  `stats.mjs` sigma-math with at least one passing metric fixture and at least
  one simulated metric spike that exceeds 3 sigma.
- When the unit test suite runs under `node --test`, it MUST test
  `verify-run.mjs` with a mock tool log containing a forbidden-path entry and
  MUST assert that verification fails.
- When the unit test suite runs under `node --test`, it MUST test
  `verify-run.mjs` with a mock tool log that does not include a required-read
  path and MUST assert that verification fails.
- When the unit test suite runs under `node --test`, it MUST test that a
  simulated regression where `prompt.md` instructs reading `.docs/PRD.md`
  causes `verify-run.mjs` to fail before any token comparison occurs.
- When the unit test suite runs under `node --test`, it MUST NOT invoke the
  `@cursor/sdk` or any network-bound API.

### Documentation

- When the Feature ships the harness, the Feature MUST write
  `tests/context-usage/README.md` that covers: prerequisites (`CURSOR_API_KEY`,
  platform-specific `@cursor/sdk-*` binary), a cost warning, baseline refresh
  steps, relationship to the manual `~770K`-character IDE baseline documented
  in `lib/memory/handbook/context-cost-audit.md`, and the distinction that this
  harness measures SDK local runs on the synthetic fixture rather than IDE
  cache-read counts.
- When the Feature ships the harness, the Feature MAY append a pointer in
  `lib/memory/handbook/context-cost-audit.md` under a `## Manual validation`
  section that links to the new harness; this update is OPTIONAL and MUST NOT
  block delivery.

## Out of scope

- This Feature SHALL NOT add `tests/context-usage/run-live.mjs` or
  `tests/context-usage/establish-baseline.mjs` to the root `test` script or
  to any CI pipeline.
- This Feature SHALL NOT operate against the live daedaline repository tree;
  the committed synthetic mini-repo fixture is the sole sandbox.
- This Feature SHALL NOT wire token-usage capture into
  `lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts`; that
  enhancement is explicitly deferred per the directive.
- This Feature SHALL NOT modify existing persona specs, pipeline definitions,
  handbook pages, or AGENTS.md.
- This Feature SHALL NOT read, write, traverse, or cite any file under
  `lib/inbox/notes/`.

## Human ratification required

- When the Feature adds the `"context:usage:test"` script to the root
  `package.json`, the operator MUST verify that `pnpm test` does not invoke
  the new script before merging.
- When the baseline file `tests/context-usage/baselines/composer-2.5.json` is
  first committed after operator calibration, the operator MUST ratify the
  committed values before the file is used as the gating baseline.

## Deferrals

- The Future enhancement to wire usage capture into `sdk-transport.ts` so that
  `pan run` stops setting `token_usage_unavailable: true` is deferred per the
  directive and MUST NOT be included in this delivery slice.
- The minimum absolute guardrail threshold values documented in
  `tests/context-usage/README.md` (degenerate-sigma case) MAY be set to
  provisional values during initial delivery and MUST be revisited after the
  first successful baseline calibration.

## Open questions

- None.
