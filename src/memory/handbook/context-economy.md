---
title: Context economy and Cursor retrieval
slug: context-economy
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Default discipline for AI context, Cursor indexing, and explicit document
  retrieval so routine tasks avoid loading the full durable-memory and work
  artifact surface.
references:
  - kind: lines
    path: AGENTS.md
    range: [1, 36]
    contentHash: a29b04a32dc62da25ff1af024cca7ff74cc5fe3c76a2be301a7e391c4b56a0e1
    note: AGENTS defines the primary entry contract and canon table including PRD routing.
  - kind: lines
    path: src/memory/handbook/index.md
    range: [53, 72]
    contentHash: 9c4824455c19cd39e623ebb93bb81688a7fd9530e9f6f07fdcb1b5c405b49663
    note: Handbook index defines retrieval policy and routing table maintenance rules.
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [288, 352]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Context-economy acceptance criteria include tier routing and simple task mode.
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [205, 226]
    contentHash: 31546d19f1cabd2d82e88353fbc8a3d67f1b5b5a97f2b28734841d7103b5446f
    note: Glossary defines active-memory and related tier nouns used here.
related:
  - /src/memory/handbook/index.md
  - /src/memory/handbook/memory-tiers.md
  - /src/memory/handbook/glossary.md
  - /src/memory/active/current.md
  - /src/memory/active/handoffs.md
  - /docs/PRD.summary.md
  - /docs/PRD.index.md
  - /docs/M1.index.md
  - /src/memory/handbook/subagent-model-tiers.md
  - /src/memory/handbook/context-cost-audit.md
---

# Context economy and Cursor retrieval

## Default retrieval discipline

Agents and operators SHOULD load the smallest surface that resolves the task:

1. Read `AGENTS.md` first for the working agreement and workspace map.
2. Read `src/memory/active/current.md` when the task needs current Feature pointers
   inside **active-memory** and `simple task mode` does not apply.
3. Read `docs/M1.index.md` for M1/bootstrap routing before full `docs/BOOTSTRAP.md`.
4. Read `docs/PRD.summary.md` and `docs/PRD.index.md` for product orientation before full
   `docs/PRD.md`.
5. Read `src/memory/handbook/index.md` and follow at most one primary route plus
   stated secondaries.
6. Read full `docs/PRD.md` or `docs/BOOTSTRAP.md` only when the task requires
   authoritative wording, scope change, citation repair, line-anchored
   requirements, or phase-exit detail.

`docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/M1.index.md` remain the default
low-detail product and milestone orientation surfaces.

Agents MUST NOT read, traverse, ingest, cite, or modify files under
`/src/inbox/notes/` per inbox lifecycle.

## Memory-tier routing

This section states canonical routing cited at
`{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [288, 312], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

When an agent asks what the memory tiers mean, the agent SHALL open
`src/memory/handbook/memory-tiers.md` before loading broader `src/memory/` trees.

When an agent asks what is actively coordinated now, the agent SHALL open
`src/memory/active/current.md` unless `simple task mode` blocks the read.

When an agent selects default memory orientation, the agent SHALL treat
`src/memory/active/**` as the only **active-memory** tier intended for routine
default orientation among Memory paths.

When an agent selects **active-work**, the agent SHALL treat `src/work/**` as
active run workspace and explicit-read only by default.

When an agent selects **archival-memory**, the agent SHALL treat
`src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, and
`src/inbox/threads/**` as archival memory and explicit-read only.

When an agent loads **internal-operating-content**, the agent SHALL load named
routes only and SHALL NOT sweep entire handbook, persona, skill, or Cursor rule
trees without justification.

When an agent expands context into **durable-memory** Feature specs, the agent
SHALL record task-specific justification in the operator thread or run log.

When an agent reads full `docs/PRD.md`, `docs/BOOTSTRAP.md`, or archival run artifacts,
the agent SHALL record task-specific justification in the operator thread or
run log.

## Indexed versus explicit-read surfaces

The repository root `.cursorindexingignore` file declares paths agents SHOULD
treat as low default indexing value.

Exclusion from default indexing MUST NOT mean deletion or secrecy: humans and
agents SHALL still open excluded files with explicit paths or editor
attachments when the task requires them.

Typical explicit-read surfaces include:

- Full `docs/PRD.md` for deep spec work after `docs/PRD.summary.md` and `docs/PRD.index.md`.
- Full `docs/BOOTSTRAP.md` for bootstrap phase gates after `docs/M1.index.md`.
- Selected `src/work/**` artifacts for active-run handling.
- Selected `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`,
  and `src/inbox/threads/**` artifacts for historical reconstruction.
- `src/memory/features/**` for Feature specs, contracts, and delivery reports when
  the named Feature is in scope.

## `simple task mode`

This subsection is the canonical definition for `simple task mode` per plan
decision D1 at
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When a task executes under `simple task mode`, agents SHALL treat the posture as
the default for low-risk mechanical work.

When `simple task mode` applies, the mode SHALL cover small code edits, lint
invocations, typecheck invocations, build invocations, test invocations,
dependency inspection, file lookup, mechanical refactors, formatting fixes, and
repository maintenance that requires no product reasoning.

While `simple task mode` applies, an agent MUST NOT read `docs/PRD.md`.

While `simple task mode` applies, an agent MUST NOT read `docs/BOOTSTRAP.md`.

While `simple task mode` applies, an agent MUST NOT traverse `src/memory/**`.

While `simple task mode` applies, an agent MUST NOT traverse `src/work/**` or
`src/internal/work_archive/**`.

While `simple task mode` applies, an agent MUST NOT load persona specs beyond
the persona the operator invoked.

While `simple task mode` applies, an agent MUST NOT invoke subagents unless the
operator request names a subagent explicitly. When a named subagent is required,
the agent MUST choose the `*-standard` Cursor variant unless the operator names
the complex tier.

While `simple task mode` applies, an agent MUST inspect only directly relevant
files.

While `simple task mode` applies, an agent MUST prefer exact paths over broad
codebase search.

While `simple task mode` applies, an agent MUST prefer the cheapest model tier
that reliably completes the task.

When any trigger below becomes true, an agent SHALL exit `simple task mode`
before expanding context or upgrading models:

1. The task changes product behavior.
2. The task changes pipeline or persona semantics.
3. The task touches policy or compliance behavior.
4. The task requires active run artifact handling or historical artifact reconstruction.
5. Tests fail in a way that demands broader architectural diagnosis.
6. The operator explicitly requests broad repository analysis.

When an agent escalates model class or context surface out of `simple task
mode`, the agent SHALL summarize escalation rationale in `run.log.jsonl` or in
the operator-visible response body.


## Planning/execution handoff discipline

When a task requires both planning and execution, the planning agent SHALL
produce a bounded handoff card before execution starts. The handoff card SHALL
live at `src/work/<day>/<task-id>/handoff.md` for active runs, the generated
subagent prompt SHALL live at `src/work/<day>/<task-id>/next-prompt.md`, and
active memory SHALL store only a pointer in `src/memory/active/handoffs.md`.

A handoff card SHOULD include the Feature id, current stage, planner persona,
executor persona, upstream artifact paths, in-scope paths, explicit non-goals,
validation commands, known pre-existing failures, and unresolved blockers.

When a parent agent invokes an executor, the parent SHOULD pass the generated
`next-prompt.md` path or its contents as the initial payload. The parent SHOULD
NOT paste full PRD sections, handbook pages, archival artifacts, feature specs,
prior chat transcripts, broad directory listings, or planner scratch notes into
the executor prompt unless the generated prompt names the exact file.

When execution finds ambiguity that changes scope, touch-set, acceptance
criteria, or validation strategy, the executor SHALL stop and delegate back to
`tech-lead`, `reviewer`, or `supervisor` rather than extending a local repair
loop.

When a reviewer sends work back to implementation, the reviewer SHALL emit a
compact must-fix list and the supervisor SHALL choose one bounded re-entry target.
The supervisor SHOULD NOT ask the same executor to repeatedly re-read broad
context after equivalent failures.

## Model and context escalation guidance

This subsection is the canonical escalation guidance per plan decision D4 at
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When an agent selects models for routine mechanical work, the agent MUST NOT
treat Opus-class models as the default.

When `simple task mode` applies, the agent MUST select the cheapest model class
that still completes the task reliably.

When an agent escalates model class or context breadth for reasoning-heavy
work, the agent SHALL cite at least one of these triggers:

1. Ambiguous architecture decisions.
2. Policy reasoning that binds governance contracts.
3. Cross-cutting refactors across multiple packages or pipelines.
4. High-risk reasoning where mistakes threaten safety or compliance.

When an agent escalates model class or context breadth, the agent MUST state the
escalation rationale in the same operator-visible response.

When an agent documents model policy here, the agent MUST NOT assume runtime
dynamic model selection for Cursor subagents. The repo exposes fixed standard
and complex Cursor projection files per `src/memory/handbook/subagent-model-tiers.md`.

## Generated manifests and machine outputs

Agents SHOULD treat **generated-machine-artifact** JSON manifests, migration
dry-run outputs, and bulk index JSON under `src/memory/**` as machine-oriented.

Operators SHOULD rely on summaries, runbooks, and Feature `spec.md` artifacts
for human decisions unless debugging a specific generator.

## When to read specific documents

| Need | Primary read | Notes |
|------|----------------|-------|
| Ubiquitous language | `src/memory/handbook/glossary.md` | Resolve every domain noun before authoring contracts or specs. |
| Routing handbook pages | `src/memory/handbook/index.md` | Avoid loading the full handbook tree by default. |
| Memory-tier taxonomy | `src/memory/handbook/memory-tiers.md` | Defines **active-memory**, **active-work**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Active-memory pointers | `src/memory/active/current.md` | Summaries only; follow links into durable or archival tiers. |
| Planning/execution handoffs | `src/memory/active/handoffs.md` | Pointer-only map for active handoff cards under `src/work/<day>/<task-id>/handoff.md`. |
| Product intent at low detail | `docs/PRD.summary.md` | Orientation only; not a substitute for `docs/PRD.md` when citations need line anchors. |
| Section-level PRD routing | `docs/PRD.index.md` | Picks which `docs/PRD.md` section to open next. |
| M1 and bootstrap routing | `docs/M1.index.md` | Prefer this before full `docs/BOOTSTRAP.md` or full `docs/PRD.md` for M1 work. |
| Subagent model tiering | `src/memory/handbook/subagent-model-tiers.md` | Defines standard/default and complex variants without requiring a fixed model solely from the file suffix. |
| Feature implementation | `src/memory/features/<id>/spec.md` | Canonical Engineering Spec for that Feature. |
| Bootstrap phase authority | `docs/BOOTSTRAP.md` | Open only when compact M1 routing is insufficient. |
| Governance and policy artifacts | `src/memory/handbook/policy-compliance-contract.md`, `src/memory/handbook/documentation-impact-contract.md` | Required for governed commits and post-task documentation decisions. |

## Operator maintenance

When `.cursorindexingignore` changes, the operator SHOULD restart or reindex Cursor and SHOULD verify custom agent discovery if `.cursor/agents/**` remains excluded. The operator SHOULD also verify `*-standard` and `*-complex` subagent variants appear in Cursor.

The operator SHOULD run `pnpm run context:budget` (or `node src/internal/tools/context-budget-report.mjs`) before and after policy changes to capture directional corpus size estimates.
