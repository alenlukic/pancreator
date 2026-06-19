---
slug: persona-contracts
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [persona-designer, supervisor]
purpose: Static contract requirements that every persona spec must own directly.
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/persona-spec.md
  - /lib/memory/handbook/output-manifest-contract.md
...

# Operator section
- 👀 **In this file:** Persona Static Contracts
- ⚖️ **Why it matters:** Quick orientation for Persona Static Contracts before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/persona-spec.md

# Persona Static Contracts

Persona contracts are static repo artifacts. Agents MUST NOT decide or rewrite
their own contract per invocation. A persona may use judgment inside the bounds
of its contract, but the contract itself lives in `lib/personas/<name>.md` and is
reviewed like source code.

## Required persona fields

Each persona frontmatter `metadata` MUST include:

```yaml
pancreator-contract-key: PERSONA.<NAME>
pancreator-required-docs:
  - DOC.AGENTS
  - DOC.REGISTRY
  - DOC.PERSONA_CONTRACTS
  - DOC.OUTPUT_MANIFEST
pancreator-output-manifest: required
```

Personas SHOULD add narrower required docs for their responsibilities, for
example `DOC.ENG_SOFTWARE`, `DOC.ENG_TYPESCRIPT`, `DOC.DESIGN_CRAFT`,
`DOC.COMPLIANCE_RUNS`, or `PIPE.FEATURE_DELIVERY`.

## Required body section

Each persona body MUST include `## Static execution contract` with these
subsections, in this order:

1. `### Required context` — exact `DOC.*`, `PIPE.*`, `PERSONA.*`, and stage input
   artifacts the persona must load before its owned responsibility.
2. `### Responsibilities` — ordered work steps the persona owns.
3. `### Definition of done` — artifact, gate, validation, and evidence conditions
   that complete the responsibility.
4. `### Output manifest` — where the manifest is written in artifacts and how it
   is echoed to chat/stdout.
5. `### Gate validator` — the persona, runtime validator, or human gate that
   checks the output before transition.

The section MUST be specific enough that another model can follow it without
inventing missing workflow or documentation mappings.

## Supervisor contract

A supervisor persona owns transition validation. It MUST verify the previous
stage's required outputs, output manifest, definition-of-done claim, and declared
gate predicates before allowing the pipeline to advance. If validation fails, it
MUST route remediation to the owner named in the pipeline stage contract.
