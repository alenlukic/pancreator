---
title: Handbook Routing Index
slug: handbook-index
stability: experimental
bootstrap-only: false
phase: 0b
owners: [librarian, supervisor, tech-writer]
purpose: |
  Routing map for handbook retrieval by intent. Authors and operators SHALL use
  this file to select the minimum set of handbook pages needed for a given
  question, and SHALL avoid broad handbook loading when a narrow route exists.
references:
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [63, 77]
    contentHash: 5d6792095dc7a91d3400f7d8dfdc9c6c1276e026c3b78b53cf96461c6da6e1d5
    note: "Phase 0b handbook seed list requires `/src/memory/handbook/index.md` as the MemoryRouter routing table."
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [229, 231]
    contentHash: 31546d19f1cabd2d82e88353fbc8a3d67f1b5b5a97f2b28734841d7103b5446f
    note: "Glossary defines MemoryRouter behavior against this file."
  - kind: lines
    path: AGENTS.md
    range: [18, 30]
    contentHash: fbc85e1edf1c9d1205cb54861601842060f5d112626374684c6f64aaba986d52
    note: "Canon table declares handbook pages that this index routes by intent."
related:
  - /src/memory/handbook/glossary.md
  - /src/memory/handbook/persona-spec.md
  - /src/memory/handbook/contract-format.md
  - /src/memory/handbook/contract-style.md
  - /src/memory/handbook/agents-md-authoring.md
  - /src/memory/handbook/constitution.md
  - /src/memory/handbook/documentation-impact-contract.md
  - /src/memory/handbook/policy-compliance-contract.md
  - /src/memory/handbook/inbox-lifecycle.md
  - /src/memory/handbook/run-log-schema.md
  - /src/memory/handbook/backlog-format.md
  - /src/memory/handbook/persona-colors.md
  - /src/memory/handbook/context-economy.md
  - /src/memory/handbook/memory-tiers.md
  - /src/memory/handbook/subagent-model-tiers.md
  - /src/memory/handbook/context-cost-audit.md
---

# Handbook Routing Index

This file is the handbook routing map. A retriever or human operator SHALL map
an intent to one primary handbook page first, then add secondary pages only
when the primary page leaves a required question unresolved.

This index defines retrieval policy, not runtime status. Until runtime wiring
lands, operators SHOULD apply this table manually.

## Routing table (intent -> docs)

| Intent or question | Primary docs | Secondary docs | Notes |
|---|---|---|---|
| Resolve a term or noun definition | `/src/memory/handbook/glossary.md` | `/src/memory/handbook/contract-style.md` | Start with glossary. Authors MUST add missing nouns there in the same change that introduces them. |
| Author or update a persona spec | `/src/memory/handbook/persona-spec.md` | `/src/memory/handbook/glossary.md`, `/src/memory/handbook/persona-colors.md` | Persona fields and metadata contract live in persona-spec; use glossary for noun discipline and persona-colors for `color` selection. |
| Author or update contract clauses | `/src/memory/handbook/contract-format.md` | `/src/memory/handbook/contract-style.md`, `/src/memory/handbook/contract-templates/` | Wrapper schema and kind registry come from contract-format; style and template constraints gate authoring quality. |
| Run contract style lint checks | `/src/memory/handbook/contract-style.md` | `/src/memory/handbook/glossary.md` | Layer 1/2/3 checks are defined in contract-style; glossary resolves noun validity. |
| Author or update `/AGENTS.md` | `/src/memory/handbook/agents-md-authoring.md` | `/src/memory/handbook/constitution.md`, `/src/memory/handbook/documentation-impact-contract.md` | Follow AGENTS change-control and trigger rules; include governance and documentation-impact checks. |
| Interpret governance and organizational rules | `/src/memory/handbook/constitution.md` | `/AGENTS.md`, `/docs/PRD.md` | Use constitution for charter-level governance. Use AGENTS/PRD only as supporting context when needed. |
| Decide documentation-impact updates or deferrals | `/src/memory/handbook/documentation-impact-contract.md` | `/src/memory/handbook/backlog-format.md`, `/src/memory/handbook/agents-md-authoring.md` | Required post-task decision flow lives in documentation-impact contract; use backlog-format for deferral recording schema. |
| Prepare commit-time policy-compliance artifact and enforcement evidence | `/src/memory/handbook/policy-compliance-contract.md` | `/src/memory/handbook/documentation-impact-contract.md`, `/src/memory/handbook/constitution.md` | Use policy-compliance contract for machine-checkable `src/work/<day>/<task-id>/policy-compliance.json` artifacts and fail-closed commit gate behavior. |
| Process inbox lifecycle and archival flow | `/src/memory/handbook/inbox-lifecycle.md` | `/AGENTS.md` | Inbox state model and manual archival procedure are defined in inbox-lifecycle. |
| Validate run-log schema and observability fields | `/src/memory/handbook/run-log-schema.md` | `/src/memory/handbook/glossary.md` | Run-log contract is canonical for `/src/work/<day>/<id>/run.log.jsonl`; glossary resolves shared telemetry nouns. |
| Track backlog items and documentation deferrals | `/src/memory/handbook/backlog-format.md` | `/src/memory/handbook/documentation-impact-contract.md` | Backlog index schema is canonical; documentation-impact defines when and why deferrals are allowed. |
| Choose persona color assignments | `/src/memory/handbook/persona-colors.md` | `/src/memory/handbook/persona-spec.md` | Persona-colors is the canonical palette table; persona-spec provides field-level context. |
| Active-memory pointers and current coordination | `/src/memory/active/current.md` | `/src/memory/handbook/context-economy.md`, `/src/memory/handbook/memory-tiers.md` | Active-memory holds summaries only; durable and archival artifacts stay on their own tiers. |
| Memory-tier taxonomy and default retrieval classes | `/src/memory/handbook/memory-tiers.md` | `/src/memory/handbook/context-economy.md`, `/src/memory/handbook/glossary.md` | Defines **active-memory**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Reduce default AI context load and decide what to index versus explicit-read | `/src/memory/handbook/context-economy.md` | `/src/memory/handbook/index.md`, `/src/memory/active/current.md`, `/src/memory/handbook/memory-tiers.md`, `/src/memory/handbook/context-cost-audit.md`, `/docs/PRD.summary.md`, `/docs/PRD.index.md`, `/docs/M1.index.md` | Context-economy defines indexing policy, memory-tier routing, `simple task mode`, PRD/M1 summary-first discipline, and operator verification expectations. |
| Choose standard versus complex Cursor subagents | `/src/memory/handbook/subagent-model-tiers.md` | `/src/memory/handbook/context-economy.md`, `/AGENTS.md` | Use standard variants by default; escalate to complex only for documented triggers. |
| Audit likely token cost sinks | `/src/memory/handbook/context-cost-audit.md` | `/src/memory/handbook/context-economy.md`, `/src/memory/handbook/subagent-model-tiers.md`, `/docs/M1.index.md` | Records current cost sinks and practical controls. |

## Retrieval discipline

When multiple intents apply, the retriever SHOULD choose the strictest
normative surface first (for example contract-style before templates), then
expand to at most two secondary pages unless the task explicitly requires
broader context.

A route entry MAY be extended when a new handbook page becomes canonical. The
author SHALL update this index in the same change set as the new canonical page
or SHALL record a documented deferral with backlog linkage.

## Stability

This page is a Phase 0b handbook seed and remains `experimental` until runtime
retrieval wiring is implemented and validated.
