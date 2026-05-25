---
title: Consolidate 3-variant Cursor agent layout to 1 file per persona
feature_id: consolidate-cursor-agent-variants
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:07Z
references:
  - kind: path
    path: .cursor/agents/
    note: 36 agent files for 12 personas (each persona has base + -standard + -complex); plus 12 .cursor/rules/*.mdc entries; plus 1 general-purpose.
  - kind: path
    path: src/memory/handbook/subagent-model-tiers.md
    note: Defines standard/complex tiering; the canonical source of truth for the model-tier distinction.
  - kind: path
    path: src/memory/handbook/persona-spec.md
    note: Persona spec is canonical; the .cursor projection is meant to be a thin shim, not a triplicated source.
  - kind: path
    path: docs/PRD.md
    note: §6 prescribes a single canonical persona file with an auto-emitted Cursor shim.
---

# Consolidate 3-variant Cursor agent layout to 1 file per persona

## Problem

Every MVP persona today has three Cursor projections:
`.cursor/agents/<name>.md`, `.cursor/agents/<name>-standard.md`, and
`.cursor/agents/<name>-complex.md`. With 12 personas this multiplies into
36 nearly-identical files, plus the 12 rules under `.cursor/rules/`, plus
the canonical persona spec under `src/personas/`. The variants encode a
single binary distinction (standard vs complex model tier) that is already
captured in `src/memory/handbook/subagent-model-tiers.md`. Operators must
remember which suffix to invoke; agents and the persona-emitter must
maintain three files per change; and reviewers must audit three
near-duplicates per persona update.

## Goal

Reduce the Cursor projection surface to one canonical agent file per
persona, with the model-tier choice expressed as metadata or as a single
parameter at invocation time.

## Required outcomes

1. The persona-emitter produces exactly one `.cursor/agents/<name>.md` per
   persona, and one `.cursor/rules/<name>.mdc` shim where the rule layer
   still requires it.
2. The standard-vs-complex selection is expressed in the persona file
   metadata (e.g., `metadata.tesseract-subagent-tiers: { standard, complex }`)
   and resolved at invocation time, not by file suffix.
3. The 24 `<name>-standard.md` and `<name>-complex.md` files are deleted in
   the same PR.
4. AGENTS.md §3 and §4 are updated to reflect the consolidated layout.
5. Subagent-model-tiers handbook page records the migration with an example
   invocation pattern.

## Acceptance criteria

- `.cursor/agents/` lists 12 files (one per persona) plus
  `general-purpose.md`.
- The Cursor invocation grammar still allows the operator to choose a tier
  without ambiguity.
- All persona files retain their canonical `src/personas/<name>.md` source
  of truth.
- A compliance-auditor broad sweep finds zero references to the deleted
  `-standard` / `-complex` filenames in handbook, ADRs, AGENTS.md, or
  active-memory.

## Out of scope

- Reauthoring the persona spec format itself.
- Removing `general-purpose.md` (still required as the routing fallback).
- Changing `subagent-model-tiers.md` semantics.

## Recommended downstream owners

- `persona-designer` for the consolidated-projection emitter.
- `tech-writer` for AGENTS.md and handbook updates.
- `compliance-auditor` for the post-merge sweep against stale references.
