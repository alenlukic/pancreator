---
title: Policy Compliance Contract
slug: policy-compliance-contract
stability: experimental
bootstrap-only: true
phase: 1
owners: [compliance-auditor, supervisor, reviewer]
purpose: |
  Machine-checkable per-task governance artifact contract that enforces minimum
  alignment checks against AGENTS working agreement, constitution, and PRD
  before commit-time changes proceed.
references:
  - kind: lines
    path: AGENTS.md
    range: [83, 110]
    contentHash: 3dd1213
    note: "Working agreement defines mandatory bootstrap governance discipline."
  - kind: lines
    path: src/memory/handbook/constitution.md
    range: [106, 138]
    contentHash: 0087448
    note: "Constitution requires documentation/reference stewardship and recorded obligations."
  - kind: lines
    path: docs/PRD.md
    range: [83, 89]
    contentHash: 6a838ec
    note: "PRD goals define baseline operating outcomes for governance alignment."
  - kind: lines
    path: src/memory/handbook/documentation-impact-contract.md
    range: [56, 101]
    contentHash: 38ed821
    note: "Documentation-impact decision schema supplies required post-task fields."
related:
  - /AGENTS.md
  - /src/memory/handbook/constitution.md
  - /docs/PRD.md
  - /src/memory/handbook/documentation-impact-contract.md
  - /src/internal/work_archive/173010_04-26-26/23777_1723_templates/policy-compliance.example.json
---

# Policy Compliance Contract

This page defines a generalized governance gate artifact for each task. The
artifact records policy reasoning and documentation-impact outcomes in a
machine-checkable shape without requiring an exhaustive if/then policy matrix.

## 1 - Required artifact path

Each task SHALL stage at least one artifact at:

- `/src/work/<day>/<task-id>/policy-compliance.json`

This artifact MUST be staged for commits that include changes outside `src/work/`
and outside docs-only metadata surfaces governed by repository policy.

## 2 - Required JSON shape

Every `policy-compliance.json` artifact MUST match this shape:

```json
{
  "task_id": "string",
  "governing_sources_checked": [
    "AGENTS.md",
    "src/memory/handbook/constitution.md",
    "docs/PRD.md"
  ],
  "documentation_impact": {
    "applies": true,
    "rationale": "string",
    "changed_surfaces": ["path-or-id"],
    "deferred_items": [
      {
        "id": "backlog-or-tracking-id",
        "rationale": "string"
      }
    ]
  },
  "policy_alignment": {
    "agents_md_alignment": "string",
    "constitution_alignment": "string",
    "prd_alignment": "string",
    "required_updates": ["path-or-artifact-id"]
  }
}
```

Field constraints:

- `task_id` MUST be a non-empty string.
- `governing_sources_checked` MUST include all three required sources exactly as
  canonical paths: `AGENTS.md`, `src/memory/handbook/constitution.md`, and
  `docs/PRD.md`.
- `documentation_impact` MUST follow the decision spirit and required fields
  from `/src/memory/handbook/documentation-impact-contract.md`.
- `policy_alignment` MUST contain concise rationale entries for AGENTS,
  constitution, and PRD alignment, and MUST declare required updates as a list
  (empty when no updates are required).

## 3 - Documentation-impact enforcement rule

When `documentation_impact.applies=true`, the task MUST satisfy at least one
condition:

1. `documentation_impact.changed_surfaces` includes one or more documentation
   or reference surfaces that are staged in the same commit, or
2. `documentation_impact.deferred_items` includes one or more non-empty IDs
   with explicit rationale, allowing bootstrap backlog linkage.

When `documentation_impact.applies=false`, rationale MUST explicitly state why
no documentation/reference update applies.

## 4 - Enforcement integration

Commit-time automation SHOULD enforce this contract through project hooks (for
bootstrap: `.cursor/hooks/enforce-policy-compliance.sh` and `.cursor/hooks.json`
`beforeShellExecution` gate for `git commit`).

## 5 - Stability

This contract is bootstrap-canonical and `experimental`. Promotion to `stable`
requires repeated dogfood passes with ratified enforcement behavior.
