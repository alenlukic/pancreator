---
slug: handbook-index
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [librarian]
purpose: Human-readable entry point for handbook docs. Agents resolve binding keys through DOC.REGISTRY.
related:
  - AGENTS.md
  - lib/memory/handbook/agent-document-registry.md
...

# Operator section
- 👀 **In this file:** Handbook Index
- ⚖️ **Why it matters:** Quick orientation for Handbook Index before agents load the full contract.
- 🧭 **See also:**
  - AGENTS.md
  - lib/memory/handbook/agent-document-registry.md

# Handbook Index

Agents start from `AGENTS.md` and resolve binding `DOC.*`, `PIPE.*`, and
`PERSONA.*` keys through `lib/memory/handbook/agent-document-registry.md`. This
page is a human-readable orientation layer; the routing table below supports
`MemoryRouter` intent matching without replacing `DOC.REGISTRY`. Paths on this
page are project-root-relative; resolve them per `AGENTS.md` path convention.

## Routing

| Intent or question | Primary docs | Secondary docs | Notes |
| --- | --- | --- | --- |
| Resolve a term or domain noun | `lib/memory/handbook/glossary.md` | | Ubiquitous language before authoring contracts. |
| Resolve a `DOC.*`, `PIPE.*`, or `PERSONA.*` key | `lib/memory/handbook/agent-document-registry.md` | `AGENTS.md` | Binding key registry. |
| Context budget and retrieval depth | `lib/memory/handbook/context-economy.md` | `lib/memory/handbook/memory-tiers.md` | |
| Low-risk bounded work posture | `lib/memory/handbook/simple-task-mode.md` | `AGENTS.md`, `lib/memory/handbook/context-economy.md` | |
| Engineering standards selection | `lib/memory/handbook/engineering/index.md` | `lib/memory/handbook/engineering/software-engineering.md` | |
| Pipeline state and gate validation | `lib/memory/handbook/pipeline-state-contract.md` | `lib/pipelines/feature-delivery.yaml` | |
| Human-readable feature-delivery walkthrough | `lib/memory/handbook/feature-delivery-pipeline-overview.md` | `lib/memory/handbook/pipeline-state-contract.md`, `lib/pipelines/feature-delivery.yaml` | Orientation layer for stage inputs, validations, actions, done criteria, and runtime transitions. |

## Contract system

- `agent-document-registry.md` — global key registry for docs, personas, and pipelines.
- `persona-spec.md` — persona spec schema and authoring rules.
- `persona-contracts.md` — static persona execution-contract requirements.
- `output-manifest-contract.md` — required manifest shape and double-write rule.
- `pipeline-state-contract.md` — state machine, gates, and remediation routing.
- `feature-delivery-pipeline-overview.md` — readable walkthrough of the FD stage contracts and runtime loopbacks.

## Common handbook areas

- `engineering/index.md` — engineering handbook entry point.
- `engineering/software-engineering.md` — general software engineering standard.
- `engineering/typescript.md` — TypeScript and ES2022+ standard.
- `engineering/design-craft.md` — design craft standard.
- `operator-output-contract.md` — operator-facing completion format.
- `pancreator-config.md` — live workspace config and CLI invocation contract.
- `compliance-runs.md` — compliance trigger and descriptor run rules.
- `run-log-schema.md` — feature-delivery run-log schema.
- `context-economy.md` — context-budget, retrieval-depth, RTK-first shell, and memory-tier routing guidance.
- `simple-task-mode.md` — bounded low-risk task posture and context-expansion triggers.
- `documentation-impact-contract.md` — documentation update/deferral rules.
- `glossary.md` — domain noun definitions.

## Common entry points

| Need | Primary read | Notes |
| --- | --- | --- |
| Ubiquitous language | `lib/memory/handbook/glossary.md` | Resolve every domain noun before authoring contracts or specs. |
| Routing handbook pages | `lib/memory/handbook/index.md` | Avoid loading the full handbook tree by default. |
| Memory-tier taxonomy | `lib/memory/handbook/memory-tiers.md` | Defines **active-memory**, **active-work**, **durable-memory**, **archival-memory**, **internal-operating-content**, and **generated-machine-artifact**. |
| Active-memory pointers | `lib/memory/active/current.md` | Summaries only; follow links into durable or archival tiers. |
| Planning/execution handoffs | `lib/memory/active/handoffs.md` | Pointer-only map for active handoff cards under `.pan/work/<day>/<task-id>/handoff.md`. |
| Agent operating card | `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded) | Cross-tool agent contract; explicit-read on self-host. |
| Human operator procedures | `OPERATION.md` | Human-only; indexed external surface. |
| Product intent (internal) | `.docs/PRD.summary.md` | Pancreator self-dev only; explicit-read by default indexing policy. |
| Section-level PRD routing (internal) | `.docs/PRD.index.md` | Pancreator self-dev only. |
| M1 and bootstrap routing (internal) | `.docs/M1.index.md` | Pancreator self-dev only. |
| Subagent invocation and model policy | `AGENTS.md` | Named personas use the canonical `.cursor/agents/<name>.md` projection; ad-hoc delegations use the parent model. |
| Feature implementation | `.pan/work/<day>/<task-id>/spec.md` | Canonical Engineering Spec for that Feature. |
| Bootstrap phase authority | `.docs/BOOTSTRAP.md` | Open only when compact M1 routing is insufficient. |
| Governance and documentation-impact | `lib/memory/handbook/documentation-impact-contract.md`, `lib/memory/handbook/constitution.md` | Required for post-task documentation decisions; optional `/pr-writer` for PR bodies. |
