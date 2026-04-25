---
title: Ratify Documentation Impact Contract Check
seq: "0004"
status: proposed
date: 2026-04-25
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: AGENTS.md
    range: [18, 29]
    contentHash: TBD-on-commit
    note: "AGENTS canon table defines handbook seeds as authoritative references."
  - kind: lines
    path: AGENTS.md
    range: [74, 95]
    contentHash: TBD-on-commit
    note: "AGENTS working agreement defines global norms that apply to every task."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: TBD-on-commit
    note: "Layer 1 style requires RFC 2119 keywords in normative clauses."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [114, 124]
    contentHash: TBD-on-commit
    note: "Layer 1 style forbids weasel words and requires atomic language."
  - kind: lines
    path: PRD.md
    range: [839, 839]
    contentHash: TBD-on-commit
    note: "PRD contract discipline requires gates to be enforceable and explicit."
---

## Context

Tesseract task execution regularly changes artifacts, paths, and behavior
descriptions. Without an explicit per-task documentation-impact check, agents
can land implementation changes that leave references, indexes, or operator
guidance stale. That drift increases handoff risk and weakens phase-gate
review quality.

The repository already treats handbook pages and AGENTS norms as canonical
operator guidance. A global requirement is needed so every agent performs a
deterministic decision on whether documentation and reference updates apply.

## Decision

Every agent SHALL evaluate documentation/reference impact after each completed
task and SHALL record a decision with:

- `applies: true|false`
- rationale
- changed-surfaces list
- deferred-items list (when any deferred work exists)

Decision rule:

- `applies=true` when the task introduces or changes artifacts, references,
  structures, workflows, or domain understanding that materially affect agent
  or operator interpretation.
- `applies=false` only when no such impact exists; the rationale MUST state why
  no documentation or reference surface changed.

When `applies=true`, the agent MUST execute these minimum actions:

1. Update relevant docs, indexes, specs, and manuals affected by the task.
2. Update references/citations for any moved, renamed, or deleted artifact.
3. Add or update a backlog item when any required documentation/reference
   implementation is deferred.

When a required action is deferred, the decision record SHALL include the
deferral rationale and backlog linkage so follow-up remains auditable.

## Status

Status is proposed on 2026-04-25 and awaits human ratification at the next
bootstrap phase boundary.

## Consequences

- positive: Every task now includes a deterministic documentation-impact gate.
- positive: Reference integrity for moved/renamed/deleted artifacts becomes
  explicit and reviewable.
- negative: Agents must spend additional effort on post-task impact evaluation
  and decision capture.
- negative: Deferrals now require explicit backlog maintenance and rationale.
- neutral: This ADR defines policy and recording behavior; it does not enforce
  the policy through automation yet.
