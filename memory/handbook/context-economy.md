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
    path: memory/handbook/index.md
    range: [53, 72]
    contentHash: 9c4824455c19cd39e623ebb93bb81688a7fd9530e9f6f07fdcb1b5c405b49663
    note: Handbook index defines retrieval policy and routing table maintenance rules.
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [288, 352]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Context-economy acceptance criteria include tier routing and simple task mode.
  - kind: lines
    path: memory/handbook/glossary.md
    range: [205, 226]
    contentHash: 31546d19f1cabd2d82e88353fbc8a3d67f1b5b5a97f2b28734841d7103b5446f
    note: Glossary defines active-memory and related tier nouns used here.
related:
  - /memory/handbook/index.md
  - /memory/handbook/memory-tiers.md
  - /memory/handbook/glossary.md
  - /memory/active/current.md
  - /PRD.summary.md
  - /PRD.index.md
---

# Context economy and Cursor retrieval

## Default retrieval discipline

Agents and operators SHOULD load the smallest surface that resolves the task:

1. Read `AGENTS.md` first for the working agreement and workspace map.
2. Read `PRD.summary.md` for default product orientation on routine tasks.
3. Read `memory/active/current.md` when the task needs current Feature pointers
   inside **active-memory**.
4. Read `memory/handbook/index.md` and follow at most one primary route plus
   stated secondaries.
5. Read full `PRD.md` only when the task requires product-spec detail, citation
   repair, or line-anchored requirements (see `PRD.index.md`).
6. Read `BOOTSTRAP.md` when the task is phase-boundary, exit-criterion, or
   bootstrap-sequence work.

`PRD.summary.md` remains the default low-detail product orientation surface.

Agents MUST NOT read, traverse, ingest, cite, or modify files under
`/inbox/notes/` per inbox lifecycle.

## Memory-tier routing

This section states canonical routing cited at
`{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [288, 312], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

When an agent asks what the memory tiers mean, the agent SHALL open
`memory/handbook/memory-tiers.md` before loading broader `memory/` trees.

When an agent asks what is actively coordinated now, the agent SHALL open
`memory/active/current.md` unless `simple task mode` blocks the read.

When an agent selects default memory orientation, the agent SHALL treat
`memory/active/**` as the only **active-memory** tier intended for routine
default orientation among Memory paths.

When an agent selects **archival-memory**, the agent SHALL treat `work/**` as
archival memory and explicit-read only.

When an agent loads **internal-operating-content**, the agent SHALL load named
routes only and SHALL NOT sweep entire handbook, persona, skill, or Cursor rule
trees without justification.

When an agent expands context into **durable-memory** Feature specs, the agent
SHALL record task-specific justification in the operator thread or run log.

When an agent reads full `PRD.md`, `BOOTSTRAP.md`, or archival run artifacts,
the agent SHALL record task-specific justification in the operator thread or
run log.

## Indexed versus explicit-read surfaces

The repository root `.cursorindexingignore` file declares paths agents SHOULD
treat as low default indexing value.

Exclusion from default indexing MUST NOT mean deletion or secrecy: humans and
agents SHALL still open excluded files with explicit paths or editor
attachments when the task requires them.

Typical explicit-read surfaces include:

- Full `PRD.md` for deep spec work.
- `BOOTSTRAP.md` for bootstrap phase gates.
- Selected `work/**` artifacts for plan, review, run logs, and delivery slices.
- `memory/features/**` for Feature specs, contracts, and delivery reports when
  the named Feature is in scope.

## `simple task mode`

This subsection is the canonical definition for `simple task mode` per plan
decision D1 at
`{kind: lines, path: work/173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When a task executes under `simple task mode`, agents SHALL treat the posture as
the default for low-risk mechanical work.

When `simple task mode` applies, the mode SHALL cover small code edits, lint
invocations, typecheck invocations, build invocations, test invocations,
dependency inspection, file lookup, mechanical refactors, formatting fixes, and
repository maintenance that requires no product reasoning.

While `simple task mode` applies, an agent MUST NOT read `PRD.md`.

While `simple task mode` applies, an agent MUST NOT read `BOOTSTRAP.md`.

While `simple task mode` applies, an agent MUST NOT traverse `memory/**`.

While `simple task mode` applies, an agent MUST NOT traverse `work/**`.

While `simple task mode` applies, an agent MUST NOT load persona specs beyond
the persona the operator invoked.

While `simple task mode` applies, an agent MUST NOT invoke subagents unless the
operator request names a subagent explicitly.

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
4. The task requires historical artifact reconstruction.
5. Tests fail in a way that demands broader architectural diagnosis.
6. The operator explicitly requests broad repository analysis.

When an agent escalates model class or context surface out of `simple task
mode`, the agent SHALL summarize escalation rationale in `run.log.jsonl` or in
the operator-visible response body.

## Model and context escalation guidance

This subsection is the canonical escalation guidance per plan decision D4 at
`{kind: lines, path: work/173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

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

When an agent documents model policy here, the agent MUST NOT embed
provider-specific model identifiers because the repository lacks runtime model
selection wiring.

## Generated manifests and machine outputs

Agents SHOULD treat **generated-machine-artifact** JSON manifests, migration
dry-run outputs, and bulk index JSON under `memory/**` as machine-oriented.

Operators SHOULD rely on summaries, runbooks, and Feature `spec.md` artifacts
for human decisions unless debugging a specific generator.

## When to read specific documents

| Need | Primary read | Notes |
|------|----------------|-------|
| Ubiquitous language | `memory/handbook/glossary.md` | Resolve every domain noun before authoring contracts or specs. |
| Routing handbook pages | `memory/handbook/index.md` | Avoid loading the full handbook tree by default. |
| Memory-tier taxonomy | `memory/handbook/memory-tiers.md` | Defines **active-memory**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Active-memory pointers | `memory/active/current.md` | Summaries only; follow links into durable or archival tiers. |
| Product intent at low detail | `PRD.summary.md` | Orientation only; not a substitute for `PRD.md` when citations need line anchors. |
| Section-level PRD routing | `PRD.index.md` | Picks which `PRD.md` section to open next. |
| Feature implementation | `memory/features/<id>/spec.md` | Canonical Engineering Spec for that Feature. |
| Bootstrap sequencing | `BOOTSTRAP.md` | Phase inputs, outputs, and exit criteria. |
| Governance and policy artifacts | `memory/handbook/policy-compliance-contract.md`, `memory/handbook/documentation-impact-contract.md` | Required for governed commits and post-task documentation decisions. |

## Operator maintenance

When `.cursorindexingignore` changes, the operator SHOULD restart or reindex Cursor and SHOULD verify custom agent discovery if `.cursor/agents/**` remains excluded.

The operator SHOULD run `pnpm run context:budget` (or `node tools/context-budget-report.mjs`) before and after policy changes to capture directional corpus size estimates.
