# Operator section
- 👀 **In this file:** Engineering Standards Index
- ⚖️ **Why it matters:** Quick orientation for Engineering Standards Index before agents load the full contract.
- 🧭 **See also:**
  - kind: lines
  - kind: lines
  - /lib/memory/handbook/engineering/software-engineering.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Engineering Standards Index
slug: engineering-standards-index
stability: experimental
bootstrap-only: false
phase: 0b
owners: [reviewer, tech-lead, pancreator-engineer]
purpose: |
  Routing map for the global engineering standards corpus. Agents writing,
  reviewing, refactoring, or testing code SHALL select the minimum set of
  standards pages required for the task from this index, and SHALL apply them as
  binding obligations rather than optional guidance.
references:
  - kind: lines
    path: AGENTS.md
    range: [1, 1]
    contentHash: b953d77
    note: "AGENTS working agreement binds code-writing personas to the engineering standards corpus."
  - kind: lines
    path: lib/memory/handbook/index.md
    range: [1, 1]
    contentHash: 5c703c0
    note: "Handbook routing index routes engineering-standards intents to this page."
related:
  - /lib/memory/handbook/engineering/software-engineering.md
  - /lib/memory/handbook/engineering/typescript.md
  - /lib/memory/handbook/engineering/design-craft.md
  - /lib/memory/handbook/engineering/design/design-system.md
  - /lib/memory/handbook/engineering/design/component-standard.md
  - /lib/memory/handbook/engineering/design/control-surface-ux.md
  - /lib/memory/handbook/contract-style.md
---

# Engineering Standards Index

This corpus holds the global, language-agnostic and language-specific engineering
standards that govern how agents write, review, refactor, and test code and how
agents critique product design. Every page here is binding for the activities it
names; the standards are obligations, not suggestions.

## Applicability

| Activity | Agent SHALL load | Notes |
|---|---|---|
| Write, refactor, or debug code in any language | `/lib/memory/handbook/engineering/software-engineering.md` | Durable software engineering principles. |
| Review or test code in any language | `/lib/memory/handbook/engineering/software-engineering.md` | Reviewers and QA apply the same standard the author followed. |
| Author or modify TypeScript, ES2022+, or ESM-aware tooling | `/lib/memory/handbook/engineering/typescript.md` plus the software-engineering page | The TypeScript guide layers on top of the general standard. |
| Author a UX spec or run design QA | `/lib/memory/handbook/engineering/design-craft.md` | Product design and UI craft taste profile. |
| Implement or restyle UI under `client/` | `/lib/memory/handbook/engineering/design/design-system.md` plus `/lib/memory/handbook/engineering/design/component-standard.md` | Token canon and component/icon stack bind all UI implementation. |
| Specify, implement, or review an operator control surface | `/lib/memory/handbook/engineering/design/control-surface-ux.md` plus the design-craft page | Orientation, triage, receipt, and gating obligations for control surfaces. |

When more than one page applies, the agent SHALL load the general
software-engineering standard first, then the language- or domain-specific page.

## Standards corpus

| Page | Scope |
|---|---|
| `/lib/memory/handbook/engineering/software-engineering.md` | Correctness, clarity, cohesion, testing, resilience, security, and minimalism across all languages. |
| `/lib/memory/handbook/engineering/typescript.md` | Strict TypeScript, ES2022+ language features, runtime validation, module boundaries, and tooling coherence. |
| `/lib/memory/handbook/engineering/design-craft.md` | Product design and UI craft taste profile for `design-engineer` and `design-reviewer`. |
| `/lib/memory/handbook/engineering/design/design-system.md` | Canonical design tokens (brand palette, status ramps, scales) and the CSS-variable contract for operator surfaces. |
| `/lib/memory/handbook/engineering/design/component-standard.md` | Component-library (shadcn/ui + Radix + Tailwind) and icon-set (Lucide) standard with forbidden styling practices. |
| `/lib/memory/handbook/engineering/design/control-surface-ux.md` | Interaction-pattern obligations for operator control surfaces: orientation, triage, receipts, gates, and motion. |

## Enforcement

1. Personas that write or review code SHALL list the applicable standards pages in
   `metadata.pancreator-required-docs` using `DOC.*` keys and SHALL apply them at invocation.
2. `reviewer` SHALL treat an unmet standard in scope of the change as a `must fix`
   finding when the standard is correctness- or security-bearing, and as a
   `consider` finding for craft or polish.
3. `qa-tester` SHALL treat standards-mandated validation gates (type checks, lint,
   tests) as part of the automated checks table.

## Growth path

A new language or domain guide MAY be added under
`/lib/memory/handbook/engineering/`. The author SHALL add the new page to the
Applicability and Standards-corpus tables in the same change set, SHALL add a
routing row to `/lib/memory/handbook/index.md`, and SHALL wire the page into the
`metadata.pancreator-required-docs` of every persona the standard governs.

## Stability

This page is an engineering-standards seed and remains `experimental` until runtime
retrieval wiring and standards-conformance checks are implemented and validated.
