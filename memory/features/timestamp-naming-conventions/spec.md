---
title: Timestamp Naming Conventions Intake Spec
feature_id: timestamp-naming-conventions
status: intake-closed
next_owner: tech-lead
next_stage: plan
source_inbox_item: inbox/in/timestamp_naming_conventions.md
intake_round: 1
closure_artifact: inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md
references:
  - kind: lines
    path: inbox/in/timestamp_naming_conventions.md
    range: [11, 18]
    contentHash: TBD-on-commit
    note: Directive goals and scope define the feature intent and defer the broader organization philosophy.
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
    path: inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md
    range: [10, 87]
    contentHash: TBD-on-commit
    note: Operator answers resolve scope, collision, tie-break, migration, start-day, and inbox-owner questions, and defer the post-2500 rollover rule.
  - kind: lines
    path: BOOTSTRAP.md
    range: [223, 243]
    contentHash: TBD-on-commit
    note: Bootstrap Phase 4 requires the intake-analyst dogfood path to emit a canonical feature spec for downstream planning.
  - kind: lines
    path: PRD.md
    range: [641, 648]
    contentHash: TBD-on-commit
    note: Intake-stage loop control caps the clarifying dialogue at 5 rounds and requires the human-approval gate.
  - kind: lines
    path: memory/handbook/glossary.md
    range: [219, 235]
    contentHash: TBD-on-commit
    note: Glossary entries define Artifact, Feature, Inbox, and Spec Kit alignment for the feature folder.
---

# Spec

This Feature SHALL define one UTC-based naming convention for in-scope temporal artifacts in `work/` and `inbox/`, SHALL migrate existing in-scope artifacts to that convention, and SHALL improve reverse-chronological navigability without changing the broader repository organization philosophy that the directive defers to a future run.

## Acceptance criteria

- When the Feature derives a timestamp for an in-scope artifact, the Feature
  MUST use `UTC` as the only time zone.
- When the Feature derives the future-date sentinel, the Feature MUST define
  `FDS` as `2500-01-01T00:00:00Z`.
- When the Feature derives the seconds-in-day sentinel, the Feature MUST
  define `SID` as `86400 s`.
- When the Feature evaluates naming-policy scope, the Feature MUST include day
  directories and task subdirectories under `work/`.
- When the Feature evaluates naming-policy scope, the Feature MUST include
  artifacts under `inbox/in/`, `inbox/out/`, `inbox/threads/`, and
  `inbox/archive/in/`.
- When the Feature evaluates `work/*/run.log.jsonl`, the Feature MUST treat
  that file path as out of naming-policy scope.
- When the Feature creates a day directory under `work/`, the Feature MUST
  prefix the basename with a 6-digit days-to-`FDS` value.
- When the Feature creates a day directory under `work/`, the Feature MUST
  suffix the basename with the creation date in `MM-DD-YY`.
- When the Feature creates a task subdirectory under `work/`, the Feature MUST
  prefix the basename with the seconds remaining until the end of that UTC day.
- When the Feature creates a task subdirectory under `work/`, the Feature MUST
  place the `HHMM` creation token after the seconds-remaining prefix.
- When the Feature creates a task subdirectory under `work/`, the Feature MUST
  place the high-signal feature slug in the semantic-suffix position.
- When the Feature creates a system-produced artifact under `inbox/out/`, the
  Feature MUST use `{SID-prefix}_{HHMM}_{semantic-suffix}` as the basename
  shape.
- When the Feature creates a system-produced artifact under `inbox/threads/`,
  the Feature MUST use `{SID-prefix}_{HHMM}_{semantic-suffix}` as the basename
  shape.
- When the Feature migrates artifacts under `inbox/threads/`, the Feature MUST
  preserve the existing per-feature parent folder.
- When the Feature processes a non-conforming human-generated artifact in
  `inbox/in/`, the agent performing that work MUST append the two time
  prefixes before downstream processing continues.
- When the Feature processes a non-conforming human-generated artifact in
  `inbox/threads/`, the agent performing that work MUST append the two time
  prefixes before downstream processing continues.
- When two in-scope artifacts would otherwise produce the same
  `{SID-prefix}_{HHMM}_{semantic-suffix}` basename, the Feature MUST insert a
  bare integer collision counter between `HHMM` and the semantic suffix.
- When the Feature inserts a collision counter, the Feature MUST start the
  newest conflicting artifact at `0`.
- When the Feature inserts later collision counters for the same basename, the
  Feature MUST increment the bare integer by `1`.
- When two in-scope artifacts share the same `HHMM` minute but not the same
  second, the Feature MUST treat the seconds-remaining prefix as the only
  tie-break token required by intake.
- When a work item starts on one UTC day and later emits new artifacts on a
  later UTC day, the Feature MUST place those later artifacts under the
  start-day directory.
- When the Feature migrates existing artifacts, the Feature MUST migrate
  already-existing round files under `inbox/threads/`.
- When the Feature migrates existing artifacts, the Feature MUST update each
  reference artifact that names a migrated path.
- When the Feature migrates existing artifacts, the Feature MUST update each
  documentation artifact that names a migrated path.
- When the Feature encodes the actor-ownership rule for non-conforming
  human-generated inbox artifacts, the Feature MUST update
  `memory/handbook/inbox-lifecycle.md`.

## Out of scope

- This Feature does not define the broader repository content-organization
  philosophy that the directive defers to a future run.
- This Feature does not solve operator focus management for agent-only content.
- This Feature does not rename the intake directive or operator response files
  during intake-stage canonicalization.
- This Feature does not rename `work/*/run.log.jsonl`.

## Deferrals

- The post-`2500-01-01T00:00:00Z` rollover rule is deferred by operator
  decision and SHALL remain outside this delivery slice.
- The migration timestamp-source precedence for artifacts that lack an
  authoritative creation timestamp MAY be selected during the plan stage,
  because intake resolved feature scope without ratifying one source order.

## Open questions

- None.
