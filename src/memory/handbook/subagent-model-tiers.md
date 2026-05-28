---
title: Subagent model tiers
slug: subagent-model-tiers
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [supervisor, persona-designer]
purpose: |
  Canonical policy for Cursor subagent variants where the runtime cannot select
  each delegated subagent model dynamically.
related:
  - /AGENTS.md
  - /src/memory/handbook/context-economy.md
  - /src/memory/handbook/persona-spec.md
---

# Subagent model tiers

Cursor subagent invocations select a fixed agent definition. The runtime cannot
reliably choose a different model for the same subagent at call time, so
Daedaline exposes two model tiers per persona.

## Tiers

| Tier | Naming | Model policy | Use when |
|---|---|---|---|
| Standard | `.cursor/agents/<persona>-standard.md` | economical default; `model: auto` preferred when appropriate, fixed model allowed after human ratification | bounded implementation, routine docs, simple task mode, known file sets |
| Complex | `.cursor/agents/<persona>-complex.md` | prior fixed model for that persona unless human-ratified policy changes it | ambiguous architecture, policy/compliance reasoning, broad audit, historical reconstruction, high-risk cross-cutting work |
| Alias | `.cursor/agents/<persona>.md` | backward-compatible standard default; `model: auto` preferred when appropriate | equivalent to standard unless an operator asks otherwise |

## General-purpose fallback

`.cursor/agents/general-purpose.md` is a standalone catch-all agent, not a
canonical persona projection. Use it when the operator is unsure which persona
owns the task, when a native Cursor projection is missing, or when bounded bridge
work is needed while infrastructure is still being built. Its first job is route
discovery: prefer delegating to an owner persona over doing broad implementation
inside the catch-all context.

## Delegation economics

Subagents save parent-context entropy. They do not automatically save total
tokens.

When a parent delegates to a subagent, the subagent receives an isolated context
window and does not inherit every parent file read, terminal dump, or reasoning
artifact. This is useful when the subagent can explore a bounded slice and
return a compact result.

Delegation is expensive when several subagents reload the same PRD, handbook,
archival, or generated context. A parent SHALL avoid fan-out over broad context
unless the work is genuinely parallel and bounded.


## Planning/execution boundary

A parent agent SHOULD treat the boundary between planning and execution as the
preferred delegation point. The planner emits a compact handoff card; the
executor receives that handoff path and starts in the standard tier unless a
complex-tier trigger is present.

A parent SHOULD NOT keep planning, implementation, and review inside one long
agent loop when a native subagent can execute the next bounded stage. When a
handoff would cause several agents to reload the same broad context, the parent
SHALL split the plan into smaller handoff cards or serialize the work.

## Default selection

A parent SHALL choose the standard tier by default.

A parent SHALL choose the complex tier only when at least one escalation trigger
is present:

1. The task changes product behavior or milestone scope.
2. The task changes persona, pipeline, policy, or compliance semantics.
3. The task requires broad repository audit or historical artifact
   reconstruction.
4. The standard tier failed and the failure indicates reasoning limits rather
   than missing context.
5. The operator explicitly asks for the complex tier.

When a parent escalates from standard to complex, the parent SHALL state the
reason in the operator-visible response or run log.

## Retrieval contract

Every Cursor subagent projection SHALL stay compact. Cursor projection files
SHALL point to canonical persona files under `src/personas/` instead of duplicating
persona prose, PRD references, or handbook excerpts.

A subagent SHALL read full `docs/PRD.md`, `docs/BOOTSTRAP.md`, durable Feature memory, or
archival run artifacts only when the task-specific trigger is present per
`src/memory/handbook/context-economy.md` and `docs/M1.index.md`.
