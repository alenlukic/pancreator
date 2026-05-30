# ADR Draft: M1 substrate runtime batch architecture decisions

- Status: proposed
- Date: 2026-05-26
- Task id: `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- Feature id (canonical): `m1-substrate-runtime-batch`

## Context

The run is at the `plan` stage and SHALL emit a bounded implement touch-set for six linked work packages. The current runtime surfaces still include stub/deferred behavior in checkpointing integration, runner invocation, pipeline compilation, run-logger conformance, library-mode proof, and install-path automation. The batch must preserve feature-delivery stage-gate behavior while closing these M1 gaps in three phases.

## Decision

1. **WP-A — LangGraph BaseCheckpointSaver conformance**
   - The implementation SHALL align `@pancreator/checkpointer-fs` with LangGraph saver-compatible semantics while retaining Pancreator metadata extensions in checkpoint metadata.
   - Intervention flows SHALL consume saver-aligned checkpoint APIs instead of maintaining separate persistence channels.

2. **WP-B — SDK runner feature flag**
   - `runner.cursor.invocation` SHALL support `manual | sdk`; default SHALL remain `manual` until SDK-path tests pass.
   - `CursorRunner.invoke` SHALL return typed envelope data with artifact/run-log context and SHALL propagate persona model/tool constraints.

3. **WP-C — YAML compiler + intervention side-channel**
   - Pipeline compilation SHALL produce graph semantics (nodes + edges + gate/loop/circuit-breaker directives) rather than ordered-stage stubs.
   - Pause/reroute/abort semantics SHALL compile as a single intervention side-channel node to avoid split runtime state.

4. **WP-D — Option A default with Option B fallback gate (Phoenix-only for M1)**
   - Option A (Phoenix Docker smoke test) SHALL be the default acceptance path for this batch.
   - **Phoenix provisioning:** The conformance harness SHALL ship `tests/run-logger-conformance/docker-compose.yml` with a pinned `arizephoenix/phoenix` image. Smoke tests SHALL boot Phoenix via Docker Compose, wait for health on `:6006`, export/replay OTLP from the sample fixture, assert span hierarchy via Phoenix query APIs, and tear down containers on exit.
   - **Additional backends deferred:** Langfuse and other interchangeability backends SHALL NOT ship in M1. Verification of at least one additional OTel-compatible backend is deferred to milestone `M2` under backlog item `bootstrap-external-observability-phoenix-langfuse`.
   - **CI provisioning:** A dedicated path-filtered workflow (`.github/workflows/run-logger-conformance.yml`) SHALL run `pnpm test:run-logger-conformance` on PRs touching `@pancreator/run-logger` or `tests/run-logger-conformance/**`.
   - Option B deferral SHALL be allowed only when Option A is blocked with evidence and after explicit tech-lead ratification, then recorded as ADR `0007` with milestone `M2`.

5. **WP-E — library-mode primitive**
   - The library-mode proof SHALL use `@pancreator/persona` primitives (`parsePersonaMarkdown`, `assertPersonaSpec`, `emitCursorAgentsMirror`, `emitMdcShim`) to avoid horizontal dependencies.
   - The script SHALL execute from outside monorepo context and SHALL emit exactly two files to an isolated temp output path.

6. **WP-F — install-path strategy**
   - `pan init` SHALL move from deferred envelope to real dry-run-first behavior with apply mode and non-destructive conflict handling.
   - `create-pancreator` scaffolding SHALL ship as a repeatable greenfield entrypoint that produces a runnable M1 workspace independent of this repository layout.

## Consequences

### Positive

- The harness loop SHALL have a coherent substrate path from checkpoint persistence through runner invocation into compiled pipeline execution.
- Operator onboarding SHALL improve via executable install-paths and an externalized library-mode proof.
- Option A default for WP-D keeps observability conformance measurable in CI rather than open-ended in backlog prose.

### Negative

- The batch introduces cross-package coupling that increases integration-test scope across `checkpointer-fs`, `runner-cursor`, `pipeline`, `cli`, and `run-logger`.
- CI load SHALL increase because run-logger smoke tests require Docker on `ubuntu-latest` and a dedicated conformance workflow.
- Local developers SHALL need Docker available to run `pnpm test:run-logger-conformance`; tests MUST skip with an explicit message when Docker is absent.

### Neutral

- Human ratification boundaries and `pan advance` artifact contracts remain unchanged.
- Option B remains a controlled fallback, not a default delivery path.

## Alternatives considered

1. **Defer WP-C until after WP-D/WP-E/WP-F**
   - Rejected because batch acceptance requires harness-loop completion with SDK runner + compiled pipeline.
2. **Make SDK invocation default immediately**
   - Rejected because current manual flow is the stability baseline and must remain fallback until conformance is proven.
3. **Adopt WP-D Option B as immediate default**
   - Rejected because intake ratified Option A and requires evidence-backed fallback gating.
4. **Langfuse or second-backend smoke test in M1**
   - Rejected because proving interchangeability before Phoenix import works is premature; additional backend verification is deferred to M2.

## Related records

- `lib/memory/adr/0002-system-architecture-map.md`
- `lib/memory/adr/0004-documentation-impact-contract.md`

## Dual-anchor citations

- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [56, 73], contentHash: "5009d5a"}
- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [76, 130], contentHash: "5009d5a"}
- {kind: lines, path: "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md", range: [131, 169], contentHash: "5009d5a"}
- {kind: lines, path: "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/state.json", range: [29, 44], contentHash: "6353af4"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/checkpointer-fs/lib/fs-checkpoint-store.ts", symbol: "FsCheckpointStore", contentHash: "e0b1e0c"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.ts", symbol: "CursorRunner.invoke", contentHash: "0c74713"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/pipeline/lib/compile.ts", symbol: "compilePipeline", contentHash: "98644dc"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/cli/lib/run.ts", symbol: "parseAndRun", contentHash: "896e6a8"}
- {kind: symbol, path: "lib/internal/packages/@pancreator/persona/lib/emit.ts", symbol: "emitMdcShim", contentHash: "4f1eac5"}
- {kind: lines, path: "lib/memory/adr/0002-system-architecture-map.md", range: [137, 169], contentHash: "31ef906"}
- {kind: lines, path: "lib/memory/adr/0004-documentation-impact-contract.md", range: [49, 90], contentHash: "175d5b3"}
