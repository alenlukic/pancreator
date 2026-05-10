---
title: Documentation Impact Contract
slug: documentation-impact-contract
stability: experimental
bootstrap-only: false
phase: 1
owners: [librarian, tech-writer, supervisor]
purpose: |
  The global per-task decision contract that requires every agent to evaluate
  documentation/reference impact, apply required updates when impact exists,
  and record explicit deferral rationale with backlog linkage when updates are
  deferred.
references:
  - kind: lines
    path: memory/adr/0004-documentation-impact-contract.md
    range: [66, 100]
    contentHash: d77cc5cf38a61e2dafc65da2672914ad5bf6fd55295f49786c9b213670085f57
    note: "ADR-0004 decision defines mandatory applies true/false decision and minimum actions."
  - kind: lines
    path: AGENTS.md
    range: [74, 95]
    contentHash: 3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14
    note: "AGENTS working agreement is the global policy surface for task-level obligations."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: e3a0718364e6034e0d4de4f29c6123a1d5d52ad90713fffe169b67b81a0ff2fe
    note: "Layer 1 requires RFC 2119 keywords in normative policy language."
  - kind: lines
    path: memory/handbook/backlog-format.md
    range: [56, 78]
    contentHash: a984b4c947288efa0b9a23cb1a145da2a273f2a702e6b6d385e10986869250a0
    note: "Backlog index schema defines required fields for deferred follow-up items."
related:
  - /memory/adr/0004-documentation-impact-contract.md
  - /memory/handbook/policy-compliance-contract.md
  - /memory/backlog/index.yaml
  - /memory/handbook/backlog-format.md
  - /AGENTS.md
---

# Documentation Impact Contract

This page defines the mandatory post-task check that every agent performs to
keep docs and references coherent with implementation state.

## 1 - Trigger conditions

The documentation-impact check SHALL run after every task. The check MUST treat
impact as applicable when any condition below is true:

- A new artifact is introduced and requires references, indexes, or guidance.
- A referenced artifact is renamed, moved, or deleted.
- Repository structure, workflow, or glossary-resolved entity behavior changes.
- Any change materially affects operator or agent understanding.

## 2 - Mandatory decision record

Each task SHALL produce a decision record with this shape:

```yaml
documentation_impact:
  applies: true|false
  rationale: <why this value applies>
  changed-surfaces:
    - <path or artifact id>
  deferred-items:
    - id: <backlog-item-id>
      rationale: <why deferred>
```

Decision constraints:

- `applies` MUST be exactly `true` or `false`.
- `rationale` MUST explain the decision in task-specific terms.
- `changed-surfaces` MUST list all touched or impacted documentation/reference
  surfaces; when none exist, the list SHOULD be empty.
- `deferred-items` MUST be present as an empty list when no deferral exists.

## 3 - Required actions when applies=true

When `applies=true`, the agent MUST:

1. Update relevant docs, indexes, specs, and manuals tied to the changed
   surfaces.
2. Update references and citations for artifacts that were moved, renamed, or
   deleted.
3. Add or update backlog tracking for any required update that is deferred.

## 4 - Deferral rule

Agents MUST defer only when immediate completion is not feasible within the
task boundary. When deferring, the agent SHALL:

- record a concrete rationale in `deferred-items`,
- create or update a backlog item in `/memory/backlog/index.yaml`, and
- include links that let a reviewer trace deferred work to affected surfaces.

## 5 - Applies=false rule

When `applies=false`, the record MUST include a rationale that states why no
documentation/reference surface changed and why no follow-up is required.

## 6 - Enforcement linkage

This contract defines required decision content. Commit-time enforcement SHALL
be routed through `/memory/handbook/policy-compliance-contract.md`, which
binds documentation-impact decisions to machine-checkable
`/work/<day>/<task-id>/policy-compliance.json` artifacts.

## 7 - Stability

This file is bootstrap-canonical for task-level documentation-impact decisions.
Promotion to `stability: stable` requires ratified enforcement automation and
successful dogfood validation.
