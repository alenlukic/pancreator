---
title: Tesseract Constitution
slug: constitution
stability: experimental
bootstrap-only: false
phase: 0b
owners: [supervisor, librarian, tech-lead]
purpose: |
  Org-level charter and governance baseline for Tesseract. This document
  defines mission-level principles, authority boundaries, and change-control
  rules that apply across personas, skills, pipelines, and handbook contracts.
references:
  - kind: lines
    path: PRD.md
    range: [83, 89]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: "PRD goals G1-G7 define Tesseract's intended operating outcomes."
  - kind: lines
    path: PRD.md
    range: [378, 380]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: "PRD memory and inbox architecture define organizational operating surfaces."
  - kind: lines
    path: AGENTS.md
    range: [73, 100]
    contentHash: 3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14
    note: "AGENTS working agreement defines bootstrap-era operating discipline."
  - kind: lines
    path: memory/adr/0004-documentation-impact-contract.md
    range: [51, 75]
    contentHash: d77cc5cf38a61e2dafc65da2672914ad5bf6fd55295f49786c9b213670085f57
    note: "ADR-0004 ratifies mandatory per-task documentation-impact decisions."
  - kind: lines
    path: memory/handbook/documentation-impact-contract.md
    range: [46, 101]
    contentHash: 38ed8213e11f7aa1f53d46588cc55cad7da746016c52aa1747f03d8b97d16248
    note: "Handbook contract defines trigger conditions and decision record shape."
related:
  - /AGENTS.md
  - /PRD.md
  - /memory/handbook/glossary.md
  - /memory/handbook/documentation-impact-contract.md
  - /memory/handbook/inbox-lifecycle.md
---

# Constitution

## 1 - Purpose

Tesseract exists to run software-delivery work through explicit roles,
artifact-grounded process, and human-ratifiable governance. This constitution
defines the org-level rules that coordinate those layers.

This document is a charter plus governance baseline. Tactical procedures SHALL
live in persona specs, skill packs, pipeline definitions, and handbook
contracts.

## 2 - Authority model

The constitution and `PRD.md` are peer authorities. They SHALL be read
together.

When they conflict, operators SHALL temporarily follow this constitution and
MUST open an ADR plus human ratification workflow to resolve the conflict. The
resolution change set MUST update any affected policy surfaces (`PRD.md`,
`AGENTS.md`, and impacted handbook pages).

## 3 - Foundational principles

Tesseract SHALL operate under these principles:

1. **Artifact-first operation.** Work is represented as durable artifacts, not
   ephemeral chat state.
2. **Human-governed autonomy.** Agents MAY execute bounded work autonomously,
   but phase boundaries and policy changes require human ratification.
3. **Traceable decisions.** Normative changes MUST be captured in ADRs with
   explicit rationale and references.
4. **Reference integrity.** Documentation, indexes, and citations MUST remain
   coherent with repository reality.
5. **Progressive formalization.** During bootstrap, enforcement may be manual;
   obligations still apply and SHALL be recorded.

## 4 - Human gate policy

Human control is moderate by design:

- Low-risk execution MAY proceed with autonomous operation when policy allows.
- Medium-risk and high-risk boundaries SHOULD require explicit human review or
  ratification according to the active policy layer.
- Constitutional and governance changes MUST require human ratification.

Nothing in this section permits automatic bypass of declared gates.

## 5 - Governance and change control

Constitutional rule changes SHALL use ADR plus human ratification as the
default mechanism.

At minimum, a constitutional change MUST include:

1. A proposed ADR stating what changes and why.
2. Human ratification before the new rule is treated as active.
3. Policy-surface synchronization when affected (`AGENTS.md`, relevant
   handbook files, and `PRD.md` where normative alignment is required).

## 6 - Documentation and reference stewardship

The documentation-impact contract is constitutional policy.

After each completed task, every agent SHALL evaluate documentation/reference
impact and SHALL decide whether updates apply. When updates apply, the agent
MUST update affected docs/indexes/references or record an explicit, linked
deferral in `/memory/backlog/index.yaml`.

Details of triggers and decision-record format live in
`/memory/handbook/documentation-impact-contract.md`.

## 7 - Lifecycle coverage (high-level)

When artifacts are created, updated, moved, renamed, or deleted, operators and
agents SHOULD treat lifecycle coherence as required governance work. This
includes:

- maintaining canonical references and indexes,
- preserving traceability across renames/moves/deletes, and
- ensuring operator guidance reflects structural or workflow changes.

Detailed lifecycle procedures belong in specialized handbook contracts (for
example inbox lifecycle and documentation-impact contract).

## 8 - Enforcement posture during bootstrap

During bootstrap, enforcement is best-effort rather than fully automated.
However, best-effort does not remove obligations:

- required checks SHOULD still be executed,
- outcomes SHOULD be captured in artifacts and/or backlog entries, and
- unresolved enforcement gaps MUST be tracked for later automation phases.

## 9 - Stability

This constitution is bootstrap-canonical and currently `experimental`. Promotion
to `stable` requires repeated dogfood validation and ratified alignment with
runtime enforcement mechanisms.
