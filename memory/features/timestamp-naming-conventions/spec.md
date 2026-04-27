---
title: Timestamp Naming Conventions Intake Spec
feature_id: timestamp-naming-conventions
status: awaiting-human-clarification
next_owner: operator
next_stage: human_approval
source_inbox_item: inbox/in/timestamp_naming_conventions.md
intake_round: 1
approval_artifact: inbox/threads/timestamp-naming-conventions/round-01-clarify.md
references:
  - kind: lines
    path: inbox/in/timestamp_naming_conventions.md
    range: [1, 18]
    contentHash: TBD-on-commit
    note: Directive goals and scope define the Feature intent and the deferred organization philosophy.
  - kind: lines
    path: inbox/in/timestamp_naming_conventions.md
    range: [19, 31]
    contentHash: TBD-on-commit
    note: Directive operator user stories define the navigability outcomes and the explicit out-of-scope boundary.
  - kind: lines
    path: inbox/in/timestamp_naming_conventions.md
    range: [33, 59]
    contentHash: TBD-on-commit
    note: Directive naming and implementation sections define the sentinel values, path patterns, and migration intent.
  - kind: lines
    path: BOOTSTRAP.md
    range: [223, 243]
    contentHash: TBD-on-commit
    note: Bootstrap Phase 4 requires the intake-analyst dogfood path to emit a canonical Feature spec.
  - kind: lines
    path: PRD.md
    range: [641, 648]
    contentHash: TBD-on-commit
    note: Intake-stage loop control caps the clarifying dialogue at 5 rounds and holds the human-approval gate.
  - kind: lines
    path: memory/handbook/glossary.md
    range: [219, 235]
    contentHash: TBD-on-commit
    note: Glossary entries define Artifact, Feature, Inbox, and Spec Kit alignment for the feature folder.
---

# Spec

This partial draft canonicalizes `inbox/in/timestamp_naming_conventions.md`
into a Feature that defines UTC-based naming rules for temporal artifacts in
`work/` and `inbox/`, plus the migration work needed to adopt those rules
across existing repository content. The draft preserves the directive's
deferred content-organization philosophy and stops at round 1 because
collision, rollover, and migration-boundary decisions remain unresolved.

### Goals

- The directive states that the Feature defines one consistent naming
  convention for temporal artifacts.
- The directive states that the Feature defines the migration needed to adopt
  that convention.
- The directive defers the broader content-organization philosophy to a future
  run.

### Scope

- In scope: Goal 1 and the migration work from Goal 3 that directly supports
  Goal 1.
- Deferred: the high-level content-organization philosophy from Goal 2.

### Operator user stories

- In scope: an operator can navigate archival structures such as `work/` in
  reverse chronological order.
- Partially in scope: an operator can inspect shorter basenames, higher-signal
  metadata, balanced directory depth, and consistent naming symbols.
- Out of scope: operator focus management for agent-only content.

### Naming conventions already stated by the directive

- `work/` day directories use a days-to-`FDS` prefix and an `MM-DD-YY` date
  suffix.
- `work/` child directories use a seconds-to-end-of-day prefix, an `HHMM`
  creation token, and a high-signal semantic suffix.
- `inbox/out/` and `inbox/threads/` system-produced artifacts use the same
  prefix-plus-time-plus-semantic-suffix pattern as day-grouped content.
- Intake processing appends the two time prefixes to non-conforming
  human-generated items in `inbox/in/` or `inbox/threads/`.

### Implementation already stated by the directive

- The implementation encodes the naming convention as policy.
- The implementation migrates existing in-scope `work/` and `inbox/` artifacts
  after policy encoding completes.
- The implementation updates references and documentation that name migrated
  paths.

## Acceptance criteria

- When the Feature derives a timestamp for an in-scope artifact, the Feature
  MUST use `UTC` as the only time zone.
- When the Feature derives the future-date sentinel, the Feature MUST define
  `FDS` as `2500-01-01T00:00:00Z`.
- When the Feature derives the seconds-in-day sentinel, the Feature MUST
  define `SID` as `86400 s`.
- When the Feature creates a day directory under `work/`, the Feature MUST
  prefix the basename with a 6-digit days-to-`FDS` value.
- When the Feature creates a day directory under `work/`, the Feature MUST
  suffix the basename with the creation date in `MM-DD-YY`.
- When the Feature creates a child directory under `work/`, the Feature MUST
  prefix the basename with the seconds remaining until the end of that UTC
  day.
- When the Feature creates a child directory under `work/`, the Feature MUST
  place the `HHMM` creation token after the seconds-remaining prefix.
- When the Feature creates a child directory under `work/`, the Feature MUST
  place a high-signal semantic suffix after the `HHMM` token.
- When the Feature creates a system-produced artifact under `inbox/out/`, the
  Feature MUST use `{SID-prefix}_{HHMM}_{semantic-suffix}` as the basename
  shape.
- When the Feature creates a system-produced artifact under `inbox/threads/`,
  the Feature MUST use `{SID-prefix}_{HHMM}_{semantic-suffix}` as the basename
  shape.
- When the Feature processes a non-conforming human-generated item in
  `inbox/in/`, the Feature MUST append two time prefixes before downstream
  processing continues.
- When the Feature encodes the naming convention, the Feature MUST enforce the
  convention during each in-scope artifact-creation flow.
- When the Feature migrates renamed artifacts, the Feature MUST update each
  reference artifact that names a migrated path.
- When the Feature migrates renamed artifacts, the Feature MUST update each
  documentation artifact that names a migrated path.

## Out of scope

- This Feature does not define the broader content-organization philosophy that
  the directive defers to a future run.
- This Feature does not solve operator focus management for agent-only content.
- This Feature does not rename the intake directive or other inbox artifacts
  during intake-stage canonicalization.

## Open questions

<!-- intake-clarify[round-1]: define temporal artifact scope -->
- `[scope]` Which artifact classes count as "temporal artifacts" for naming
  enforcement and migration?

<!-- intake-clarify[round-1]: define post-2500 rollover -->
- `[constraints]` Which rollover rule applies when the days-to-`FDS` prefix
  reaches `000000` on or after `2500-01-01T00:00:00Z`?

<!-- intake-clarify[round-1]: define collision handling -->
- `[acceptance]` Which basename rule applies when two in-scope artifacts would
  otherwise produce the same prefix, time token, and semantic suffix?

<!-- intake-clarify[round-1]: define same-minute tie-break behavior -->
- `[acceptance]` Which tie-break rule applies when two artifacts share the same
  `HHMM` minute but not the same second?

<!-- intake-clarify[round-1]: define inbox migration scope -->
- `[scope]` Which existing `inbox/` artifacts fall inside migration scope, and
  does that scope include existing round files under `inbox/threads/`?

<!-- intake-clarify[round-1]: define work date-boundary behavior -->
- `[acceptance]` Which parent-day directory applies when a work item starts on
  one UTC day and later artifacts land on a later UTC day?

<!-- intake-clarify[round-1]: define human-generated inbox prefix owner -->
- `[scope]` Which actor applies time prefixes to non-conforming
  human-generated artifacts under `inbox/in/` and `inbox/threads/` during
  intake and migration?
