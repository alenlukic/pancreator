---
slug: agent-document-registry
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [librarian, supervisor]
purpose: "Stable global keys for agent contracts, handbook docs, persona specs, and pipelines."
related:
  - /AGENTS.md
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/memory/handbook/persona-spec.md
  - /lib/memory/handbook/persona-contracts.md
  - /lib/memory/handbook/output-manifest-contract.md
  - /lib/memory/handbook/operator-output-contract.md
  - /lib/memory/handbook/pipeline-state-contract.md
...

# Operator section
- 👀 **In this file:** Agent Document Registry
- ⚖️ **Why it matters:** Quick orientation for Agent Document Registry before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/memory/handbook/persona-spec.md

# Agent Document Registry

This registry maps stable global keys to repo artifacts. Persona specs, pipeline
stage contracts, and generated prompts MUST cite keys from this page instead of
copying broad path tables into `AGENTS.md`.

## Key rules

- Keys are globally unique, uppercase, and dot-delimited.
- `DOC.*` keys identify handbook or operating documents.
- `PIPE.*` keys identify pipeline definitions or pipeline-stage contracts.
- `PERSONA.*` keys identify canonical persona specs.
- Agents MUST resolve every key they are instructed to use before acting.
- Authors MUST update this registry in the same change that creates, renames, or
  retires a key.

## Core documents

| Key                         | Path                                                   | Binding use                                                                   |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `DOC.AGENTS`                | `AGENTS.md`                                            | Thin agent entry card and repo-wide operating rules.                          |
| `DOC.REGISTRY`              | `lib/memory/handbook/agent-document-registry.md`       | Resolves global keys to artifacts.                                            |
| `DOC.OPERATOR_AGENT_FORMAT` | `lib/memory/handbook/operator-agent-artifact-format.md` | Operator/agent section split for permanent docs and transient artifacts.       |
| `DOC.PERSONA_SPEC`          | `lib/memory/handbook/persona-spec.md`                  | Persona spec schema and authoring rules.                                      |
| `DOC.PERSONA_CONTRACTS`     | `lib/memory/handbook/persona-contracts.md`             | Static persona contract requirements.                                         |
| `DOC.OUTPUT_MANIFEST`       | `lib/memory/handbook/output-manifest-contract.md`      | Required output manifest shape and double-write rule.                         |
| `DOC.PIPELINE_STATE`        | `lib/memory/handbook/pipeline-state-contract.md`       | Pipeline state machine, gates, and transition validation.                     |
| `DOC.CONTEXT_ECONOMY`       | `lib/memory/handbook/context-economy.md`               | Context budget, retrieval depth, RTK-first shell inspection, and memory-tier routing decisions. |
| `DOC.SIMPLE_TASK_MODE`      | `lib/memory/handbook/simple-task-mode.md`              | Bounded-work posture for low-risk mechanical tasks and context-expansion triggers. |
| `DOC.OPERATOR_OUTPUT`       | `lib/memory/handbook/operator-output-contract.md`      | Operator-facing completion and next-step format.                              |
| `DOC.COMPLIANCE_RUNS`       | `lib/memory/handbook/compliance-runs.md`               | Compliance descriptor triggers and validation cadence.                        |
| `DOC.RUN_LOG_SCHEMA`        | `lib/memory/handbook/run-log-schema.md`                | Run-log fields and telemetry interpretation.                                  |
| `DOC.MEMORY_TIERS`          | `lib/memory/handbook/memory-tiers.md`                  | Active/durable/archive memory routing.                                        |

## Engineering documents

| Key                      | Path                                                           | Binding use                                                         |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `DOC.ENG_INDEX`          | `lib/memory/handbook/engineering/index.md`                     | Engineering handbook router.                                        |
| `DOC.ENG_SOFTWARE`       | `lib/memory/handbook/engineering/software-engineering.md`      | General code design, testing, maintainability, and review standard. |
| `DOC.ENG_TYPESCRIPT`     | `lib/memory/handbook/engineering/typescript.md`                | TypeScript, ES2022+, ESM-aware tooling, and type-system rules.      |
| `DOC.DESIGN_CRAFT`       | `lib/memory/handbook/engineering/design-craft.md`              | Product design and UI craft standard.                               |
| `DOC.DESIGN_SYSTEM`      | `lib/memory/handbook/engineering/design/design-system.md`      | Tokens and UI system choices.                                       |
| `DOC.COMPONENT_STANDARD` | `lib/memory/handbook/engineering/design/component-standard.md` | Component library and icon stack.                                   |
| `DOC.CONTROL_SURFACE_UX` | `lib/memory/handbook/engineering/design/control-surface-ux.md` | Command-center/control-surface UX obligations.                      |

## Contract and documentation documents

| Key                            | Path                                                                 | Binding use                                                   |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `DOC.CONTRACT_STYLE`           | `lib/memory/handbook/contract-style.md`                              | RFC 2119/EARS/noun discipline and lint rules.                 |
| `DOC.CONTRACT_FORMAT`          | `lib/memory/handbook/contract-format.md`                             | Contract wrapper schema and kind registry.                    |
| `DOC.CONTRACT_TEMPLATES`       | `lib/memory/handbook/contract-templates/`                            | Contract template directory for kind-specific authoring.      |
| `DOC.UX_SPEC_TEMPLATE`         | `lib/memory/handbook/contract-templates/ux-spec.template.md`         | Canonical UX-spec template for design authoring and review.   |
| `DOC.DELIVERY_REPORT_TEMPLATE` | `lib/memory/handbook/contract-templates/delivery-report.template.md` | Canonical delivery-report template for report-stage authoring.|
| `DOC.DOC_IMPACT`               | `lib/memory/handbook/documentation-impact-contract.md`               | Required documentation updates and deferrals.                 |
| `DOC.AGENTS_AUTHORING`         | `lib/memory/handbook/agents-md-authoring.md`                         | `AGENTS.md` change-control rules.                             |
| `DOC.GLOSSARY`                 | `lib/memory/handbook/glossary.md`                                    | Domain noun definitions.                                      |
| `DOC.INBOX_LIFECYCLE`          | `lib/memory/handbook/inbox-lifecycle.md`                             | Inbox queue and archive lifecycle.                            |
| `DOC.PANCREATOR_CONFIG`        | `lib/memory/handbook/pancreator-config.md`                           | `pancreator.yaml` and CLI invocation contract.                |

## Product authority documents

| Key                  | Path                   | Binding use                                                     |
| -------------------- | ---------------------- | --------------------------------------------------------------- |
| `DOC.PRD_SUMMARY`    | `.docs/PRD.summary.md` | Compact PRD orientation.                                        |
| `DOC.PRD_INDEX`      | `.docs/PRD.index.md`   | PRD section routing.                                            |
| `DOC.M1_INDEX`       | `.docs/M1.index.md`    | M1 implementation routing.                                      |
| `DOC.PRD_FULL`       | `.docs/PRD.md`         | Full product authority when compact indexes are insufficient.   |
| `DOC.BOOTSTRAP_FULL` | `.docs/BOOTSTRAP.md`   | Full bootstrap authority when compact indexes are insufficient. |

## Pipelines

| Key                     | Path                                  | Binding use                                         |
| ----------------------- | ------------------------------------- | --------------------------------------------------- |
| `PIPE.FEATURE_DELIVERY` | `lib/pipelines/feature-delivery.yaml` | Feature-delivery state machine and stage contracts. |

## Personas

| Key                           | Path                                  |
| ----------------------------- | ------------------------------------- |
| `PERSONA.ADOPTER`             | `lib/personas/adopter.md`             |
| `PERSONA.CODER`               | `lib/personas/coder.md`               |
| `PERSONA.COMPLIANCE_AUDITOR`  | `lib/personas/compliance-auditor.md`  |
| `PERSONA.CORONER`             | `lib/personas/coroner.md`             |
| `PERSONA.CONTEXT_REVIEWER`    | `lib/personas/context-reviewer.md`    |
| `PERSONA.CONTRACT_WRITER`     | `lib/personas/contract-writer.md`     |
| `PERSONA.DESIGN_ENGINEER`     | `lib/personas/design-engineer.md`     |
| `PERSONA.DESIGN_REVIEWER`     | `lib/personas/design-reviewer.md`     |
| `PERSONA.INTAKE_ANALYST`      | `lib/personas/intake-analyst.md`      |
| `PERSONA.LIBRARIAN`           | `lib/personas/librarian.md`           |
| `PERSONA.PANCREATOR_ENGINEER` | `lib/personas/pancreator-engineer.md` |
| `PERSONA.PERSONA_DESIGNER`    | `lib/personas/persona-designer.md`    |
| `PERSONA.PR_WRITER`           | `lib/personas/pr-writer.md`           |
| `PERSONA.PRODUCT_DESIGN_LEAD` | `lib/personas/product-design-lead.md` |
| `PERSONA.PRODUCT_ENGINEER`    | `lib/personas/product-engineer.md`    |
| `PERSONA.QA_TESTER`           | `lib/personas/qa-tester.md`           |
| `PERSONA.REVIEWER`            | `lib/personas/reviewer.md`            |
| `PERSONA.SME_DESIGN`          | `lib/personas/sme-design.md`          |
| `PERSONA.SME_PRODUCT`         | `lib/personas/sme-product.md`         |
| `PERSONA.SUPERVISOR`          | `lib/personas/supervisor.md`          |
| `PERSONA.TECH_LEAD`           | `lib/personas/tech-lead.md`           |
| `PERSONA.TECH_WRITER`         | `lib/personas/tech-writer.md`         |
