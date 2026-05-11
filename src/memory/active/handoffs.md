---
title: Active planning/execution handoff pointers
slug: active-memory-handoffs
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [supervisor, tech-lead]
purpose: |
  Pointer-only table for compact plan-to-execution handoffs so executor agents
  can start from bounded context instead of inheriting planner context.
related:
  - /src/memory/handbook/context-economy.md
  - /src/memory/handbook/subagent-model-tiers.md
  - /src/memory/active/current.md
  - /src/memory/active/runs.md
---

# Active planning/execution handoffs

When a pipeline crosses from planning to execution, the supervisor SHALL pass a
single handoff path to the next persona. This file SHALL keep pointers only; it
MUST NOT embed plan bodies, review bodies, generated manifests, or run logs.

## Handoff card shape

Each active run handoff card SHOULD live at `src/work/<day>/<task-id>/handoff.md`
and SHOULD contain only these fields:

1. Feature id and current stage.
2. Planner persona and executor persona.
3. Paths to upstream artifacts: `spec.md`, `plan.md`, `adr-draft.md`, and
   `touch-set.json` when present.
4. In-scope paths and explicit non-goals.
5. Validation commands and known pre-existing failures.
6. Open questions that block execution, if any.
7. Re-entry rule: delegate back to the planner, reviewer, or supervisor when
   scope changes instead of extending the executor loop.

## Active handoffs

| Run identifier | Handoff pointer | From | To | Status |
|---|---|---|---|---|
| *(none)* | *(none)* | *(none)* | *(none)* | *(none)* |

## Recent handoffs

| Run identifier | Handoff pointer | From | To | Outcome |
|---|---|---|---|---|
| *(none)* | *(none)* | *(none)* | *(none)* | *(none)* |
