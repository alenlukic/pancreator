---
title: pipeline package compiles YAML to LangGraph StateGraph
feature_id: pipeline-langgraph-stategraph-compiler
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:03Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/pipeline/
    note: executePipeline is currently an in-process sequential callback walker, not a StateGraph compiler.
  - kind: path
    path: docs/PRD.md
    note: §5, §7, and §10 prescribe that YAML pipelines compile to LangGraph.js StateGraph at runtime.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 3 step 5 names runner-cursor + pipeline as the package pair that closes the harness loop.
  - kind: path
    path: src/pipelines/feature-delivery.yaml
    note: The flagship pipeline definition exists in YAML but is never compiled to a graph.
---

# pipeline package compiles YAML to LangGraph StateGraph

## Problem

`@tesseract/pipeline` exposes `loadPipelineYaml`, `compilePipeline`, and
`executePipeline`, but the executor is a sequential async callback walker.
The PRD repeatedly states that the YAML DSL is human-facing and the runtime
is LangGraph.js `StateGraph`. Without the compiler, intervention semantics,
checkpointing, and conformance KPIs all decouple from the rest of the
LangGraph ecosystem.

## Goal

Replace the callback walker with a real `StateGraph` compiler so that loading
`feature-delivery.yaml` produces a LangGraph graph that can be paused,
resumed, time-traveled, and instrumented through the standard LangGraph
primitives.

## Required outcomes

1. `compilePipeline(yaml)` returns a `StateGraph` instance with one node per
   stage and edges that encode the YAML `gate`, `loop`, and `circuit_breaker`
   directives.
2. Stage entry points emit OpenInference spans named per the persona role.
3. Intervention nodes (`pause`, `reroute`, `abort`) are compiled into every
   graph as a single side-channel node so `@tesseract/intervention` does not
   maintain a parallel state model.
4. The compiler refuses to load a pipeline whose stages reference an unknown
   persona, an unknown contract kind, or a `worktree: required` stage when
   `WorktreePool` is unavailable.
5. The five MVP pipeline YAML files compile cleanly and produce a graph that
   passes a basic structural test (entry → exit reachability, no orphan
   nodes, declared `circuit_breaker` honored).

## Acceptance criteria

- `pnpm --filter @tesseract/pipeline test` covers the compiler, the
  intervention-node injection, and the round-trip (parse → compile →
  serialize → re-parse) identity.
- A LangGraph graph compiled from `feature-delivery.yaml` runs against the
  Cursor SDK runner (gated by the runner-cursor intake item) and reaches
  the `report` stage on a stub persona harness.
- The package README cites the LangGraph version pin and the conformance
  suite that gates upgrades.
- Existing callers of `executePipeline` are migrated to the compiled graph
  in the same PR.

## Out of scope

- LangGraph `Send` API features that lag the TS runtime (Q16 deferral).
- Cohort orchestration / parallel-feature-delivery (M2 scope).

## Recommended downstream owners

- `tech-lead` for the compiler contract and YAML-to-graph mapping ADR.
- `tesseract-engineer` for the implementation, intervention-node injection,
  and structural test harness.
- `reviewer` for the LangGraph-version-pin discipline and the migration of
  `executePipeline` callers.
