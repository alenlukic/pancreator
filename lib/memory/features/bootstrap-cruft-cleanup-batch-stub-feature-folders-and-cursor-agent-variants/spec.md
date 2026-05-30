---
title: "Bootstrap cruft cleanup batch — stub feature folders and Cursor agent variants"
feature_id: bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172981_05-25-26/71700_0612_bootstrap-cruft-cleanup-batch.md
intake_round: 1
work_packages:
  - id: resolve-package-stub-feature-folders
    label: "Resolve stub @pancreator/* feature folders"
  - id: consolidate-cursor-agent-variants
    label: "Consolidate Cursor agent variants"
references:
  - kind: lines
    path: lib/inbox/in/172981_05-25-26/71700_0612_bootstrap-cruft-cleanup-batch.md
    range: [1, 137]
    contentHash: ec6a02d
    note: "Source directive: consolidated batch intake for stub feature folder resolution and Cursor agent variant consolidation."
  - kind: lines
    path: lib/memory/features/pancreator-cli/spec.md
    range: [1, 23]
    contentHash: 26b1233
    note: "Representative package engineering spec after frontmatter addition; sibling pancreator-* folders follow the same layered contract pattern."
  - kind: lines
    path: lib/memory/handbook/subagent-model-tiers.md
    range: [1, 109]
    contentHash: 94471db
    note: "Standard/complex tiering authority; file suffixes in .cursor/agents/ duplicate information already encoded here."
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [1, 179]
    contentHash: 697b305
    note: "Reference shape for a fully realized M1 feature folder: spec.md, delivery-report.md, index.json, and contract clauses."
---

# Spec

This Feature removes two classes of premature surface area from the Pancreator
repository in one coordinated cleanup pass. Each work package retains its
original `feature_id` for downstream tracking.

**Work package A (`resolve-package-stub-feature-folders`)** brings the current
inventory of **20** `lib/memory/features/pancreator-*/` folders to Phase-2
reference shape alongside `lib/memory/features/json-formatting/`: layered
specification plus `delivery-report.md`, `index.json`, and lockstep updates to
`lib/memory/features/index.json`. Some folders already carried `plan.md`,
`tasks.md`, and `contracts/`; this pass preserves those surfaces and only adds
the missing memory artifacts.

**Work package B (`consolidate-cursor-agent-variants`)** removes per-persona
filename triplication in `.cursor/agents/`. Each of the 12 MVP personas carried
`*-standard.md` and `*-complex.md` mirrors in addition to `<name>.md`, totalling
36 persona files, plus `general-purpose.md`, plus 12 `.cursor/rules/*.mdc` shims.
The standard-vs-complex tier distinction already lives in
`lib/memory/handbook/subagent-model-tiers.md`; filename suffixes duplicated that
metadata and imposed three-way edits per persona change.

## Acceptance criteria

### Work package A — stub feature folder resolution

- When `tech-lead` authors the disposition table, the table SHALL classify
  each of the 20 `lib/memory/features/pancreator-*/` stub folders into exactly
  one of three buckets: `author`, `consolidate`, or `delete`.

- When the disposition table classifies a folder as `author`, `tech-lead`
  SHALL bring that folder to the reference shape defined by
  `lib/memory/features/json-formatting/` — `spec.md` meeting Layer-1 lint,
  `delivery-report.md`, and `index.json` — to Phase-2 standard per
  `docs/BOOTSTRAP.md`.

- When the disposition table classifies a folder as `consolidate`, `tech-lead`
  SHALL fold that folder into a `phase-2-substrate-contracts/` umbrella feature
  folder that cites every consolidated package by name and preserves the
  Phase-2 dependency order declared in `docs/BOOTSTRAP.md`.

- When the disposition table classifies a folder as `delete`, `tech-lead`
  SHALL author a deletion ADR that cites `docs/BOOTSTRAP.md` Phase-2 language
  and confirms that the relevant package `README` owns the residual contract
  surface.

- When all dispositions are complete, `lib/memory/features/index.json` SHALL
  reflect the updated feature set in lockstep with the disposition changes.

- When the cleanup ships, every `lib/memory/features/pancreator-*/` folder covered
  by the disposition table SHALL carry paired `delivery-report.md` and `index.json`
  entries that satisfy the librarian pairing contract.

### Work package B — Cursor agent variant consolidation

- When `persona-designer` emits Cursor projections, the emitter SHALL produce
  exactly one `.cursor/agents/<name>.md` file per persona and exactly one
  `.cursor/rules/<name>.mdc` shim per persona where the rule layer still
  requires it.

- When `persona-designer` records the standard-vs-complex tier distinction,
  the distinction SHALL be expressed in the persona YAML metadata field
  `metadata.pancreator-subagent-tiers` and SHALL be resolved at invocation time
  per `lib/memory/handbook/subagent-model-tiers.md`; the distinction SHALL NOT
  be encoded as a filename suffix.

- When the consolidation change set is staged, it SHALL delete all 24
  `-standard.md` and `-complex.md` suffix files under `.cursor/agents/` in
  the same change set.

- When the consolidation ships, `.cursor/agents/` SHALL list exactly 12
  persona files plus `general-purpose.md` with no `-standard` or `-complex`
  suffix files present.

- When `tech-writer` updates the documentation, `AGENTS.md §3` and `AGENTS.md
  §4` SHALL reflect the consolidated single-file-per-persona layout.

- When `tech-writer` updates the handbook, `lib/memory/handbook/
  subagent-model-tiers.md` SHALL record the migration rationale and SHALL
  include an example invocation pattern that demonstrates tier selection
  without filename suffixes.

### Cross-cutting

- When the batch ships, one delivery report SHALL cover both work packages and
  SHALL record the disposition table (work package A) and the agent-file
  deletion manifest (work package B).

- When `compliance-auditor` runs a broad sweep after the batch ships, the
  sweep SHALL report zero `block`-severity findings tied to placeholder feature
  shells or to references to deleted `-standard` / `-complex` agent filenames
  in handbook files, ADRs, `AGENTS.md`, or active-memory.

- When the operator invokes a Cursor agent after the consolidation ships, the
  tier selection grammar SHALL allow the operator to choose `standard` or
  `complex` tier without ambiguity and without relying on filename suffixes.

## Out of scope

- Authoring contracts beyond the Phase-2 surface enumerated in
  `docs/BOOTSTRAP.md`.
- Changing the semantics of `lib/memory/handbook/subagent-model-tiers.md` or
  the persona spec format.
- Removing `general-purpose.md` from `.cursor/agents/`.
- Renaming `@pancreator/*` packages whose implementation surface is otherwise
  stable.
- Automatically executing the compliance sweep; `compliance-auditor` SHALL run
  the sweep as a post-delivery validation step triggered by the operator.

## Deferrals

- **Disposition table authoring.** The per-folder classification (`author` /
  `consolidate` / `delete`) for each of the 20 `pancreator-*` stub folders is
  deferred to the `tech-lead` plan stage. Intake does not pre-classify; each
  disposition requires reading `docs/BOOTSTRAP.md` Phase-2 dependency order
  and the per-package `README` contract surface. Backlog linkage:
  `resolve-package-stub-feature-folders` (work package A).

- **Invocation grammar schema.** The exact YAML schema for
  `metadata.pancreator-subagent-tiers` and the companion Cursor invocation
  pattern are deferred to `persona-designer` in the plan and implement stages.
  Backlog linkage: `consolidate-cursor-agent-variants` (work package B).

## Open questions

- None.
