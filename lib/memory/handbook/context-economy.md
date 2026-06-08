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
    contentHash: a29b04a
    note: AGENTS defines the primary entry contract and canon table including PRD routing.
  - kind: lines
    path: lib/memory/handbook/index.md
    range: [53, 72]
    contentHash: 9c48244
    note: Handbook index defines retrieval policy and routing table maintenance rules.
  - kind: lines
    path: lib/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [288, 352]
    contentHash: e6c4fcd
    note: Context-economy acceptance criteria include tier routing and simple task mode.
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [205, 226]
    contentHash: 31546d1
    note: Glossary defines active-memory and related tier nouns used here.
related:
  - /lib/memory/handbook/index.md
  - /lib/memory/handbook/memory-tiers.md
  - /lib/memory/handbook/glossary.md
  - /lib/memory/active/current.md
  - /lib/memory/active/handoffs.md
  - /docs/PRD.summary.md
  - /docs/PRD.index.md
  - /docs/M1.index.md
  - /lib/memory/handbook/context-cost-audit.md
---

# Context economy and Cursor retrieval

## Default retrieval discipline

Agents and operators SHOULD load the smallest surface that resolves the task:

1. Read the **agent operating card** first: `AGENTS.md` (self-host) or
   `.pancreator/AGENTS.md` (embedded).
2. Read `lib/memory/active/current.md` when the task needs current Feature pointers
   inside **active-memory** and `simple task mode` does not apply.
3. Read `OPERATION.md` when the task needs human operator procedure context.
4. Read `lib/memory/handbook/index.md` and follow at most one primary route plus
   stated secondaries.

**Internal product docs** (`docs/**`): read only for Pancreator self-development
or meta-persona tasks. Route through `docs/PRD.summary.md` and `docs/PRD.index.md`
before full `docs/PRD.md` or `docs/BOOTSTRAP.md`. Feature-delivery stage personas
MUST NOT load `docs/**` unless the bounded prompt names an internal task.

Agents MUST NOT read, traverse, ingest, cite, or modify files under
`/lib/inbox/notes/` per inbox lifecycle.

## Memory-tier routing

This section states canonical routing cited at
`{kind: lines, path: lib/memory/features/active-memory-context-economy-pass-2/spec.md, range: [288, 312], contentHash: e6c4fcd}`.

When an agent asks what the memory tiers mean, the agent SHALL open
`lib/memory/handbook/memory-tiers.md` before loading broader `lib/memory/` trees.

When an agent asks what is actively coordinated now, the agent SHALL open
`lib/memory/active/current.md` unless `simple task mode` blocks the read.

When an agent selects default memory orientation, the agent SHALL treat
`lib/memory/active/**` as the only **active-memory** tier intended for routine
default orientation among Memory paths.

When an agent selects **active-work**, the agent SHALL treat `work/**` as
active run workspace and explicit-read only by default.

When an agent selects **archival-memory**, the agent SHALL treat
`archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, and
`lib/inbox/threads/**` as archival memory and explicit-read only.

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

- Internal `AGENTS.md` and entire `docs/**` tree, including `docs/README.md`
  (Pancreator product development; explicit-read only).
- `lib/memory/adr/`, `lib/memory/backlog/`, `lib/memory/research/`, `tests/**`.
- Full `docs/PRD.md` and `docs/BOOTSTRAP.md` after compact internal routes.
- Selected `work/**` artifacts for active-run handling.
- Selected `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`,
  and `lib/inbox/threads/**` artifacts for historical reconstruction.
- `lib/memory/features/**` for Feature specs, contracts, and delivery reports when
  the named Feature is in scope.

## `simple task mode`

This subsection is the canonical definition for `simple task mode` per plan
decision D1 at
`{kind: lines, path: archive/work/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6}`.

When a task executes under `simple task mode`, agents SHALL treat the posture as
the default for low-risk mechanical work.

When `simple task mode` applies, the mode SHALL cover small code edits, lint
invocations, typecheck invocations, build invocations, test invocations,
dependency inspection, file lookup, mechanical refactors, formatting fixes, and
repository maintenance that requires no product reasoning.

While `simple task mode` applies, an agent MUST NOT read internal `AGENTS.md`.

While `simple task mode` applies, an agent MUST NOT read `docs/PRD.md`.

While `simple task mode` applies, an agent MUST NOT read `docs/BOOTSTRAP.md`.

While `simple task mode` applies, an agent MUST NOT traverse `lib/memory/**`.

While `simple task mode` applies, an agent MUST NOT traverse `work/**` or
`archive/work/**`.

While `simple task mode` applies, an agent MUST NOT load persona specs beyond
the persona the operator invoked.

While `simple task mode` applies, an agent MUST NOT invoke subagents unless the
operator request names a subagent explicitly. When a named subagent is required,
the agent MUST invoke the canonical `.cursor/agents/<name>.md` projection for
that persona.

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
live at `work/<day>/<task-id>/handoff.md` for active runs, the generated
subagent prompt SHALL live at `work/<day>/<task-id>/next-prompt.md`, and
active memory SHALL store only a pointer in `lib/memory/active/handoffs.md`.

A handoff card SHOULD include the Feature id, current stage, planner persona,
executor persona, upstream artifact paths, in-scope paths, explicit non-goals,
validation commands, known pre-existing failures, and unresolved blockers.

When a parent agent invokes an executor, the parent SHOULD pass the generated
`next-prompt.md` path or its contents as the initial payload. The parent SHALL
pass the operator-supplied task text or generated prompt verbatim and SHALL NOT
paraphrase, summarize, or inject inferred intent, assumptions, or interpretation
into the executor prompt. The parent SHALL NOT paste full PRD sections, handbook
pages, archival artifacts, feature specs, prior chat transcripts, broad directory
listings, or planner scratch notes into the executor prompt unless the generated
prompt names the exact file. This handoff fidelity requirement mirrors the
`AGENTS.md` §5 delegation policy.

When an agent runs SDK-mode feature-delivery CLI commands from chat on the
operator's behalf, the agent SHALL relay stderr progress to the operator chat
surface: set `PAN_FD_PROGRESS=ndjson`, watch for `feature_delivery_progress`
events, and post concise status on each `stage_enter`, `stage_transition`,
`heartbeat`, and `stage_complete` before the command finishes. See
`AGENTS.md` §5. Operators in a TTY receive `[pan fd] …` on stderr automatically;
see `OPERATION.md` § SDK mode.

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
`{kind: lines, path: archive/work/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [36, 42], contentHash: 58bbab6}`.

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
dynamic model selection for Cursor subagents. Each persona has one canonical
projection at `.cursor/agents/<name>.md`; model class is set in that file's
frontmatter unless the operator overrides it in the invocation.

## Generated manifests and machine outputs

Agents SHOULD treat **generated-machine-artifact** JSON manifests, migration
dry-run outputs, and bulk index JSON under `lib/memory/**` as machine-oriented.

Operators SHOULD rely on summaries, runbooks, and Feature `spec.md` artifacts
for human decisions unless debugging a specific generator.

## When to read specific documents

| Need | Primary read | Notes |
|------|----------------|-------|
| Ubiquitous language | `lib/memory/handbook/glossary.md` | Resolve every domain noun before authoring contracts or specs. |
| Routing handbook pages | `lib/memory/handbook/index.md` | Avoid loading the full handbook tree by default. |
| Memory-tier taxonomy | `lib/memory/handbook/memory-tiers.md` | Defines **active-memory**, **active-work**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Active-memory pointers | `lib/memory/active/current.md` | Summaries only; follow links into durable or archival tiers. |
| Planning/execution handoffs | `lib/memory/active/handoffs.md` | Pointer-only map for active handoff cards under `work/<day>/<task-id>/handoff.md`. |
| Agent operating card | `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded) | Cross-tool agent contract; explicit-read on self-host. |
| Human operator procedures | `OPERATION.md` | Human-only; indexed external surface. |
| Product intent (internal) | `docs/PRD.summary.md` | Pancreator self-dev only; explicit-read by default indexing policy. |
| Section-level PRD routing (internal) | `docs/PRD.index.md` | Pancreator self-dev only. |
| M1 and bootstrap routing (internal) | `docs/M1.index.md` | Pancreator self-dev only. |
| Subagent invocation and model escalation | `lib/memory/handbook/context-economy.md` §“Model and context escalation guidance” | One canonical `.cursor/agents/<name>.md` per persona; escalate model class per documented triggers. |
| Feature implementation | `lib/memory/features/<id>/spec.md` | Canonical Engineering Spec for that Feature. |
| Bootstrap phase authority | `docs/BOOTSTRAP.md` | Open only when compact M1 routing is insufficient. |
| Governance and documentation-impact | `lib/memory/handbook/documentation-impact-contract.md`, `lib/memory/handbook/constitution.md` | Required for post-task documentation decisions; optional `/pr-writer` for PR bodies. |

## Operator maintenance

After clone, embedded init, or edits to `lib/personas/` (including
`lib/personas/rules/`), the
operator SHOULD run `pnpm -w exec pan cursor-sync` to materialize the local
`.cursor/` tree before invoking subagents.

When `.cursorindexingignore` changes, the operator SHOULD restart or reindex Cursor and SHOULD verify custom agent discovery if `.cursor/agents/**` remains excluded. The operator SHOULD also verify each persona's `.cursor/agents/<name>.md` appears in Cursor after sync.

The operator SHOULD run `pnpm run context:budget` (or `node lib/internal/tools/context-budget-report.mjs`) before and after policy changes to capture directional corpus size estimates.
