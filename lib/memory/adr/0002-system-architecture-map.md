---
title: Ratify System Architecture Map Baseline
seq: "0002"
status: proposed
date: 2026-04-25
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: docs/PRD.md
    range: [3, 3]
    contentHash: 2ce8e5c
    note: "PRD overview defines the four-axis architecture: roles, pipelines, memory, and process."
  - kind: lines
    path: docs/PRD.md
    range: [12, 12]
    contentHash: 2ce8e5c
    note: "PRD scaffold todo defines the canonical repository substrate and top-level directories."
  - kind: lines
    path: docs/PRD.md
    range: [17, 21]
    contentHash: 2ce8e5c
    note: "PRD MVP scope defines persona and skill inventories."
  - kind: lines
    path: docs/PRD.md
    range: [26, 30]
    contentHash: 2ce8e5c
    note: "PRD roadmap defines pipelines and control-plane runtime as distinct implementation layers."
  - kind: lines
    path: AGENTS.md
    range: [31, 41]
    contentHash: e037427
    note: "AGENTS defines current agent and pipeline locations, including bootstrap status for pipeline population."
  - kind: lines
    path: AGENTS.md
    range: [104, 133]
    contentHash: e037427
    note: "AGENTS workspace map defines canonical memory, inbox, and control-plane paths."
  - kind: lines
    path: AGENTS.md
    range: [138, 141]
    contentHash: e037427
    note: "AGENTS bootstrap status records the currently active phases."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [49, 53]
    contentHash: 940935e
    note: "Bootstrap Phase 0 scaffolds directories that represent the present implemented repository state."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [57, 61]
    contentHash: 940935e
    note: "Bootstrap Phase 0b defines handbook seeds as canonical authoring substrate."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [273, 275]
    contentHash: 940935e
    note: "Bootstrap conventions require a human-in-the-loop phase-gate reviewer."
  - kind: lines
    path: lib/personas/persona-designer.md
    range: [2, 4]
    contentHash: 9ac0169
    note: "Persona Designer scope anchors bootstrap persona authoring ownership."
  - kind: lines
    path: lib/personas/contract-writer.md
    range: [2, 4]
    contentHash: 5b60a64
    note: "Contract Writer scope anchors bootstrap contract-authoring ownership."
  - kind: lines
    path: lib/personas/intake-analyst.md
    range: [2, 4]
    contentHash: b85829d
    note: "Intake Analyst anchors the inbox-driven intake contract in current persona inventory."
---

## Context

Pancreator requires one architecture map that operators can inspect before every
phase-boundary ratification. The map MUST separate current implemented
repository substrate from runtime elements that are planned but not yet landed.
Without that separation, operators cannot validate scope or phase claims
deterministically.

```mermaid
flowchart TB
    Human["Human Reviewer (LocalUserAuthorizer)\nCURRENT"]

    subgraph Repo["Repository Substrate (CURRENT)"]
      AGENTS["AGENTS.md contract\nCURRENT"]
      INBOX["lib/inbox/{in,out,threads}\nCURRENT"]
      ADR["lib/memory/adr/\nCURRENT"]
      BACKLOG["lib/memory/backlog/\nCURRENT"]
      HANDBOOK["lib/memory/handbook/\nCURRENT"]
      PERSONAS["lib/personas/*.md\nCURRENT"]
      COMPLIANCE["lib/personas/compliance-auditor.md\nCURRENT"]
      TENGINEER["lib/personas/pancreator-engineer.md\nCURRENT"]
      SKILLS["lib/personas/skills/*/SKILL.md\nCURRENT"]
      BOOT["docs/BOOTSTRAP.md + docs/PRD.md\nCURRENT"]
    end

    subgraph Runtime["Runtime and Orchestration (FUTURE / NOT YET IMPLEMENTED)"]
      PIPELINES["lib/pipelines/*.yaml runtime execution\nFUTURE (Phase 4+)"]
      ENSEMBLES["lib/ensembles/*.yaml orchestration\nFUTURE (M4+)"]
      RUNNER["@pancreator/runner-* + AgentRunner\nFUTURE"]
      MEMORY["MemoryStore + MemoryRouter services\nFUTURE"]
      CLI["pan CLI + MCP server\nFUTURE"]
      CONTROL[".pan scheduler/worktree automation\nFUTURE"]
    end

    Human --> INBOX
    INBOX --> PERSONAS
    PERSONAS --> COMPLIANCE
    PERSONAS --> TENGINEER
    PERSONAS --> SKILLS
    PERSONAS --> ADR
    PERSONAS --> BACKLOG
    PERSONAS --> HANDBOOK
    AGENTS --> PERSONAS
    BOOT --> PERSONAS
    BOOT --> SKILLS
    BOOT --> ADR

    PERSONAS -. planned execution .-> PIPELINES
    PIPELINES -. planned dispatch .-> RUNNER
    RUNNER -. planned state IO .-> MEMORY
    RUNNER -. planned control .-> CONTROL
    CLI -. planned invoke/query .-> RUNNER
    ENSEMBLES -. planned multi-agent review .-> PIPELINES
```

The current repository already contains authoritative docs, persona specs
(including `compliance-auditor` and `pancreator-engineer`), skills, inbox
queues, ADR memory, and backlog memory. The current repository does not yet run
those assets through a fully implemented pipeline runtime.

## Decision

Pancreator SHALL adopt this ADR as the baseline architecture system map for
bootstrap operations. Every architecture-facing operator document MUST reference
this ADR when it describes cross-component relationships in the current
repository state.

Architecture statements in this ADR SHALL use the following boundary rule:

- CURRENT means the path or artifact class exists in the repository now.
- FUTURE means the capability is declared in PRD or BOOTSTRAP but not yet
  implemented as an executable runtime flow in this repository.

Any future architecture map revision MUST preserve explicit CURRENT versus
FUTURE labels for every major node so phase-gate review remains testable.

## Status

Status is proposed on 2026-04-25 and awaits human ratification at the next
bootstrap phase boundary.

## Consequences

- positive: Operators gain one canonical diagram for current system orientation
  before authoring or ratifying new artifacts.
- positive: CURRENT versus FUTURE boundaries reduce phase-claim ambiguity and
  support deterministic scope review.
- negative: Architecture updates now require ADR maintenance whenever scaffold
  state changes materially.
- negative: Any document that describes runtime behavior without the CURRENT and
  FUTURE distinction MUST be corrected before phase-exit ratification.
- neutral: This ADR maps architecture state; it does not change execution logic
  or bootstrap phase ordering.
