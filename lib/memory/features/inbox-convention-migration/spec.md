---
title: Inbox convention migration — Engineering Spec
feature_id: inbox-convention-migration
status: implement
source_inbox_item: lib/inbox/in/inbox_convention_migration.md
references:
  - kind: lines
    path: lib/inbox/in/inbox_convention_migration.md
    range: [1, 2]
    contentHash: 9e48b26
    note: Operator directive states inbox SHALL mirror work directory conventions.
  - kind: lines
    path: .docs/PRD.md
    range: [641, 648]
    contentHash: 2eb6aa4
    note: feature-delivery intake outputs canonical spec and uses human_approval gate.
  - kind: lines
    path: AGENTS.md
    range: [107, 110]
    contentHash: b953d77
    note: Operator sandbox notes/ SHALL stay off-limits to agents during any migration.
  - kind: lines
    path: AGENTS.md
    range: [189, 191]
    contentHash: b953d77
    note: Workspace map lists canonical inbox subtree roots versus notes/.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [67, 75]
    contentHash: 2762053
    note: Canonical inbox locations including .pan/archive/in/ and notes/ exclusion rules.
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [252, 258]
    contentHash: c70da7c
    note: Glossary defines Inbox layout and Spec Kit alignment for feature folders.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [54, 76]
    contentHash: 294422f
    note: Ratified UTC, FDS, SID, and work day plus task subdirectory naming tokens.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [80, 84]
    contentHash: 294422f
    note: Prior ratified threads layout keeps a per-feature parent; this Feature relocates under day-first directories during migration.
  - kind: lines
    path: lib/internal/tools/migrate-timestamp-naming.mjs
    range: [270, 302]
    contentHash: 02eadfb
    note: Current planner renames inbox basenames inside flat parents; inbox nesting SHALL land in a separate module per operator decision.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml
    range: [1, 9]
    contentHash: 0fb8d45
    note: Ratified timestamp selection precedence used by migration planning.
  - kind: lines
    path: lib/internal/packages/@pancreator/inbox/lib/file-inbox.ts
    range: [44, 49]
    contentHash: 9338ed5
    note: Inbox runtime currently rejects nested relative paths; compatibility work SHALL precede nesting enforcement.
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [60, 76]
    contentHash: d521e35
    note: Layer 1 requires one RFC 2119 keyword and one EARS form per normative clause.
---

# Spec

This Feature SHALL apply directory-level organization under `lib/inbox/` that matches the day-oriented and HHMM-oriented layout already used under `.pan/work/`, so operators obtain the same reverse-chronological ordering by path sort. The ratified Feature `timestamp-naming-conventions` already defines UTC time zone, `FDS`, `SID`, collision counters, and work tree shape. This Feature SHALL extend that parity from flat inbox parents to nested day and task directories without reading or writing `lib/inbox/notes/`.

When the Feature evaluates nesting scope under `lib/inbox/`, the Feature SHALL apply the work-style layout to `lib/inbox/in/`, `lib/inbox/out/`, `lib/inbox/threads/`, and `.pan/archive/inbox/in/`.

When the Feature derives a timestamp for any inbox artifact migration, the Feature SHALL select the git oldest-add timestamp before `created_at` frontmatter before filesystem `mtime` before an operator override.

When the Feature migrates an artifact under `lib/inbox/in/`, the Feature SHALL relocate that artifact to `lib/inbox/in/<work-style-day-directory>/<work-style-task-directory>/<original-basename>`.

When the Feature migrates an artifact under `lib/inbox/out/`, the Feature SHALL relocate that artifact to `lib/inbox/out/<work-style-day-directory>/<work-style-task-directory>/<original-basename>`.

When the Feature migrates an artifact under `.pan/archive/inbox/in/`, the Feature SHALL relocate that artifact to `.pan/archive/inbox/in/<work-style-day-directory>/<work-style-task-directory>/<original-basename>`.

When the Feature migrates `lib/inbox/threads/`, the Feature SHALL place artifacts beneath `lib/inbox/threads/<work-style-day-directory>/`.

When the Feature migrates an artifact under `lib/inbox/threads/`, the Feature SHALL relocate that artifact to `lib/inbox/threads/<work-style-day-directory>/<work-style-task-directory>/<original-basename>`.

When migration completes for `lib/inbox/threads/`, the Feature SHALL NOT use a persistent `lib/inbox/threads/<feature-id>/` directory as the primary path locator for those artifacts.

When the Feature names a task subdirectory under `lib/inbox/threads/`, the Feature SHALL apply the same seconds-remaining prefix, `HHMM` token, and collision-counter position the `timestamp-naming-conventions` Feature cites for `.pan/work/` task subdirectories.

When the Feature sets the semantic suffix on that task subdirectory, the Feature SHALL combine the feature identifier and filename-derived task stem without repeating an identical normalized task stem.

When the Feature derives the task stem for a Markdown file in `lib/inbox/in/`, the Feature SHALL derive that stem solely from that file's filename stem after stripping legacy `{SID}_{HHMM}_` and leading `YYYY-MM-DD[-HHMM]` tokens.

When the Feature derives the task stem for a non-Markdown inbox artifact under any ratified inbox subtree, the Feature SHALL derive that stem solely from that artifact's filename stem after stripping legacy `{SID}_{HHMM}_` and leading `YYYY-MM-DD[-HHMM]` tokens.

When the Feature organizes a task directory under any ratified inbox subtree, the Feature MAY place more than one file in that directory.

When the Feature implements inbox nesting, the Feature SHALL ship the planner and writer in a dedicated module that remains separate from `lib/internal/tools/migrate-timestamp-naming.mjs`.

When the Feature executes inbox nesting migration, the Feature SHALL generate a deterministic manifest that maps every in-scope legacy inbox path to a target nested inbox path before applying writes.

When the Feature applies a write plan for inbox nesting migration, the Feature SHALL persist the approved manifest so rollback can invert that mapping.

When the Feature updates inbox runtime access for nesting, the Feature SHALL ensure operators can list and read migrated inbox artifacts without requiring flat single-segment inbox names.

When the Feature migrates inbox paths, the Feature SHALL execute every inbox subtree transformation and every remaining flat rename for the prior `timestamp-naming-conventions` inbox scope in one operator-approved pass that preserves idempotency with existing `{SID-prefix}_{HHMM}_` basenames.

## Acceptance criteria

- When the Feature evaluates naming scope, the Feature MUST treat `lib/inbox/notes/` as permanently out of scope for every migration, rename, and documentation update.
- When the Feature evaluates nesting scope under `lib/inbox/`, the Feature MUST apply work-style nesting to `lib/inbox/in/`, `lib/inbox/out/`, `lib/inbox/threads/`, and `.pan/archive/inbox/in/`.
- When the Feature applies work-style layout to a ratified inbox subtree, the Feature MUST use `UTC` as the only time zone for every derived directory token.
- When the Feature derives a timestamp for any inbox artifact migration, the Feature MUST select the git oldest-add timestamp before `created_at` frontmatter before filesystem `mtime` before an operator override.
- When the Feature applies work-style layout, the Feature MUST derive the six-digit days-to-`FDS` prefix and the `MM-DD-YY` day-directory suffix using the same rules as the `timestamp-naming-conventions` Feature cites for `.pan/work/`.
- When the Feature applies work-style layout, the Feature MUST derive the seconds-remaining prefix, the `HHMM` token, and the semantic suffix position using the same rules as the `timestamp-naming-conventions` Feature cites for `.pan/work/` task subdirectories.
- When the Feature migrates `lib/inbox/threads/`, the Feature MUST place artifacts under `lib/inbox/threads/<work-style-day-directory>/`.
- When the Feature migrates `lib/inbox/threads/`, the Feature MUST NOT retain `lib/inbox/threads/<feature-id>/` as the primary locator after migration completes.
- When the Feature names a task subdirectory under `lib/inbox/threads/`, the Feature MUST set the semantic suffix to a normalized feature/task semantic that does not repeat identical feature and filename-stem tokens.
- When the Feature derives the task stem for a Markdown file in `lib/inbox/in/`, the Feature MUST derive that stem solely from that file's filename stem after stripping legacy `{SID}_{HHMM}_` and leading `YYYY-MM-DD[-HHMM]` tokens.
- When the Feature organizes a task directory under a ratified inbox subtree, the Feature MAY place more than one file in that directory.
- When the Feature migrates an inbox artifact whose path crosses the ratified subtree list, the Feature MUST relocate that artifact beneath the new day directory and task subdirectory pattern instead of leaving only a flat parent rename.
- When the Feature implements inbox nesting migration, the Feature MUST deliver the planner and writer in a dedicated module separate from `lib/internal/tools/migrate-timestamp-naming.mjs`.
- When the Feature implements inbox nesting migration, the Feature MUST generate a deterministic manifest that maps every in-scope legacy inbox path to a target nested inbox path before applying writes.
- When the Feature implements inbox nesting migration, the Feature MUST persist the approved manifest so rollback can invert that mapping.
- When the Feature updates inbox runtime access for nesting, the Feature MUST ensure operators can list and read migrated inbox artifacts without requiring flat single-segment inbox names.
- When the Feature implements inbox nesting migration, the Feature MUST add or extend repository tests so CI encodes the nested inbox target shapes.
- When the Feature finishes a path migration, the Feature MUST update every reference artifact and every documentation artifact that names a legacy inbox path, including `lib/memory/handbook/inbox-lifecycle.md` when canonical path prose changes.
- When the Feature plans execution for inbox migration, the Feature MUST combine every inbox subtree transformation and every remaining flat rename for the prior `timestamp-naming-conventions` inbox scope into one operator-approved pass that stays idempotent with existing `{SID-prefix}_{HHMM}_` basename prefixes.
- When the Feature touches documented operational primitives or operator interfaces under `lib/inbox/`, the operator MUST run `tests/compliance/` descriptors against `tests/compliance/schemas/latest.yaml` before merge per repository guidance in `AGENTS.md` section 6.1.

## Out of scope

- This Feature does not relax the agent ban on `lib/inbox/notes/` traversal or mutation.
- This Feature does not redefine `FDS`, `SID`, or post-`FDS` rollover policy; those remain owned by the `timestamp-naming-conventions` Feature and its deferrals.
- This Feature does not rename `.pan/work/*/*/run.log.jsonl`.
- This Feature does not ship git commits, pull requests, or production pushes; the human operator remains in the loop per `LocalUserAuthorizer`.
- This Feature does not by itself rewrite the ratified prose in `lib/memory/features/timestamp-naming-conventions/spec.md`.

## Open questions

- When a thread artifact migrates under day and task directories, what is the canonical operator lookup key for that artifact outside filesystem traversal. **Answer**: Filesystem traversal under `lib/inbox/threads/<day>/<feature-slug>/` is canonical; no separate inbox artifact index is maintained.
- When a migrated inbox artifact collides on `<work-style-task-directory>` naming, does the migration rely solely on the collision counter token, or does it permit operator overrides in the approved manifest. **Answer**: Collision counter token only.
- When inbox nesting lands, does the repository permit legacy-path compatibility artifacts (such as symlinks) or does it require pure relocation plus reference rewrites only. **Answer**: Relocation + reference updates only.