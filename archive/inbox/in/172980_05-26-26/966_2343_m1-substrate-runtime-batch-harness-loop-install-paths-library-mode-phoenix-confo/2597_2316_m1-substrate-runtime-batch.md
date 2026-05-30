---
title: M1 substrate runtime batch — harness loop, install paths, library mode, Phoenix conformance
feature_id: m1-substrate-runtime-batch
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-26T23:16:42Z
references:
  - kind: path
    path: docs/PRD.md
    note: §3.5 US-8 (library mode), US-9 (install paths); §10–§11 (LangGraph conformance, run logs, checkpointer); §11 M1 MVP scope.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 3 substrate steps and BR4 (runner-cursor closes hand-orchestrated → pipeline-driven gap); Phase 5 on-real-targets work.
  - kind: path
    path: lib/inbox/in/172981_05-25-26/
    note: Source bucket for the six consolidated directives (64495–64500).
  - kind: path
    path: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    note: Prior consolidated-batch intake pattern for multi-package delivery.
  - kind: path
    path: pancreator.yaml
    note: Bootstrap evidence tracks Phoenix verification as deferred; runner invocation remains manual post Phase-4 ratification.
---

# M1 substrate runtime batch — harness loop, install paths, library mode, Phoenix conformance

This intake consolidates six related M1 substrate and runtime-gap items into one
delivery batch. Each work package retains its original `feature_id` for tracking
and downstream feature-folder creation.

| Work package | Original `feature_id` | Source directive |
|---|---|---|
| WP-A — LangGraph checkpointer conformance | `checkpointer-fs-langgraph-conformance` | `64498_0605_checkpointer-fs-langgraph-conformance.md` |
| WP-B — Cursor SDK runner invocation | `runner-cursor-sdk-invocation` | `64499_0605_runner-cursor-sdk-invocation.md` |
| WP-C — Pipeline StateGraph compiler | `pipeline-langgraph-stategraph-compiler` | `64497_0605_pipeline-langgraph-stategraph-compiler.md` |
| WP-D — Run-logger Phoenix/Langfuse conformance or deferral | `run-logger-phoenix-conformance` | `64495_0605_run-logger-phoenix-conformance-or-deferral.md` |
| WP-E — Library-mode script example | `library-mode-script-example` | `64496_0605_library-mode-script-example.md` |
| WP-F — Install paths (`pan init` + `create-pancreator`) | `pan-install-paths` | `64500_0605_pan-init-and-create-pancreator-install-paths.md` |

## Problem

Six M1 baseline promises remain open after Phase-4 ratification. Together they
block the transition from hand-orchestrated persona invocation to a
pipeline-driven harness loop and from bootstrap-only adoption to operator-ready
install paths:

1. **Checkpointer gap (WP-A).** `@pancreator/checkpointer-fs` is a
   Pancreator-specific file store, not a conformant LangGraph
   `BaseCheckpointSaver` v1. KPI A19 and `pan pause | resume | rollback |
   snapshot` cannot map to LangGraph time-travel without it.

2. **Runner stub (WP-B).** `@pancreator/runner-cursor` returns `{dryRun: true}`
   without calling the Cursor SDK. Operators still paste `next-prompt.md`
   manually and call `pan advance` — the substrate gap BR4 anticipated.

3. **Pipeline walker (WP-C).** `@pancreator/pipeline` executes YAML as a
   sequential callback walker, not a compiled LangGraph `StateGraph`.
   Intervention semantics, checkpointing, and LangGraph ecosystem conformance
   all decouple from the PRD-prescribed runtime.

4. **Observability conformance (WP-D).** KPI A20 (third-party run-log import
   without glue code) has been carried as an undated deferred item since Phase-4
   exit. Phoenix trace verification lacks either a smoke test or a ratified
   deferral ADR with an explicit milestone.

5. **Library-mode proof missing (WP-E).** PRD §11 names
   `examples/library-script/` as an M1 MVP deliverable. The directory does not
   exist, so US-8 library mode and no-horizontal-deps validation lack an
   external consumer proof.

6. **Install paths unwired (WP-F).** US-9 promises `pan init` and
   `npx create-pancreator` in M1. `pan init` returns `{"status":"stub"}` and
   `create-pancreator` does not exist despite the adopter persona, adopter-scan
   primitive, and pipeline YAML definitions being present.

## Goal

Close the six M1 substrate and runtime gaps in one coordinated batch so that:

- LangGraph checkpointing, pipeline compilation, and Cursor SDK invocation form
  a runnable harness loop for `feature-delivery`.
- Run-log observability conformance is either proven or formally deferred.
- Library mode and both install paths are demonstrable without hand-authored
  scaffold.

The intake-analyst SHALL record delivery phasing and the option-A vs option-B
choice for WP-D in the canonical spec; downstream agents MUST NOT assume
parallel delivery or deferral without that ratification.

## Required outcomes

### WP-A — `checkpointer-fs-langgraph-conformance`

1. `@pancreator/checkpointer-fs` exports a class satisfying LangGraph
   `BaseCheckpointSaver` v1 without adapter glue.
2. LangGraph's checkpoint-saver test suite runs as a vitest harness in CI.
3. Pancreator-specific fields (`worktree_commit`, `run_log_offset`) live in
   `Checkpoint.metadata` per `lib/memory/handbook/run-log-schema.md`.
4. The intervention manager's pause/resume/abort calls use the saver's official
   methods, not a parallel persistence path.

### WP-B — `runner-cursor-sdk-invocation`

1. `CursorRunner.invoke` accepts a stage prompt path, persona spec, and task
   ledger; returns a typed result with artifact path and structured run-log
   fragment.
2. Implementation uses `@cursor/sdk` (or Python `cursor-sdk` if a sidecar is
   required) and respects persona `model`, `tools`, `disallowedTools`, and
   `maxTurns`.
3. Invocation respects `simple task mode` and never reads outside the declared
   touch-set.
4. Feature flag `pancreator.yaml: runner.cursor.invocation: manual | sdk` selects
   workflow; default remains `manual` until the conformance suite is green.
5. Run-log fragment carries OpenInference + OTel GenAI attributes per the run-log
   schema handbook.

### WP-C — `pipeline-langgraph-stategraph-compiler`

1. `compilePipeline(yaml)` returns a `StateGraph` with one node per stage and
   edges encoding `gate`, `loop`, and `circuit_breaker` directives.
2. Stage entry points emit OpenInference spans named per persona role.
3. Intervention nodes (`pause`, `reroute`, `abort`) compile as a single
   side-channel node so `@pancreator/intervention` does not maintain parallel
   state.
4. Compiler refuses unknown personas, unknown contract kinds, or
   `worktree: required` when `WorktreePool` is unavailable.
5. Five MVP pipeline YAML files compile cleanly and pass structural tests
   (entry → exit reachability, no orphan nodes, `circuit_breaker` honored).
6. Existing `executePipeline` callers migrate to the compiled graph in the same
   change set.

### WP-D — `run-logger-phoenix-conformance` (option A preferred; option B allowed)

**Option A — conformance smoke tests**

1. Docker-based smoke test under `tests/run-logger-conformance/` boots local
   Phoenix, replays a sample run log, and asserts expected span hierarchy.
2. CI runs the smoke test on PRs touching `@pancreator/run-logger` (path-filtered).
3. Second smoke test demonstrates Langfuse importer interchangeability.
4. Package README cites both smoke tests as conformance authority.

**Option B — formal deferral ADR**

1. `lib/memory/adr/0007-run-logger-phoenix-conformance-deferral.md` records the
   deferral in Nygard format with backlog linkage.
2. `pancreator.yaml` bootstrap evidence points at the ADR instead of a free-standing
   deferred note.
3. Deferred milestone is one of `M2`, `M3`, or `M5` with cited rationale.
4. KPI A20 is restated against the ratified milestone in `docs/PRD.summary.md`.

### WP-E — `library-mode-script-example`

1. `examples/library-script/` contains `package.json`, single `index.mjs`
   (≤80 lines), and five-minute `README.md`.
2. Script parses a caller-supplied persona Markdown path, validates 16-field
   frontmatter, and emits `.cursor/agents/<name>.md` mirror and
   `.cursor/rules/<name>.mdc` shim to a temp directory.
3. Example uses only `@pancreator/persona` plus declared external peers.
4. CI builds and smoke-tests the example without touching the host repository.
5. README declares stability tier and SOTA conformance statement.

### WP-F — `pan-install-paths`

1. `pan init` runs `@pancreator/adopter-scan` in dry-run by default, surfaces
   per-file diffs, and refuses conflicts unless `--force`.
2. Scan report writes to `lib/memory/adoption/scan-<UTC-day>.md` and opens an
   inbox ratification item listing detected languages, frameworks, and proposed
   threshold-policy seeds.
3. `pan init --dry-run` is default; `--apply` required for writes outside
   adoption memory.
4. `npx create-pancreator <name>` creates a complete M1 scaffold (handbook seed
   pointers, `pancreator.yaml`, AGENTS.md, sample inbox directive, runnable
   `feature-delivery` walkthrough) independent of this repository's bootstrap
   layout.
5. Both paths are non-destructive; zero overwrites without explicit confirmation.

### Cross-cutting

- Delivery phasing SHALL respect harness-loop dependencies: WP-A and WP-B SHOULD
  land before or with WP-C; WP-C acceptance includes an end-to-end stub run
  against the SDK runner (WP-B).
- One delivery report covers all six work packages and records phasing,
  deferral choice (WP-D), and migration manifests.
- A compliance-auditor broad sweep validates zero stale references to removed
  stub behavior (`dryRun`, `{"status":"stub"}` for `pan init`) after the batch
  ships.

## Acceptance criteria

### WP-A — Checkpointer

- `pnpm --filter @pancreator/checkpointer-fs test` passes LangGraph conformance
  plus Pancreator metadata-extension tests.
- Round-trip integration test resumes from saved `checkpoint_id` without
  re-encoding metadata.

### WP-B — Runner

- Vitest suite invokes `CursorRunner.invoke` against a stub persona and asserts
  non-dry-run envelope with artifact path, OpenInference span shape, and
  touch-set bound.
- End-to-end smoke test runs one `feature-delivery` stage via SDK runner without
  manual paste.
- Feature flag default remains `manual` and is documented in persona-spec
  handbook.

### WP-C — Pipeline compiler

- `pnpm --filter @pancreator/pipeline test` covers compiler, intervention-node
  injection, and parse → compile → serialize → re-parse identity.
- LangGraph graph from `feature-delivery.yaml` reaches `report` stage on stub
  harness via SDK runner.

### WP-D — Run-logger conformance

- Either smoke tests pass in CI (option A), or ADR is ratified by
  LocalUserAuthorizer and `pancreator.yaml` updated (option B).
- `lib/memory/active/current.md` no longer carries Phoenix verification as an
  undated risk row.
- Option A vs B is recorded in the intake-analyst canonical spec.

### WP-E — Library-mode example

- `node examples/library-script/index.mjs path/to/persona.md` from outside the
  monorepo exits zero with two emitted files in a temp directory.
- Example never reads `lib/memory/`, `lib/inbox/`, or `pancreator.yaml`.
- README referenced from `docs/PRD.summary.md` as library-mode proof.

### WP-F — Install paths

- `pnpm -w exec pan init --dry-run` against standard example repos completes
  without writes outside `lib/memory/adoption/`.
- `pnpm -w exec pan init --apply` against empty directory installs M1 scaffold.
- `npx create-pancreator demo` produces runnable greenfield walkthrough whose
  `pan inbox` and `pan run feature-delivery` flow succeeds.

### Batch integration

- Harness loop (WP-A + WP-B + WP-C) demonstrably runs one `feature-delivery`
  stage end-to-end with checkpoint resume.
- Compliance-auditor broad sweep reports zero `block` findings tied to stub
  runner, stub init, or missing library-mode proof after delivery.

## Out of scope

- LangGraph `Send` API features that lag the TS runtime (Q16 deferral).
- Cohort orchestration / parallel-feature-delivery (M2).
- Full intervention spectrum beyond compiled side-channel node (M2).
- Sandbox-pool execution and container-sandbox install paths (M3).
- SQLite or Postgres checkpointer wrappers (M5+).
- Adopting observability tools beyond Phoenix and Langfuse (WP-D).
- OTLP HTTP transport replacing JSONL as default sink (WP-D).
- LangGraph or MCP-driven examples beyond library-script (PRD §11 deferral).
- Multi-primitive composition examples (M2+).
- Bidirectional sync to GitHub Issues / Linear (Q10 deferral).

## Recommended downstream owners

| Work package | Primary owners |
|---|---|
| WP-A — checkpointer | `tech-lead` (conformance contract); `pancreator-engineer` (implementation + vitest); `reviewer` (intervention integration) |
| WP-B — runner-cursor | `tech-lead` (feature-flag contract); `pancreator-engineer` (SDK wiring); `reviewer` (touch-set + disallowed-tool enforcement) |
| WP-C — pipeline compiler | `tech-lead` (YAML-to-graph ADR); `pancreator-engineer` (compiler + migration); `reviewer` (LangGraph pin discipline) |
| WP-D — run-logger | `tech-lead` (option A vs B); `pancreator-engineer` (smoke tests if A); `reviewer` (ratification + active-memory hygiene) |
| WP-E — library-script | `tech-lead` (primitive choice); `coder` (script + README); `reviewer` (no-horizontal-deps audit) |
| WP-F — install paths | `tech-lead` (adoption-report contract); `coder` (CLI + create-pancreator); `reviewer` (non-destructive guarantees) |
| Batch integration | `supervisor` (phasing + staged outcome); `intake-analyst` (canonical spec + WP-D choice); `compliance-auditor` (broad sweep) |
