---
slug: handbook-index
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [librarian]
purpose: Human-readable entry point for handbook docs. Agents resolve binding keys through DOC.REGISTRY.
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
...

# Operator section
- 👀 **In this file:** Handbook Index
- ⚖️ **Why it matters:** Quick orientation for Handbook Index before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md

# Handbook Index

Agents start from `AGENTS.md` and resolve binding `DOC.*`, `PIPE.*`, and
`PERSONA.*` keys through `lib/memory/handbook/agent-document-registry.md`. This
page is a human-readable orientation layer; the routing table below supports
`MemoryRouter` intent matching without replacing `DOC.REGISTRY`.

## Routing

| Intent or question | Primary docs | Secondary docs | Notes |
| --- | --- | --- | --- |
| Resolve a term or domain noun | `/lib/memory/handbook/glossary.md` | | Ubiquitous language before authoring contracts. |
| Resolve a `DOC.*`, `PIPE.*`, or `PERSONA.*` key | `/lib/memory/handbook/agent-document-registry.md` | `AGENTS.md` | Binding key registry. |
| Context budget and retrieval depth | `/lib/memory/handbook/context-economy.md` | `/lib/memory/handbook/memory-tiers.md` | |
| Engineering standards selection | `/lib/memory/handbook/engineering/index.md` | `/lib/memory/handbook/engineering/software-engineering.md` | |
| Pipeline state and gate validation | `/lib/memory/handbook/pipeline-state-contract.md` | `/lib/pipelines/feature-delivery.yaml` | |

## Contract system

- `agent-document-registry.md` — global key registry for docs, personas, and pipelines.
- `persona-spec.md` — persona spec schema and authoring rules.
- `persona-contracts.md` — static persona execution-contract requirements.
- `output-manifest-contract.md` — required manifest shape and double-write rule.
- `pipeline-state-contract.md` — state machine, gates, and remediation routing.

## Common handbook areas

- `engineering/index.md` — engineering handbook entry point.
- `engineering/software-engineering.md` — general software engineering standard.
- `engineering/typescript.md` — TypeScript and ES2022+ standard.
- `engineering/design-craft.md` — design craft standard.
- `operator-output-contract.md` — operator-facing completion format.
- `pancreator-config.md` — live workspace config and CLI invocation contract.
- `compliance-runs.md` — compliance trigger and descriptor run rules.
- `run-log-schema.md` — feature-delivery run-log schema.
- `context-economy.md` — context-budget, memory-tier, and model escalation guidance.
- `documentation-impact-contract.md` — documentation update/deferral rules.
- `glossary.md` — domain noun definitions.
