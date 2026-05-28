---
title: Bootstrap cruft cleanup batch — stub feature folders and Cursor agent variants
feature_id: bootstrap-cruft-cleanup-batch
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:12:00Z
references:
  - kind: path
    path: src/memory/features/daedaline-cli/spec.md
    note: 17-line Phase-2 placeholder; identical pattern across 16 sibling daedaline-* feature folders.
  - kind: path
    path: .cursor/agents/
    note: 36 agent files for 12 personas (base + -standard + -complex per persona); plus 12 .cursor/rules/*.mdc; plus general-purpose.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 2 mandates spec/plan/tasks/contracts per package; stub shells satisfy none of those.
  - kind: path
    path: src/memory/handbook/persona-spec.md
    note: Persona spec is canonical; Cursor projections are thin shims, not triplicated sources.
  - kind: path
    path: src/memory/handbook/subagent-model-tiers.md
    note: Standard/complex tiering is metadata-driven; file suffixes duplicate that distinction.
  - kind: path
    path: src/memory/features/json-formatting/
    note: Reference shape for a fully realized M1 feature folder (spec, delivery report, index.json).
  - kind: path
    path: src/inbox/archive/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    note: Prior consolidated-batch intake pattern for multi-package delivery.
---

# Bootstrap cruft cleanup batch — stub feature folders and Cursor agent variants

This intake consolidates two subtractive bootstrap-cleanup items into one
delivery batch. Each work package retains its original `feature_id` for
tracking and downstream feature-folder creation.

| Work package | Original `feature_id` |
|---|---|
| Resolve stub `@daedaline/*` feature folders | `resolve-package-stub-feature-folders` |
| Consolidate Cursor agent variants | `consolidate-cursor-agent-variants` |

## Problem

Two classes of premature surface area inflate audit noise and operator
confusion without adding runtime value:

1. **Stub feature folders.** `src/memory/features/` carries 17 folders of the
   form `daedaline-<pkg>/` where each `spec.md` is a 17-line shell pointing
   at a non-existent contract index. None has `plan.md`, `tasks.md`, a
   delivery report, or `contracts/`. They fail Layer-1 lint by inspection and
   pollute listings that `librarian` and `ddl feature` operate against.

2. **Triplicated Cursor agent files.** Every MVP persona has three Cursor
   projections: `.cursor/agents/<name>.md`, `<name>-standard.md`, and
   `<name>-complex.md` (36 files for 12 personas), plus 12 `.mdc` rules and
   canonical `src/personas/<name>.md`. The variants encode a single
   standard-vs-complex distinction already defined in
   `src/memory/handbook/subagent-model-tiers.md`. Operators must remember
   suffixes; maintainers must edit three near-duplicates per persona change.

## Goal

Remove or consolidate bootstrap cruft in one coordinated pass so feature
indexing, persona projection, and compliance sweeps reflect a single
canonical surface per package and per persona.

## Required outcomes

### Work package A — `resolve-package-stub-feature-folders`

1. A tech-lead-authored disposition table classifies each of the 17
   `daedaline-<pkg>/` folders into one of three buckets:
   - `author`: complete spec/plan/tasks/contracts to Phase-2 standard.
   - `consolidate`: fold into a `phase-2-substrate-contracts/` umbrella
     feature folder.
   - `delete`: remove with a deletion ADR when the package README owns the
     residual contract.
2. For `author` items, bring folders up to the `json-formatting` reference
   shape (delivery report, `index.json`, contract clauses).
3. For `consolidate` items, the umbrella folder cites every consolidated
   package and inherits Phase-2 dependency order.
4. For `delete` items, the deletion ADR cites BOOTSTRAP Phase-2 language.
5. `src/memory/features/index.json` is updated in lockstep.

### Work package B — `consolidate-cursor-agent-variants`

1. The persona-emitter produces exactly one `.cursor/agents/<name>.md` per
   persona and one `.cursor/rules/<name>.mdc` shim where the rule layer
   still requires it.
2. Standard-vs-complex selection is expressed in persona metadata (for
   example `metadata.daedaline-subagent-tiers`) and resolved at invocation
   time, not by file suffix.
3. The 24 `<name>-standard.md` and `<name>-complex.md` files are deleted in
   the same change set.
4. `AGENTS.md` §3 and §4 reflect the consolidated layout.
5. `src/memory/handbook/subagent-model-tiers.md` records the migration with
   an example invocation pattern.

### Cross-cutting

- One delivery report covers both work packages and records the disposition
  table plus the agent-file deletion manifest.
- A single compliance-auditor broad sweep validates zero stale references
  to deleted paths or filenames.

## Acceptance criteria

- Zero feature folders with a 17-line stub `spec.md` remain.
- `.cursor/agents/` lists 12 persona files plus `general-purpose.md` (no
  `-standard` or `-complex` suffix files).
- The Cursor invocation grammar still allows the operator to choose a tier
  without ambiguity.
- A compliance-auditor broad sweep reports zero `block` findings tied to
  placeholder feature shells or references to deleted `-standard` /
  `-complex` agent filenames in handbook, ADRs, `AGENTS.md`, or
  active-memory.
- The disposition table is referenced from `src/memory/active/current.md`
  until the cleanup ships.

## Out of scope

- Authoring new contracts beyond the Phase-2 surface enumerated in BOOTSTRAP.
- Reauthoring the persona spec format or changing `subagent-model-tiers.md`
  semantics.
- Removing `general-purpose.md`.
- Renaming `@daedaline/*` packages whose implementation surface is otherwise
  stable.

## Recommended downstream owners

| Work package | Primary owners |
|---|---|
| A — stub feature folders | `tech-lead` (disposition table, consolidation ADR); `contract-writer` (`author` folders); `librarian` (index + active-memory) |
| B — Cursor agent variants | `persona-designer` (emitter); `tech-writer` (AGENTS + handbook); `compliance-auditor` (stale-reference sweep) |
| Batch integration | `supervisor` (single staged outcome); `reviewer` (touch-set and deletion manifest) |
