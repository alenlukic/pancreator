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
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD overview defines the four-axis architecture: roles, pipelines, memory, and process."
  - kind: lines
    path: docs/PRD.md
    range: [12, 12]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD scaffold todo defines the canonical repository substrate and top-level directories."
  - kind: lines
    path: docs/PRD.md
    range: [17, 21]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD MVP scope defines persona and skill inventories."
  - kind: lines
    path: docs/PRD.md
    range: [26, 30]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD roadmap defines pipelines and control-plane runtime as distinct implementation layers."
  - kind: lines
    path: AGENTS.md
    range: [31, 41]
    contentHash: e0374274c6e58a21d247230cb4da6f2d24a2997c6666d6cd56ad13e9dd03015a
    note: "AGENTS defines current agent and pipeline locations, including bootstrap status for pipeline population."
  - kind: lines
    path: AGENTS.md
    range: [104, 133]
    contentHash: e0374274c6e58a21d247230cb4da6f2d24a2997c6666d6cd56ad13e9dd03015a
    note: "AGENTS workspace map defines canonical memory, inbox, and control-plane paths."
  - kind: lines
    path: AGENTS.md
    range: [138, 141]
    contentHash: e0374274c6e58a21d247230cb4da6f2d24a2997c6666d6cd56ad13e9dd03015a
    note: "AGENTS bootstrap status records the currently active phases."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [49, 53]
    contentHash: 940935e98a478cca0f5fe5f51abf0f702a4b5eb2a1693f736501dc101b9df268
    note: "Bootstrap Phase 0 scaffolds directories that represent the present implemented repository state."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [57, 61]
    contentHash: 940935e98a478cca0f5fe5f51abf0f702a4b5eb2a1693f736501dc101b9df268
    note: "Bootstrap Phase 0b defines handbook seeds as canonical authoring substrate."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [273, 275]
    contentHash: 940935e98a478cca0f5fe5f51abf0f702a4b5eb2a1693f736501dc101b9df268
    note: "Bootstrap conventions require a human-in-the-loop phase-gate reviewer."
  - kind: lines
    path: src/personas/persona-designer.md
    range: [2, 4]
    contentHash: 9ac01694757082d490317a1110af4022356738c377c819b7d1d533c673742c44
    note: "Persona Designer scope anchors bootstrap persona authoring ownership."
  - kind: lines
    path: src/personas/contract-writer.md
    range: [2, 4]
    contentHash: 5b60a6452e8b17903252c851b371bf63e3de300a74cfd5c5900824b7f69e1d02
    note: "Contract Writer scope anchors bootstrap contract-authoring ownership."
  - kind: lines
    path: src/personas/intake-analyst.md
    range: [2, 4]
    contentHash: b85829d2bcd40c752def3195127cb50bdd8e7f608c848aa4a47f7a351622c9ee
    note: "Intake Analyst anchors the inbox-driven intake contract in current persona inventory."
---

## Context

Tesseract requires one architecture map that operators can inspect before every
phase-boundary ratification. The map MUST separate current implemented
repository substrate from runtime elements that are planned but not yet landed.
Without that separation, operators cannot validate scope or phase claims
deterministically.

```mermaid
flowchart TB
    Human["Human Reviewer (LocalUserAuthorizer)\nCURRENT"]

    subgraph Repo["Repository Substrate (CURRENT)"]
      AGENTS["AGENTS.md contract\nCURRENT"]
      INBOX["src/inbox/{in,out,threads}\nCURRENT"]
      ADR["src/memory/adr/\nCURRENT"]
      BACKLOG["src/memory/backlog/\nCURRENT"]
      HANDBOOK["src/memory/handbook/\nCURRENT"]
      PERSONAS["src/personas/*.md\nCURRENT"]
      COMPLIANCE["src/personas/compliance-auditor.md\nCURRENT"]
      TENGINEER["src/personas/tesseract-engineer.md\nCURRENT"]
      SKILLS["src/skills/*/SKILL.md\nCURRENT"]
      BOOT["docs/BOOTSTRAP.md + docs/PRD.md\nCURRENT"]
    end

    subgraph Runtime["Runtime and Orchestration (FUTURE / NOT YET IMPLEMENTED)"]
      PIPELINES["src/pipelines/*.yaml runtime execution\nFUTURE (Phase 4+)"]
      ENSEMBLES["src/ensembles/*.yaml orchestration\nFUTURE (M4+)"]
      RUNNER["@tesseract/runner-* + AgentRunner\nFUTURE"]
      MEMORY["MemoryStore + MemoryRouter services\nFUTURE"]
      CLI["tess CLI + MCP server\nFUTURE"]
      CONTROL[".tess scheduler/worktree automation\nFUTURE"]
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
(including `compliance-auditor` and `tesseract-engineer`), skills, inbox
queues, ADR memory, and backlog memory. The current repository does not yet run
those assets through a fully implemented pipeline runtime.

## Decision

Tesseract SHALL adopt this ADR as the baseline architecture system map for
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
