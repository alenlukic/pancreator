---
title: M1 substrate runtime batch — harness loop, install paths, library mode, Phoenix conformance
feature_id: m1-substrate-runtime-batch
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
intake_round: 0
wp_d_choice: option-a
wp_d_fallback: option-b-milestone-m2
work_packages:
  - feature_id: checkpointer-fs-langgraph-conformance
    label: WP-A — LangGraph checkpointer conformance
  - feature_id: runner-cursor-sdk-invocation
    label: WP-B — Cursor SDK runner invocation
  - feature_id: pipeline-langgraph-stategraph-compiler
    label: WP-C — Pipeline StateGraph compiler
  - feature_id: run-logger-phoenix-conformance
    label: WP-D — Run-logger Phoenix conformance (option A, Phoenix-only M1)
wp_d_scope: phoenix-only-m1
wp_d_deferred_m2: additional-backend-verification
  - feature_id: library-mode-script-example
    label: WP-E — Library-mode script example
  - feature_id: pan-install-paths
    label: WP-F — Install paths
references:
  - kind: lines
    path: lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    range: [1, 40]
    contentHash: b8cf506
    note: Directive frontmatter, work-package table, and problem statement defining the six M1 gaps consolidated in this batch.
  - kind: lines
    path: lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    range: [179, 188]
    contentHash: b8cf506
    note: Cross-cutting delivery phasing — WP-A and WP-B SHOULD land before or with WP-C; WP-C acceptance includes an e2e stub run against the SDK runner (WP-B).
  - kind: lines
    path: lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    range: [133, 151]
    contentHash: b8cf506
    note: WP-D option A (Phoenix/Langfuse smoke tests) and option B (formal deferral ADR) definitions and acceptance criteria.
  - kind: lines
    path: .docs/PRD.md
    range: [113, 121]
    contentHash: 2eb6aa4
    note: PRD §3.5 US-8 (library mode) and US-9 (install paths) — M1 MVP promises that WP-E and WP-F close.
  - kind: lines
    path: lib/memory/handbook/run-log-schema.md
    range: [1, 10]
    contentHash: 5c18026
    note: Run-log schema defining OpenInference primary attributes and OTel GenAI semconv parallel layer; referenced by WP-A and WP-B acceptance criteria.
---

# Spec

This Feature SHALL close six M1 substrate and runtime gaps — LangGraph checkpointer conformance (WP-A), Cursor SDK runner invocation (WP-B), pipeline StateGraph compiler (WP-C), run-logger Phoenix conformance (WP-D), library-mode script example (WP-E), and install paths (WP-F) — so that the `feature-delivery` harness loop reaches a runnable end-to-end state with checkpoint resume, run-log observability conformance is either proven or formally deferred, and library-mode adoption and both install paths are demonstrable without hand-authored scaffold. The batch closes PRD US-8 (library mode) and US-9 (install paths) and unblocks the runner-cursor substrate gap BR4 documented in `.docs/BOOTSTRAP.md` Phase 3.

## Delivery phasing

Delivery SHALL proceed in three phases to respect harness-loop dependencies.

| Phase | Work packages | Dependency constraint |
|---|---|---|
| Phase 1 | WP-A, WP-B | No inter-package dependencies; harness prerequisites |
| Phase 2 | WP-C | MUST NOT begin until WP-A and WP-B test suites are green |
| Phase 3 | WP-D, WP-E, WP-F | No inter-package dependencies; MAY proceed in parallel |

WP-C acceptance SHALL include one end-to-end stub run of `feature-delivery` against the SDK runner (WP-B). Downstream agents MUST NOT assume parallel delivery of Phase 1 and Phase 2 without this ratification.

## WP-D option ratification

**Ratified choice: Option A** (Phoenix Docker smoke test under `tests/run-logger-conformance/`).

The intake-analyst ratifies Option A as the delivery default for this intake. Operator plan-stage amendment (2026-05-26): M1 WP-D SHALL prove Phoenix import only; Langfuse and other additional-backend interchangeability tests are deferred to milestone `M2` under backlog item `bootstrap-external-observability-phoenix-langfuse`. When Option A implementation is blocked by environment constraints or CI failures, the implementor SHALL open an inbox item citing the blocking evidence before switching to Option B. When the tech-lead ratifies Option B, the implementor SHALL author `lib/memory/adr/0007-run-logger-phoenix-conformance-deferral.md` with milestone `M2` as the deferred target. Downstream agents MUST NOT assume Option B deferral without explicit tech-lead ratification of that inbox item.

## Acceptance criteria

### WP-A — Checkpointer conformance

- When `pnpm --filter @pancreator/checkpointer-fs test` runs, the test suite SHALL pass the LangGraph `BaseCheckpointSaver` v1 conformance assertions and all Pancreator metadata-extension tests.
- When the pipeline saves and restores a checkpoint, the round-trip integration test SHALL resume from the saved `checkpoint_id` without re-encoding metadata.
- When `@pancreator/intervention` calls pause, resume, or abort on a running pipeline, the intervention manager SHALL use the `BaseCheckpointSaver` official methods and SHALL NOT maintain a parallel persistence path.
- When `Checkpoint` carries Pancreator-specific fields (`worktree_commit`, `run_log_offset`), those fields SHALL reside in `Checkpoint.metadata` per `lib/memory/handbook/run-log-schema.md`.

### WP-B — Cursor SDK runner invocation

- When `CursorRunner.invoke` receives a stage prompt path, a persona spec, and a task ledger, the runner SHALL return a typed result carrying an artifact path and a structured run-log fragment with OpenInference and OTel GenAI attributes per the run-log schema.
- When `pancreator.yaml: runner.cursor.invocation` is set to `sdk`, the runner SHALL call the Cursor SDK and SHALL respect persona `model`, `tools`, `disallowedTools`, and `maxTurns` fields.
- When `pancreator.yaml: runner.cursor.invocation` is set to `manual` (default), the runner SHALL preserve existing behavior and SHALL NOT call the Cursor SDK.
- When an end-to-end smoke test runs one `feature-delivery` stage via the SDK runner, `CursorRunner.invoke` SHALL complete that stage without a manual paste step.
- When `simple task mode` is active, the runner SHALL NOT read any path outside the declared touch-set.

### WP-C — Pipeline StateGraph compiler

- When `compilePipeline(yaml)` is called with a valid pipeline YAML, the function SHALL return a LangGraph `StateGraph` with one node per pipeline stage and edges encoding `gate`, `loop`, and `circuit_breaker` directives.
- When a stage node emits a telemetry span, the OpenInference span name SHALL carry the stage persona's role name.
- When intervention levers (`pause`, `reroute`, `abort`) are compiled, they SHALL compile as a single side-channel node so `@pancreator/intervention` does not maintain parallel state.
- When the compiler encounters an unknown persona, an unknown contract kind, or `worktree: required` with `WorktreePool` unavailable, the compiler SHALL refuse compilation and SHALL exit with a descriptive error message.
- When `pnpm --filter @pancreator/pipeline test` runs, the test suite SHALL pass compiler tests, intervention-node injection tests, and parse → compile → serialize → re-parse identity tests.
- When the five MVP pipeline YAML files are compiled, each SHALL pass structural tests: entry-to-exit reachability, zero orphan nodes, and `circuit_breaker` honored.
- When the change set ships, all existing `executePipeline` callers SHALL be migrated to the compiled graph in the same change set.

### WP-D — Run-logger Phoenix conformance (Option A)

- When the Docker-based smoke test runs under `tests/run-logger-conformance/`, it SHALL boot a local Phoenix instance, replay a sample run log, and assert the expected span hierarchy without error.
- When a pull request touches `@pancreator/run-logger`, CI SHALL run the Phoenix smoke test using a path-filtered trigger.
- When Option A smoke tests pass in CI, `lib/memory/active/current.md` SHALL no longer carry Phoenix OTLP import as an undated risk row.
- When Option A is blocked and Option B is ratified by the tech-lead, `lib/memory/adr/0007-run-logger-phoenix-conformance-deferral.md` SHALL record the deferral in Nygard format with backlog linkage and milestone `M2`.

### WP-E — Library-mode script example

- When `node examples/library-script/index.mjs path/to/persona.md` is run from outside the monorepo, the script SHALL exit zero and SHALL emit exactly 2 files (a `.cursor/agents/<name>.md` mirror and a `.cursor/rules/<name>.mdc` shim) into a temp directory.
- When the script runs, it SHALL NOT read any path under `lib/memory/`, `lib/inbox/`, or `pancreator.yaml`.
- When the script resolves its imports, it SHALL import only `@pancreator/persona` and declared external peers.
- When CI builds the library-mode example, the build and smoke test SHALL complete without touching the host repository.
- When `examples/library-script/` is referenced in `.docs/PRD.summary.md`, it SHALL serve as the authoritative library-mode proof for PRD US-8.

### WP-F — Install paths

- When an operator runs `pnpm -w exec pan init --dry-run` against a standard example repository, the command SHALL complete without writes outside `lib/memory/adoption/` and SHALL surface per-file diffs on stdout.
- When an operator runs `pnpm -w exec pan init --apply` against an empty directory, the command SHALL install the M1 scaffold.
- When `pan init` detects a conflicting file, the command SHALL refuse the write and SHALL exit non-zero unless `--force` is supplied.
- When `pan init` runs, the scan report SHALL write to `lib/memory/adoption/scan-<UTC-day>.md` and SHALL open an inbox ratification item listing detected languages, frameworks, and proposed threshold-policy seeds.
- When `npx create-pancreator <name>` is run, the command SHALL create a complete M1 scaffold (handbook seed pointers, `pancreator.yaml`, `AGENTS.md`, a sample inbox directive, and a runnable `feature-delivery` walkthrough) independent of this repository's bootstrap layout.
- When `npx create-pancreator demo` completes, `pnpm -w exec pan inbox` and `pnpm -w exec pan run feature-delivery` SHALL succeed on the generated scaffold.

### Batch integration

- When all six work packages are delivered, a harness loop run of `feature-delivery` (WP-A + WP-B + WP-C) SHALL complete one stage end-to-end with checkpoint resume.
- When delivery is complete, a `compliance-auditor` broad sweep SHALL report zero `block` findings tied to stub runner behavior (`dryRun: true`), stub `pan init` behavior (`{"status":"stub"}`), or missing library-mode proof.

## Downstream owners

The following persona assignments are RECOMMENDED for the plan stage:

| Work package | Recommended owner(s) |
|---|---|
| WP-A — conformance contract | `tech-lead` |
| WP-A — implementation + vitest | `pancreator-engineer` |
| WP-A — intervention integration review | `reviewer` |
| WP-B — feature-flag contract | `tech-lead` |
| WP-B — SDK wiring | `pancreator-engineer` |
| WP-B — touch-set and disallowed-tool review | `reviewer` |
| WP-C — YAML-to-graph ADR | `tech-lead` |
| WP-C — compiler + migration | `pancreator-engineer` |
| WP-C — LangGraph pin discipline review | `reviewer` |
| WP-D — option A vs B arbitration | `tech-lead` |
| WP-D — smoke tests (if option A) | `pancreator-engineer` |
| WP-D — ratification + active-memory hygiene | `reviewer` |
| WP-E — primitive choice | `tech-lead` |
| WP-E — script + README | `coder` |
| WP-E — no-horizontal-deps audit | `reviewer` |
| WP-F — adoption-report contract | `tech-lead` |
| WP-F — CLI + create-pancreator | `coder` |
| WP-F — non-destructive guarantees review | `reviewer` |
| Batch integration | `supervisor` (phasing + staged outcome); `compliance-auditor` (broad sweep) |

## Out of scope

- LangGraph `Send` API features that lag the TypeScript runtime (Q16 deferral per directive).
- Cohort orchestration and parallel-feature-delivery (M2 per directive out-of-scope section).
- Full intervention spectrum beyond the compiled side-channel node (M2).
- Sandbox-pool execution and container-sandbox install paths (M3).
- SQLite or Postgres checkpointer wrappers (M5+).
- Additional observability backend verification beyond Phoenix (Langfuse, OTel Collector, Jaeger, or equivalent) — deferred to M2 under backlog item `bootstrap-external-observability-phoenix-langfuse`.
- Observability tools beyond Phoenix for WP-D M1 scope.
- OTLP HTTP transport as the default sink replacing JSONL (WP-D out-of-scope).
- LangGraph or MCP-driven examples beyond `examples/library-script/` (PRD §11 deferral).
- Multi-primitive composition examples (M2+).
- Bidirectional sync to GitHub Issues or Linear (Q10 deferral per directive).
- Option B deferral for WP-D unless Option A fails in implementation and the tech-lead ratifies the fallback via inbox item.

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation; WP-D choice ratified as Option A in §WP-D option ratification above)_
