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
    contentHash: 3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14
    note: "Working agreement defines mandatory bootstrap governance discipline."
  - kind: lines
    path: memory/handbook/constitution.md
    range: [106, 138]
    contentHash: 00874481f8aaaa6618a4b6ab4d3d115ebfffd5dcf61d3d2ef38bb2076ed17432
    note: "Constitution requires documentation/reference stewardship and recorded obligations."
  - kind: lines
    path: PRD.md
    range: [83, 89]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: "PRD goals define baseline operating outcomes for governance alignment."
  - kind: lines
    path: memory/handbook/documentation-impact-contract.md
    range: [56, 101]
    contentHash: 38ed8213e11f7aa1f53d46588cc55cad7da746016c52aa1747f03d8b97d16248
    note: "Documentation-impact decision schema supplies required post-task fields."
related:
  - /AGENTS.md
  - /memory/handbook/constitution.md
  - /PRD.md
  - /memory/handbook/documentation-impact-contract.md
  - /work/templates/policy-compliance.example.json
---

# Policy Compliance Contract

This page defines a generalized governance gate artifact for each task. The
artifact records policy reasoning and documentation-impact outcomes in a
machine-checkable shape without requiring an exhaustive if/then policy matrix.

## 1 - Required artifact path

Each task SHALL stage at least one artifact at:

- `/work/<task-id>/policy-compliance.json`

This artifact MUST be staged for commits that include changes outside `work/`
and outside docs-only metadata surfaces governed by repository policy.

## 2 - Required JSON shape

Every `policy-compliance.json` artifact MUST match this shape:

```json
{
  "task_id": "string",
  "governing_sources_checked": [
    "AGENTS.md",
    "memory/handbook/constitution.md",
    "PRD.md"
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
  canonical paths: `AGENTS.md`, `memory/handbook/constitution.md`, and
  `PRD.md`.
- `documentation_impact` MUST follow the decision spirit and required fields
  from `/memory/handbook/documentation-impact-contract.md`.
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
