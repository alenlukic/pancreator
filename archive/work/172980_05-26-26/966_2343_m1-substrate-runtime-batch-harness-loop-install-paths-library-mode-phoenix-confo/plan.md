# Plan — m1-substrate-runtime-batch

The implement stage SHALL deliver a three-phase batch where Phase 1 establishes LangGraph-adjacent runtime primitives (WP-A checkpointer conformance and WP-B SDK runner wiring), Phase 2 compiles pipeline YAML into an executable graph with intervention side-channel semantics (WP-C), and Phase 3 closes operator-facing and conformance surfaces (WP-D, WP-E, WP-F) in parallel without violating Phase 1/2 gating. The batch MUST preserve the existing feature-delivery ledger contracts (`state.json`, `handoff.md`, `touch-set.json`) and MUST keep human ratification boundaries intact before any `pan advance` call.

## Delivery phasing

1. **Phase 1 (WP-A + WP-B)**
   - The implementor SHALL complete WP-A and WP-B first and SHALL keep both package test suites green before opening WP-C implementation work.
   - The implementor SHALL keep `runner.cursor.invocation: manual` as the default and SHALL gate SDK transport behind an explicit `sdk` feature flag.
2. **Phase 2 (WP-C)**
   - The implementor SHALL begin WP-C only after Phase 1 tests pass and SHALL include one end-to-end stub run of `feature-delivery` against the SDK runner path.
   - The implementor SHALL migrate current pipeline execution callers to compiled graph semantics in the same change set.
3. **Phase 3 (WP-D + WP-E + WP-F)**
   - The implementor MAY execute WP-D/WP-E/WP-F in parallel streams, but each stream MUST land with its own tests and documentation deltas.
   - WP-D SHALL use Option A by default; Option B SHALL require a blocking-evidence inbox item plus explicit tech-lead ratification.

## Work-package task breakdown

### WP-A — LangGraph BaseCheckpointSaver conformance

1. Extend `@pancreator/checkpointer-fs` checkpoint primitives so metadata and persistence shapes can map to LangGraph saver semantics.
2. Add/adjust tests to assert checkpoint write/read/list behavior, metadata preservation, and checkpoint resume alignment with intervention checkpoints.
3. Wire intervention manager usage to saver-aligned methods so pause/resume/abort flows do not maintain a parallel persistence implementation.

### WP-B — SDK runner invocation + feature flag

1. Extend `RunnerInvokeInput`/`RunnerInvocationEnvelope` to carry stage prompt path, ledger context, artifact path, and structured run-log fragments.
2. Add feature-flagged routing in CLI/runtime control paths so `manual` remains default while `sdk` enables Cursor SDK invocation.
3. Add tests for both modes (`manual`, `sdk`) and for persona model/tools/disallowedTools/maxTurns propagation.

### WP-C — YAML to StateGraph compiler + intervention side-channel

1. Replace ordered-stage stub compilation with graph compilation that models gate/loop/circuit-breaker directives.
2. Inject a single intervention side-channel node for pause/reroute/abort semantics and reject unsupported persona/contract/worktree combinations with descriptive errors.
3. Migrate current execute callers to the compiled graph path and add parse-compile-serialize identity tests plus MVP pipeline structural checks.

### WP-D — Phoenix conformance (Option A, Phoenix-only for M1)

#### WP-D.0 — Phoenix provisioning (install/bootstrap)

1. Add `tests/run-logger-conformance/docker-compose.yml` with a pinned `arizephoenix/phoenix` service exposing OTLP ingest (gRPC `:4317`) and UI/health (`:6006`). The compose file SHALL NOT require operator credentials.
2. Add `tests/run-logger-conformance/README.md` documenting local bootstrap:
   - `docker compose -f tests/run-logger-conformance/docker-compose.yml up -d`
   - health wait on `http://127.0.0.1:6006/health` (or current Phoenix health path)
   - teardown via `docker compose ... down`
3. Add `tests/run-logger-conformance/helpers/boot-phoenix.mjs` and `tests/run-logger-conformance/helpers/wait-for-http.mjs` so smoke tests start Phoenix when Docker is available, skip with explicit reason when Docker is absent, and always tear down on exit.
4. Add root `package.json` script `test:run-logger-conformance` that runs the conformance suite via `node --test tests/run-logger-conformance/*.test.mjs`.
5. Add root devDependencies required by the harness (minimum: HTTP client for health/assertions and OTLP export helpers). Pin versions in `pnpm-lock.yaml`.
6. Update `lib/internal/packages/@pancreator/run-logger/README.md` to cite `tests/run-logger-conformance/` as conformance authority for Phoenix import.

**M1 scope note (operator ratified):** WP-D SHALL prove Phoenix import only. Verifying additional observability backends (Langfuse, OTel Collector, Jaeger, or equivalent) is deferred to milestone `M2` and tracked under backlog item `bootstrap-external-observability-phoenix-langfuse`. Proving interchangeability before Phoenix itself works is out of scope for this batch.

#### WP-D.1 — Smoke test and fixture

1. Add `tests/run-logger-conformance/fixtures/sample-run-log.jsonl` with OpenInference + OTel GenAI attributes aligned to `lib/memory/handbook/run-log-schema.md`.
2. Add `tests/run-logger-conformance/phoenix-smoke.test.mjs` that boots Phoenix, replays/exports OTLP from the fixture, queries Phoenix for expected span hierarchy, and asserts zero import errors.

#### WP-D.2 — CI wiring

1. Add `.github/workflows/run-logger-conformance.yml` with path filters on `lib/internal/packages/@pancreator/run-logger/**` and `tests/run-logger-conformance/**`.
2. The workflow SHALL run on `ubuntu-latest`, start Docker, execute `pnpm test:run-logger-conformance`, and fail closed when Phoenix boot or the smoke test fails.
3. Keep `phase-0a-scaffold.yml` unchanged unless implementor needs a shared Docker setup snippet; path-filtered conformance MUST remain in the dedicated workflow.

#### WP-D.3 — Fallback gate

1. If Docker/Phoenix boot fails reproducibly on CI or locally with evidence, implementation SHALL halt Option A and SHALL open an inbox item before switching to Option B.
2. Option B SHALL author `lib/memory/adr/0007-run-logger-phoenix-conformance-deferral.md` only after explicit tech-lead ratification.

### WP-E — library-mode script example

1. Add `examples/library-script/` with minimal package scaffold, single entry script, and README.
2. Implement script behavior to parse and validate persona markdown and emit `.cursor/agents/<name>.md` + `.cursor/rules/<name>.mdc` in a temp output path.
3. Add smoke tests that run outside the monorepo and prove no reads under `lib/memory/`, `lib/inbox/`, or `pancreator.yaml`.

### WP-F — install paths (`pan init`, `create-pancreator`)

1. Replace deferred `pan init` behavior with dry-run default, apply mode, conflict checks, adoption scan report emission, and inbox ratification item creation.
2. Add `create-pancreator` scaffolding flow and ensure generated projects run `pan inbox` + `pan run feature-delivery`.
3. Add non-destructive behavior tests to guarantee no overwrite without explicit force/confirm semantics.

## Validation commands

### Phase 1 gate

- `pnpm --filter @pancreator/checkpointer-fs test`
- `pnpm --filter @pancreator/runner-cursor test`
- `pnpm --filter @pancreator/intervention test`

### Phase 2 gate

- `pnpm --filter @pancreator/pipeline test`
- `pnpm --filter @pancreator/cli test -- --runInBand feature-delivery`
- `pnpm -w exec pan run feature-delivery lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md`

### Phase 3 gate

- `pnpm --filter @pancreator/run-logger test`
- `pnpm test:run-logger-conformance`
- `pnpm --filter @pancreator/persona test`
- `pnpm --filter @pancreator/cli test -- --runInBand run.ts`
- `pnpm test`

### Batch integration and compliance gate

- `pnpm -w exec pan status 966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- `node lib/internal/tools/run-compliance.mjs`

## Acceptance traceability

| Acceptance surface | Implement-stage delivery hook |
|---|---|
| WP-A conformance + checkpoint resume | `checkpointer-fs` saver + metadata tests + intervention alignment tests |
| WP-B sdk/manual flag and typed envelope | `runner-cursor` types + runner logic + CLI invocation toggle |
| WP-C graph compiler + side-channel + migration | `pipeline` compiler/execute paths + `feature-delivery` runtime integration |
| WP-D Option A default | Docker Compose Phoenix bootstrap + Phoenix smoke test + path-filtered CI workflow |
| WP-E library proof | new `examples/library-script/` package + README + smoke tests |
| WP-F install paths | CLI init/create implementation + destructive-write guard tests |
| Batch harness loop + compliance | feature-delivery e2e stub run + compliance broad sweep |

## Documentation impact decision

```yaml
documentation_impact:
  applies: true
  rationale: "This batch changes runtime behavior, CLI semantics, CI/testing surfaces, and operator-facing proof paths."
  changed-surfaces:
    - lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
    - docs/PRD.summary.md
    - .github/workflows/run-logger-conformance.yml
    - lib/internal/packages/@pancreator/run-logger/README.md
    - tests/run-logger-conformance/README.md
    - package.json
    - lib/internal/packages/@pancreator/cli/lib/run.ts
  deferred-items:
    - id: bootstrap-external-observability-phoenix-langfuse
      milestone: M2
      rationale: "Additional observability backend verification (Langfuse or equivalent) deferred until Phoenix import is proven in M1."
```

## Dual-anchor citations

- {kind: lines, path: "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/state.json", range: [3, 19], contentHash: "6353af4"}
- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [56, 73], contentHash: "5009d5a"}
- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [76, 130], contentHash: "5009d5a"}
- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [131, 169], contentHash: "5009d5a"}
- {kind: lines, path: "lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md", range: [133, 188], contentHash: "a935d1b"}
- {kind: lines, path: "lib/memory/handbook/documentation-impact-contract.md", range: [47, 109], contentHash: "07a0370"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/checkpointer-fs/lib/fs-checkpoint-store.ts", symbol: "FsCheckpointStore", contentHash: "e0b1e0c"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.ts", symbol: "CursorRunner.invoke", contentHash: "0c74713"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/pipeline/lib/compile.ts", symbol: "compilePipeline", contentHash: "98644dc"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/pipeline/lib/execute.ts", symbol: "executePipeline", contentHash: "cca08db"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts", symbol: "advanceFeatureDelivery", contentHash: "1131dfc"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/cli/lib/run.ts", symbol: "parseAndRun", contentHash: "896e6a8"}
- {kind: lines, path: "docs/M1.index.md", range: [38, 101], contentHash: "186e2ec"}
- {kind: lines, path: "docs/PRD.summary.md", range: [13, 50], contentHash: "05cf26a"}
