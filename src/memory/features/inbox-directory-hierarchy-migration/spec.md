---
title: Inbox Directory Hierarchy Migration Intake Spec
feature_id: inbox-directory-hierarchy-migration
status: intake-open
next_owner: intake-analyst
next_stage: intake
source_inbox_item: src/inbox/in/inbox_convention_migration.md
intake_round: 1
intake_thread: src/inbox/threads/inbox-directory-hierarchy-migration/
extends_feature: timestamp-naming-conventions
extends_relationship: extends-deferred-scope
references:
  - kind: lines
    path: src/inbox/in/inbox_convention_migration.md
    range: [1, 1]
    contentHash: 03e17dc152bb45b74cbdf9b459f7a30cbf251722d8016f050b1c5af84b82a72e
    note: "Operator directive defines the migration intent for inbox to mirror work directory conventions."
  - kind: lines
    path: src/memory/features/timestamp-naming-conventions/spec.md
    range: [114, 129]
    contentHash: 0c47ddf6df2f9236d65509cdba0d225dfd86a7a3494d6572b23520f504864d17
    note: "Prior feature explicitly defers broader content-organization philosophy and post-FDS rollover; this feature picks up the deferred organizational scope for inbox subtrees."
  - kind: lines
    path: src/memory/adr/0005-timestamp-naming-conventions.md
    range: [36, 51]
    contentHash: 64d620e338d077214f03804c2b0fe6f9272be895a9d56e551f2d89cfd6915851
    note: "Ratified naming policy defines the day-directory and task-directory shape this migration extends to inbox subtrees."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [67, 77]
    contentHash: 15aa6412f0028b7f96f214977adfe329cc397b95c1c19d47613e474080eaafeb
    note: "Canonical inbox locations under in/, out/, threads/, archive/in/, and the operator-only notes/ sandbox."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [79, 100]
    contentHash: 6f313f6aeb223acb8a8b67563b501b47fa1c43f68de09f083baa401d258914fb
    note: "Operator-sandbox immunity rule excludes src/inbox/notes/ from agent traversal and migration scope."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [142, 158]
    contentHash: 1a108e8636f13b89cc4fa570ee7bf806c6ce2ea20e05f64af438a6fe5fa3f953
    note: "Semantic-immutability rule constrains the migration to path moves plus reference updates without rewriting body content."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [160, 174]
    contentHash: c96a49ed17a85976ed44098a74adbf83a1a73c240d83c4ba9343eed05d469903
    note: "Timestamp-prefix actor-ownership rule for non-conforming human-generated inbox artifacts during migration."
  - kind: lines
    path: AGENTS.md
    range: [157, 189]
    contentHash: 3ea1eff8e35bff46ce5a413b5fd4c7c5dd0e2f865c80ce1ccb59f01dbd1c8f7e
    note: "Workspace map block whose inbox lines require update when the directory hierarchy lands."
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [231, 234]
    contentHash: 32977d62644e45572bce949eac7078f0ce59595e2ec65f2e11613828ad4c31cb
    note: "Glossary Inbox entry whose path enumeration requires update when the directory hierarchy lands."
  - kind: lines
    path: src/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [52, 109]
    contentHash: 1b639f3d822eb7a0d50fedfce6b17a8208719058f7646a254cdd9d363d86fb52
    note: "Existing inbox lifecycle decision boundary that this Feature extends with a directory-hierarchy clause."
---

# Spec

This Feature SHALL migrate the four agent-visible inbox subtrees to a
day-bucketed directory hierarchy that mirrors the `src/work/` layout already
ratified in
`{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [36, 51], contentHash: 64d620e338d077214f03804c2b0fe6f9272be895a9d56e551f2d89cfd6915851}`,
SHALL preserve every basename token defined in
`{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [114, 129], contentHash: 0c47ddf6df2f9236d65509cdba0d225dfd86a7a3494d6572b23520f504864d17}`,
and SHALL update every reference that names a moved inbox path inside the
same delivery slice.

This Feature picks up the deferred organizational philosophy that the prior
`timestamp-naming-conventions` Feature placed out of scope. Citation:
`{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [114, 129], contentHash: 0c47ddf6df2f9236d65509cdba0d225dfd86a7a3494d6572b23520f504864d17}`.

## Acceptance criteria

### Scope and exclusions

- When the Feature evaluates directory-hierarchy scope, the Feature MUST
  include `src/inbox/in/`, `src/inbox/out/`, `src/inbox/threads/`, and
  `src/inbox/archive/in/`.
- When the Feature evaluates directory-hierarchy scope, the Feature MUST
  exclude `src/inbox/notes/` because `/src/inbox/notes/` is an operator-only
  sandbox per the rule cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [79, 100], contentHash: 6f313f6aeb223acb8a8b67563b501b47fa1c43f68de09f083baa401d258914fb}`.
- When the Feature evaluates directory-hierarchy scope, the Feature MUST
  exclude every path outside `src/inbox/` because the directive named only the
  inbox subtree.

### Day-bucket directory shape

- When the Feature creates a day directory under any in-scope inbox
  subtree, the Feature MUST name the directory
  `{days-to-FDS}_{MM-DD-YY}` with a 6-digit zero-padded `days-to-FDS`
  prefix.
- When the Feature derives `days-to-FDS`, the Feature MUST use the
  `FDS = 2500-01-01T00:00:00Z` constant defined at
  `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [50, 70], contentHash: 0c47ddf6df2f9236d65509cdba0d225dfd86a7a3494d6572b23520f504864d17}`.
- When the Feature derives the `MM-DD-YY` suffix, the Feature MUST use the
  UTC calendar date that the artifact attaches to under the timestamp
  precedence ratified by ADR-0005.

### Per-artifact basename shape

- When the Feature places a single-file artifact inside a day bucket, the
  Feature MUST keep the basename shape
  `{SID-prefix}_{HHMM}_{semantic-suffix}` defined at
  `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [77, 90], contentHash: 0c47ddf6df2f9236d65509cdba0d225dfd86a7a3494d6572b23520f504864d17}`.
- When the Feature encounters a non-conforming human-generated artifact in
  `src/inbox/in/` or `src/inbox/threads/`, the agent performing the move MUST
  apply the time-prefix actor-ownership rule cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [160, 174], contentHash: c96a49ed17a85976ed44098a74adbf83a1a73c240d83c4ba9343eed05d469903}`
  before placing the artifact under its new day bucket.
- When the Feature collides on `{SID-prefix}_{HHMM}_{semantic-suffix}` for
  two artifacts inside the same day bucket, the Feature MUST insert a
  bare integer collision counter between `HHMM` and the semantic suffix
  starting at `0` per the rule ratified by the prior feature.

### Threads-subtree handling

- When the Feature migrates `src/inbox/threads/<feature-slug>/`, the Feature
  MUST preserve the `<feature-slug>` parent folder per the prior-feature
  obligation cited above.
- When the Feature places day buckets inside the threads subtree, the
  Feature MUST nest day buckets under each feature folder as
  `src/inbox/threads/<feature-slug>/{days-to-FDS}_{MM-DD-YY}/<round-file>.md`
  unless the round-1 dialogue ratifies a different layout under
  `## Open questions` Q2.

### Migration execution

- When the Feature migrates an existing artifact, the Feature MUST derive
  the day bucket and basename prefixes from the timestamp precedence
  ratified at
  `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [36, 51], contentHash: 64d620e338d077214f03804c2b0fe6f9272be895a9d56e551f2d89cfd6915851}`.
- When the Feature migrates an existing artifact, the Feature MUST
  preserve the artifact's body content per the semantic-immutability rule
  cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [142, 158], contentHash: 1a108e8636f13b89cc4fa570ee7bf806c6ce2ea20e05f64af438a6fe5fa3f953}`.
- When the Feature migrates an existing artifact, the Feature MUST update
  every reference that names the prior path within the same delivery
  slice.
- When the Feature emits the migration manifest, the migration tool MUST
  enumerate every source path and every destination path so the operator
  rollback procedure remains deterministic.

### Tooling

- When the Feature ships migration logic, the Feature MUST stage that
  logic under `tools/` as either an extension to
  `src/internal/tools/migrate-timestamp-naming.mjs` or a sibling
  `tools/migrate-inbox-directory-hierarchy.mjs` per the round-1 dialogue
  resolution under `## Open questions` Q3.
- When the Feature ships migration logic, the migration tool MUST
  default to `--dry-run` and MUST require an explicit
  `TESSERACT_MIGRATION_GO=1` environment guard for write mode, mirroring
  the prior tool's idiom.
- When the Feature ships migration logic, the tool MUST mark
  migration-only affordances with `metadata.tesseract-bootstrap-only:
  true` and the persistent policy with
  `metadata.tesseract-bootstrap-only: false`.

### Compliance and contracts

- When the Feature encodes the directory-hierarchy policy, the Feature
  MUST land a compliance descriptor under `src/internal/tests/compliance/` that
  asserts directory-hierarchy conformance after a `structure-change` or
  `operator-on-demand` trigger.
- When the Feature encodes the policy, the Feature MUST author or extend
  Spec Contracts under
  `src/memory/features/inbox-directory-hierarchy-migration/contracts/`
  covering policy assertion, migration precedence, and reference-update
  audit per the contract format cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [67, 77], contentHash: 15aa6412f0028b7f96f214977adfe329cc397b95c1c19d47613e474080eaafeb}`.

### Documentation impact

- When the Feature lands the new layout, the Feature MUST update the
  AGENTS workspace map block at
  `{kind: lines, path: AGENTS.md, range: [157, 189], contentHash: 3ea1eff8e35bff46ce5a413b5fd4c7c5dd0e2f865c80ce1ccb59f01dbd1c8f7e}`
  to show the day-bucket pattern under the inbox lines.
- When the Feature lands the new layout, the Feature MUST update
  `src/memory/handbook/inbox-lifecycle.md` Section 1 canonical-locations
  enumeration to show the day-bucket pattern.
- When the Feature lands the new layout, the Feature MUST update the
  glossary Inbox entry at
  `{kind: lines, path: src/memory/handbook/glossary.md, range: [231, 234], contentHash: 32977d62644e45572bce949eac7078f0ce59595e2ec65f2e11613828ad4c31cb}`
  to reference the hierarchical layout.
- When the Feature lands the new layout, the Feature MUST update the
  `Out of scope` section of
  `src/memory/features/timestamp-naming-conventions/spec.md` with a
  cross-link to this Feature so the deferred-scope chain remains
  navigable.
- When the Feature lands the new layout, the Feature MUST author one new
  ADR `src/memory/adr/0006-inbox-directory-hierarchy.md` that extends ADR-0005
  unless the round-1 dialogue ratifies an in-place ADR-0005 amendment
  under `## Open questions` Q5.

### Reverse-chronological ordering proof

- When an operator lists any in-scope inbox subtree in lexical order, the
  Feature MUST place the most recent day bucket first because the
  6-digit `days-to-FDS` prefix decreases monotonically with calendar
  time.
- When an operator lists any day bucket in lexical order, the Feature
  MUST place the most recent artifact first because the SID-prefix
  decreases monotonically across the UTC day.

## Out of scope

- This Feature does not modify, traverse, or migrate any path under
  `src/inbox/notes/` because that subtree remains operator-only per the rule
  cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [79, 100], contentHash: 6f313f6aeb223acb8a8b67563b501b47fa1c43f68de09f083baa401d258914fb}`.
- This Feature does not modify the `src/work/` directory layout or the
  basename rules ratified by ADR-0005.
- This Feature does not introduce a backward-compatibility shim for
  pre-migration paths because the migration commit updates every
  reference atomically.
- This Feature does not address the post-`2500-01-01T00:00:00Z`
  rollover rule that ADR-0005 explicitly defers.
- This Feature does not redesign the inbox lifecycle states defined at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [142, 158], contentHash: 1a108e8636f13b89cc4fa570ee7bf806c6ce2ea20e05f64af438a6fe5fa3f953}`.

## Assumptions (round-1 working draft)

The intake-analyst stages the following assumptions for human ratification.
Each assumption resolves an underspecified slot in the directive and binds
to one open question below.

- A1. Single-file artifacts sit directly inside a day bucket with the
  basename shape `{SID-prefix}_{HHMM}_{semantic-suffix}.md`. The Feature
  does not introduce a per-artifact `HHMM` subdirectory because inbox
  items emit one file each, while `src/work/` task directories emit several.
  Tied to Q1.
- A2. Day buckets nest inside `src/inbox/threads/<feature-slug>/` so the
  prior-feature preservation rule for the per-feature parent folder
  remains intact. Tied to Q2.
- A3. The Feature ships migration logic as a new
  `tools/migrate-inbox-directory-hierarchy.mjs` rather than extending
  `src/internal/tools/migrate-timestamp-naming.mjs` so the new tool can encode the
  hierarchy precedence cleanly without complicating the prior tool's
  contract. Tied to Q3.
- A4. The Feature lands a sibling compliance descriptor at
  `src/internal/tests/compliance/inbox-directory-hierarchy.yaml` rather than amending
  `src/internal/tests/compliance/timestamp-naming-conventions.yaml` so the prior
  descriptor's surface remains stable. Tied to Q4.
- A5. The Feature authors one new ADR `0006-inbox-directory-hierarchy.md`
  that extends ADR-0005 by reference. Tied to Q5.
- A6. The Feature migrates the four in-scope subtrees in one atomic
  commit with one manifest. Tied to Q6.
- A7. The Feature applies the day-bucket hierarchy retroactively to every
  artifact already in `src/inbox/archive/in/` because reverse-chronological
  ordering benefits operators reading the archive. Tied to Q7.

## Open questions

The intake-analyst MUST receive operator ratification on each item below
before the spec advances to the `human_approval` gate. The corresponding
round-1 thread message lives at
`src/inbox/threads/inbox-directory-hierarchy-migration/11700_2045_round-01-clarify.md`.

- Q1. Single-file leaf placement versus per-artifact `HHMM` subdirectory.
  The directive says "HHMM-oriented subdirectories"; assumption A1 maps
  `HHMM` to the basename token instead. Does the operator ratify A1, or
  require strict folder-per-item parity with `src/work/`?
- Q2. Threads layout: day-bucket inside the feature folder (A2),
  feature-folder inside the day bucket, or feature-folder remains flat at
  threads top-level with no day buckets at all?
- Q3. Migration tool: extend `src/internal/tools/migrate-timestamp-naming.mjs` or ship
  a sibling `tools/migrate-inbox-directory-hierarchy.mjs` (A3)?
- Q4. Compliance descriptor: extend
  `src/internal/tests/compliance/timestamp-naming-conventions.yaml` or land a sibling
  `src/internal/tests/compliance/inbox-directory-hierarchy.yaml` (A4)?
- Q5. ADR shape: new ADR `0006-inbox-directory-hierarchy.md` extending
  ADR-0005 (A5), or amend ADR-0005 in place?
- Q6. Migration ordering: one atomic migration manifest covering
  `src/inbox/in/`, `src/inbox/out/`, `src/inbox/threads/`, and `src/inbox/archive/in/`
  (A6), or staged subtree-by-subtree across multiple ratification slices?
- Q7. Archive subtree handling: apply the day-bucket hierarchy
  retroactively to every artifact already in `src/inbox/archive/in/` (A7),
  or freeze the archive in its pre-migration shape and only apply the
  hierarchy to future archived items?

## Deferrals

- The post-`2500-01-01T00:00:00Z` rollover rule remains deferred per
  ADR-0005 and SHALL stay outside this delivery slice.
- The timestamp-source precedence for inbox artifacts that lack an
  authoritative creation timestamp follows the precedence already
  ratified by ADR-0005; the planning stage MAY restate the precedence
  with inbox-specific examples but SHALL NOT reorder the precedence.

## Cross-references

- This Feature extends `src/memory/features/timestamp-naming-conventions/`.
  The relationship is `extends-deferred-scope`, recorded in
  `index.json`.
- The directive at
  `src/inbox/in/inbox_convention_migration.md` cites
  `src/personas/tesseract-engineer.md` for downstream implementation
  context; intake-stage produces this spec only and routes downstream
  execution after the `human_approval` gate clears.
