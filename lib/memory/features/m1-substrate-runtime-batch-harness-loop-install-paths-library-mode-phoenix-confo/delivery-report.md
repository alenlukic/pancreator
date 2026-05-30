---
title: M1 substrate runtime batch - harness loop, install paths, library mode, Phoenix conformance
slug: m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
stability: experimental
references:
  - kind: lines
    path: lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
    range: [56, 75]
    contentHash: "1423c7f"
  - kind: lines
    path: work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/plan.md
    range: [3, 16]
    contentHash: "b6f7653"
  - kind: lines
    path: work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/adr-draft.md
    range: [12, 31]
    contentHash: "cca921b"
  - kind: lines
    path: work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md
    range: [8, 109]
    contentHash: "0adaa4a"
  - kind: lines
    path: work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/review.md
    range: [5, 34]
    contentHash: "721e067"
---

# Summary

This batch shipped the harness-loop core and the operator surfaces around it: a LangGraph-backed pipeline compiler and execution path, SDK-flagged runner invocation with `manual` still the default, Phoenix-only run-logger conformance, a library-mode proof, and non-destructive install paths. The review passed, and the remaining M1 deferral is additional observability-backend verification in M2.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md",
  "range": [56, 75],
  "contentHash": "1423c7f"
}
```

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md",
  "range": [8, 20],
  "contentHash": "dc676b0"
}
```

# Architecture

- The batch preserved the intended phase order: WP-A and WP-B land before WP-C, and WP-D, WP-E, and WP-F are parallelized only after that gate clears.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/plan.md",
  "range": [3, 16],
  "contentHash": "b6f7653"
}
```

- `runner.cursor.invocation` stays `manual` by default, while `sdk` is an explicit opt-in path that propagates persona model and tool constraints into the Cursor SDK transport.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.ts",
  "range": [17, 75],
  "contentHash": "5ff594a"
}
```

- WP-D ships the Phoenix-only Option A smoke path with a path-filtered workflow, and it defers additional backend verification to M2 instead of widening the M1 observability contract.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/adr-draft.md",
  "range": [12, 31],
  "contentHash": "cca921b"
}
```

- The feature-delivery ledger still owns human gates and artifact handoffs, so `report` remains a single-file handoff into `ship`, not a changelog-shaped summary.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [946, 1040],
  "contentHash": "69c9245"
}
```

# Interfaces

- `CursorRunner.invoke` now returns a resolved envelope that carries the stage prompt path, artifact path, task ledger, and run-log fragment, and it attaches `sdkResult` when the `sdk` path is active.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.ts",
  "range": [27, 75],
  "contentHash": "5ff594a"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.test.ts",
  "range": [28, 77],
  "contentHash": "2bd723f"
}
```

- `compilePipeline` now emits a `StateGraph` with one node per stage plus a single `__intervention__` side-channel node, and `executePipeline` consumes the compiled graph instead of walking YAML directly.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/compile.ts",
  "range": [33, 126],
  "contentHash": "4b61fab"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/pipeline/lib/pipeline.test.ts",
  "range": [29, 131],
  "contentHash": "9d4360d"
}
```

- `parseAndRun` now owns the CLI surface for `run`, `feature new`, `advance`, `refresh-prompt`, `close-artifacts`, `init`, and `create-pancreator`, and the install-path verbs keep the deferred-envelope behavior only where the stage contract still requires it.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.ts",
  "range": [183, 284],
  "contentHash": "283c1e3"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [706, 742],
  "contentHash": "39d956c"
}
```

- `startFeatureDelivery` now writes `state.json`, `handoff.md`, `next-prompt.md`, and `run.log.jsonl`, and it accepts both bucket-relative inbox paths and full `lib/inbox/in/...` paths.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [228, 324],
  "contentHash": "2382654"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [74, 177],
  "contentHash": "a6f0e2d"
}
```

# Tradeoffs

- The batch keeps `manual` as the baseline runner mode, because the implementation only turns on SDK transport behind an explicit flag and the review accepted that as the stability-first path.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/adr-draft.md",
  "range": [12, 31],
  "contentHash": "cca921b"
}
```

- The batch rejects broader M1 observability parity and keeps the second backend in M2, which keeps the Phoenix smoke suite bounded and makes the CI trigger path simpler to reason about.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md",
  "range": [56, 75],
  "contentHash": "1423c7f"
}
```

- The reviewer accepted one mild startup inefficiency: `startFeatureDelivery` currently compiles the pipeline and discards the compiled graph value, which is non-blocking but still worth trimming later.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/review.md",
  "range": [5, 34],
  "contentHash": "721e067"
}
```

- Documentation impact stayed bounded in the implement pass: the prior re-entry already covered `docs/PRD.summary.md`, the conformance docs, and the run-logger README, so the report stage needed no extra spec edits.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md",
  "range": [106, 109],
  "contentHash": "a2934a1"
}
```

- Traceability drift remains a follow-on risk because several changed implementation files sit outside the declared touch-set.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/review.md",
  "range": [5, 34],
  "contentHash": "721e067"
}
```

- The remaining backlog item is explicit: M2 carries the additional backend verification that M1 deferred.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/adr-draft.md",
  "range": [12, 31],
  "contentHash": "cca921b"
}
```

# Usage guidelines

1. Run `pnpm -w exec pan run feature-delivery 172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md` from the repository root when you want the harness loop to create `state.json`, `handoff.md`, `next-prompt.md`, and `run.log.jsonl` for the intake stage.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [74, 114],
  "contentHash": "a6f0e2d"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [228, 324],
  "contentHash": "2382654"
}
```

2. Run `pnpm -w exec pan init --dry-run` when you want a non-writing scaffold preview, `pnpm -w exec pan init --apply` when you want actual writes, and `pnpm -w exec pan create-pancreator demo` when you want a greenfield workspace scaffold.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [706, 742],
  "contentHash": "39d956c"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.ts",
  "range": [204, 247],
  "contentHash": "7adb7c4"
}
```

3. Run `pnpm test:run-logger-conformance` when you want the Phoenix smoke suite to boot Docker, wait for `http://127.0.0.1:6006/health`, replay the sample trace, and tear down cleanly; when Docker is absent, the suite logs an explicit skip reason and exits successfully.

```json
{
  "kind": "lines",
  "path": "tests/run-logger-conformance/phoenix-smoke.test.mjs",
  "range": [12, 89],
  "contentHash": "3e9ecff"
}
```

```json
{
  "kind": "lines",
  "path": "tests/run-logger-conformance/README.md",
  "range": [3, 27],
  "contentHash": "76c3a37"
}
```

4. Run `pnpm -w exec pan advance <taskId> --artifact lib/memory/features/<id>/delivery-report.md` after human acceptance when you want the pipeline to move from `report` to `ship`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts",
  "range": [1037, 1040],
  "contentHash": "da87c35"
}
```

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/run.test.ts",
  "range": [353, 420],
  "contentHash": "8c9a636"
}
```

# Testing

The validation delta is command-level, not numeric: the implementation report records passing package suites for `@pancreator/checkpointer-fs`, `@pancreator/runner-cursor`, `@pancreator/intervention`, `@pancreator/pipeline`, `@pancreator/cli`, `@pancreator/run-logger`, and `@pancreator/persona`, plus `pnpm test:run-logger-conformance`, `node --test tests/*.test.mjs`, `node lib/internal/tools/check-phase-0a-scaffold.mjs`, `node lib/internal/tools/context-budget-report.mjs`, and `bash -n .cursor/hooks/enforce-policy-compliance.sh`. The review agrees that the gate passes, but it also notes that changed-line coverage is not emitted yet, so there is no coverage-number delta to quote.

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md",
  "range": [48, 69],
  "contentHash": "3844cc0"
}
```

```json
{
  "kind": "lines",
  "path": "work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/review.md",
  "range": [5, 34],
  "contentHash": "721e067"
}
```
