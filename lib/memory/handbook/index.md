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
    contentHash: 5d67920
    note: "Phase 0b handbook seed list requires `/lib/memory/handbook/index.md` as the MemoryRouter routing table."
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [229, 231]
    contentHash: 31546d1
    note: "Glossary defines MemoryRouter behavior against this file."
  - kind: lines
    path: AGENTS.md
    range: [18, 30]
    contentHash: fbc85e1
    note: "Canon table declares handbook pages that this index routes by intent."
related:
  - /lib/memory/handbook/glossary.md
  - /lib/memory/handbook/persona-spec.md
  - /lib/memory/handbook/contract-format.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/agents-md-authoring.md
  - /lib/memory/handbook/constitution.md
  - /lib/memory/handbook/documentation-impact-contract.md
  - /lib/memory/handbook/policy-compliance-contract.md
  - /lib/memory/handbook/inbox-lifecycle.md
  - /lib/memory/handbook/run-log-schema.md
  - /lib/memory/handbook/backlog-format.md
  - /lib/memory/handbook/persona-colors.md
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/memory-tiers.md
  - /lib/memory/handbook/context-cost-audit.md
  - /lib/memory/handbook/pancreator-config.md
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
| Resolve a term or noun definition | `/lib/memory/handbook/glossary.md` | `/lib/memory/handbook/contract-style.md` | Start with glossary. Authors MUST add missing nouns there in the same change that introduces them. |
| Author or update a persona spec | `/lib/memory/handbook/persona-spec.md` | `/lib/memory/handbook/glossary.md`, `/lib/memory/handbook/persona-colors.md` | Persona fields and metadata contract live in persona-spec; use glossary for noun discipline and persona-colors for `color` selection. |
| Author or update contract clauses | `/lib/memory/handbook/contract-format.md` | `/lib/memory/handbook/contract-style.md`, `/lib/memory/handbook/contract-templates/` | Wrapper schema and kind registry come from contract-format; style and template constraints gate authoring quality. |
| Run contract style lint checks | `/lib/memory/handbook/contract-style.md` | `/lib/memory/handbook/glossary.md` | Layer 1/2/3 checks are defined in contract-style; glossary resolves noun validity. |
| Author or update `/AGENTS.md` | `/lib/memory/handbook/agents-md-authoring.md` | `/lib/memory/handbook/constitution.md`, `/lib/memory/handbook/documentation-impact-contract.md` | Follow AGENTS change-control and trigger rules; include governance and documentation-impact checks. |
| Interpret governance and organizational rules | `/lib/memory/handbook/constitution.md` | `/AGENTS.md`, `/docs/PRD.md` | Use constitution for charter-level governance. Use AGENTS/PRD only as supporting context when needed. |
| Decide documentation-impact updates or deferrals | `/lib/memory/handbook/documentation-impact-contract.md` | `/lib/memory/handbook/backlog-format.md`, `/lib/memory/handbook/agents-md-authoring.md` | Required post-task decision flow lives in documentation-impact contract; use backlog-format for deferral recording schema. |
| Prepare commit-time policy-compliance artifact and enforcement evidence | `/lib/memory/handbook/policy-compliance-contract.md` | `/lib/memory/handbook/documentation-impact-contract.md`, `/lib/memory/handbook/constitution.md` | Use policy-compliance contract for machine-checkable `work/<day>/<task-id>/policy-compliance.json` artifacts and fail-closed commit gate behavior. |
| Process inbox lifecycle and archival flow | `/lib/memory/handbook/inbox-lifecycle.md` | `/AGENTS.md` | Inbox state model and manual archival procedure are defined in inbox-lifecycle. |
| Format agent completion output for the operator | `/lib/memory/handbook/operator-output-contract.md` | `/AGENTS.md`, `/lib/memory/handbook/persona-spec.md` | Defines the mandatory `## Next operator steps` block (what/how, read-only labels, multi-option when/impact). |
| Validate run-log schema and observability fields | `/lib/memory/handbook/run-log-schema.md` | `/lib/memory/handbook/glossary.md` | Run-log contract is canonical for `/work/<day>/<id>/run.log.jsonl`; glossary resolves shared telemetry nouns. |
| Track backlog items and documentation deferrals | `/lib/memory/handbook/backlog-format.md` | `/lib/memory/handbook/documentation-impact-contract.md` | Backlog index schema is canonical; documentation-impact defines when and why deferrals are allowed. |
| Choose persona color assignments | `/lib/memory/handbook/persona-colors.md` | `/lib/memory/handbook/persona-spec.md` | Persona-colors is the canonical palette table; persona-spec provides field-level context. |
| Active-memory pointers and current coordination | `/lib/memory/active/current.md` | `/lib/memory/active/handoffs.md`, `/lib/memory/handbook/context-economy.md`, `/lib/memory/handbook/memory-tiers.md` | Active-memory holds summaries and handoff pointers only; durable, active-work, and archival artifacts stay on their own tiers. |
| Memory-tier taxonomy and default retrieval classes | `/lib/memory/handbook/memory-tiers.md` | `/lib/memory/handbook/context-economy.md`, `/lib/memory/handbook/glossary.md` | Defines **active-memory**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Reduce default AI context load and decide what to index versus explicit-read | `/lib/memory/handbook/context-economy.md` | `/lib/memory/handbook/index.md`, `/lib/memory/active/current.md`, `/lib/memory/active/handoffs.md`, `/lib/memory/handbook/memory-tiers.md`, `/lib/memory/handbook/context-cost-audit.md`, `/docs/PRD.summary.md`, `/docs/PRD.index.md`, `/docs/M1.index.md` | Context-economy defines indexing policy, memory-tier routing, `simple task mode`, planning/execution handoffs, PRD/M1 summary-first discipline, and operator verification expectations. |
| Choose Cursor subagent and model escalation | `/lib/memory/handbook/context-economy.md` | `/AGENTS.md`, `/lib/memory/handbook/persona-spec.md` | Invoke `.cursor/agents/<name>.md` directly; escalate model class per context-economy triggers. |
| Audit likely token cost sinks | `/lib/memory/handbook/context-cost-audit.md` | `/lib/memory/handbook/context-economy.md`, `/docs/M1.index.md` | Records current cost sinks and practical controls. |
| Interpret or update `pancreator.yaml` | `/lib/memory/handbook/pancreator-config.md` | `/pancreator.yaml`, `/pancreator-defaults.yaml`, `/lib/personas/adopter.md` | Defines `project_root`, live bootstrap tracking, and the boundary between live policy and defaults. |
| Run or document `pan` CLI commands for operators | `/lib/memory/handbook/pancreator-config.md` §“CLI invocation in this workspace” | `/lib/memory/handbook/operator-output-contract.md`, `/AGENTS.md` | Use `pnpm -w exec pan …` from repo root; bare `pan` is not on PATH. |
| Relay feature-delivery SDK progress to operator chat | `/OPERATION.md` § SDK mode "Agent chat relay" | `/AGENTS.md` §5, `/lib/memory/handbook/context-economy.md` | Agents prefix with `PAN_FD_PROGRESS=ndjson`, monitor stderr, and post concise status lines; operators in a TTY get `[pan fd] …` on stderr automatically. |

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
