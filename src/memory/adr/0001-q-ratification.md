---
title: Ratify Open Questions Q1-Q22
seq: "0001"
status: accepted
date: 2026-04-25
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: symbol
    path: docs/PRD.md
    symbol: "## 13. Open Questions / Risks"
    contentHash: 2ce8e5c
    note: "PRD defines the Q1-Q22 ratification surface."
  - kind: lines
    path: docs/PRD.md
    range: [1151, 1176]
    contentHash: 2ce8e5c
    note: "PRD lists Q1-Q22 defaults that require ratification or override."
  - kind: symbol
    path: AGENTS.md
    symbol: "## 5 — Working agreement"
    contentHash: e037427
    note: "AGENTS defines stage-local workflow and citation/style obligations."
  - kind: lines
    path: AGENTS.md
    range: [78, 90]
    contentHash: e037427
    note: "AGENTS requires local staging, human-gated pushes, dual-anchor citations, and Layer 1 discipline."
  - kind: symbol
    path: src/memory/handbook/contract-style.md
    symbol: "### Rule 1.1 — RFC 2119 obligation per clause"
    contentHash: afdc2a6
    note: "Contract style defines RFC 2119 and atomic clause obligations."
  - kind: lines
    path: src/memory/handbook/contract-style.md
    range: [60, 89]
    contentHash: afdc2a6
    note: "Layer 1 requires explicit obligation keywords and atomic statements."
---

## Context

The human ratified the Q1-Q22 decision set in chat and requested this artifact
at `src/memory/adr/0001-q-ratification.md`.

The ADR directory already contains `0001-backlog-tracking.md`. This artifact
therefore records a controlled numbering exception: the filename prefix `0001`
is reused by explicit human directive. The ADR index SHOULD treat full filenames
as unique identifiers until a later renumbering pass is ratified.

## Decision

Tesseract SHALL apply the following ratified outcomes for Q1-Q22.

| Question | Ratified outcome | State |
| --- | --- | --- |
| Q1 | TS/Node | ratified |
| Q2 | Multi-user single-repo in M3; multi-repo remains M9 | ratified |
| Q3 | Stage locally with human gate; no auto-push | ratified |
| Q4 | Keep `tesseract` name | ratified |
| Q5 | Apache-2.0 | ratified |
| Q6 | LLM-judged checks in M2; deterministic checks in M3 | ratified |
| Q7 | Keep M1 simple; pilot conflict-planner before broad M2 rollout | ratified |
| Q8 | Scout budget cap is 20 USD per scout per week | ratified |
| Q9 | 3 rounds, 100000 all-in tokens, 3 USD all-in cap, medium-tier default, one high-tier tie-breaker allowed | ratified |
| Q10 | `/src/memory/backlog/` is canonical; M3 adds sync adapters | ratified |
| Q11 | Retain last 100 turns plus Librarian rolling summary | ratified |
| Q12 | Grooming default is `propose`; `auto-pr` is opt-in | ratified |
| Q13 | Package boundaries from M1; rich APIs ratchet by milestone | ratified |
| Q14 | Single-user local trust MVP; optional org check M6; full RBAC M9 | ratified |
| Q15 | High-confidence-only default; `--exhaustive` exposes low-confidence | ratified |
| Q16 | Dual runtime from start (TS and Python) | ratified |
| Q17 | `src/personas/*.md` is canonical; emit `.cursor/agents` mirror; keep `.mdc` only where rule-loading still requires it | ratified |
| Q18 | Phased MCP surface: curated MVP, then expand toward parity | ratified |
| Q19 | Local Docker sandbox default | ratified |
| Q20 | HippoRAG2 default, Mem0 CRUD shape, Letta overlay | ratified |
| Q21 | Deferred pending comparative evaluation; provisional default retained | deferred |
| Q22 | Undecided | open |

For Q21, the tech-lead SHALL run a comparative evaluation of AutoGen, CrewAI,
and LangGraph supervisor against ensemble quality and operational cost before
M4 scope lock, and SHALL submit a ratification delta for human review.

For Q22, the tech-lead SHALL publish a decision brief covering threat model,
default exposure posture, and operator UX trade-offs before framework-mode A2A
lands; LocalUserAuthorizer SHALL ratify the final default.

## Status

Status is accepted on 2026-04-25 because the human explicitly ratified Q1-Q22
in chat and requested this ADR as the canonical record of that ratification.

## Consequences

- positive: Q1-Q20 now have a single ratified source for implementation and
  milestone planning.
- positive: Q21 and Q22 now have explicit owners and mandatory next actions.
- negative: Reuse of `0001` creates a sequencing exception that tooling MUST
  handle by full filename until renumbering policy is ratified.
- negative: PRD defaults for Q8, Q9, Q11, Q16, Q17, and Q18 diverge from this
  ratification record and require downstream implementation/doc updates.
- neutral: This ADR does not itself execute those downstream updates.
