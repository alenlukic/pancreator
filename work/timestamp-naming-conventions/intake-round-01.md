# Intake Round 01

- Feature: `timestamp-naming-conventions`
- Stage: `intake`
- Directive: `inbox/in/timestamp_naming_conventions.md`
- Spec draft: `memory/features/timestamp-naming-conventions/spec.md`
- Thread artifact: `inbox/threads/timestamp-naming-conventions/round-01-clarify.md`
- Round cap: `5`
- Current state: partial spec staged with 7 open questions for operator
  resolution.

## Open questions

1. Define the in-scope meaning of "temporal artifacts".
2. Define the post-`2500-01-01T00:00:00Z` rollover rule.
3. Define collision handling for identical `{SID-prefix}_{HHMM}_{semantic-suffix}` values.
4. Define same-minute tie-break behavior.
5. Define migration scope for existing `inbox/` artifacts, including
   `inbox/threads/`.
6. Define whether later-day artifacts stay under the start-day `work/`
   directory.
7. Define which actor owns prefix application for non-conforming
   human-generated inbox artifacts during intake and migration.

## Notes for parent

- No directive or inbox artifact was renamed during intake.
- No commit or push was performed.
- `policy-compliance.json` was intentionally not authored in this stage.

## Round 1 closure

- Intake status: `closed`
- Closing artifact:
  `inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md`
- Updated spec: `memory/features/timestamp-naming-conventions/spec.md`
- Updated index: `memory/features/timestamp-naming-conventions/index.json`

### Resolved decisions

1. Temporal-artifact scope includes `work/` directories plus all inbox artifacts
   under `inbox/{in,out,threads,archive/in}`.
2. `work/*/run.log.jsonl` remains out of naming-policy scope.
3. Collision handling uses a bare integer counter inserted as
   `{SID-prefix}_{HHMM}_0_{semantic-suffix}` and increments by `1`.
4. The seconds-remaining prefix fully resolves same-minute tie-breaks.
5. Existing thread round files are in migration scope.
6. Later-day artifacts stay under the start-day `work/` directory.
7. Whichever agent performs the work owns prefix application for
   non-conforming human-generated inbox artifacts.

### Residual ambiguity disposition

- `inbox/threads/` parent folders: resolved from context by preserving the
  per-feature parent folder, because the directive defers broader
  organization-structure changes.
- Migration timestamp basis: deferred to plan stage as an implementation
  selection for artifacts that lack an authoritative creation timestamp.
- Collision counter format: resolved from the operator's `_0_` example and
  "increment by 1" instruction as a zero-indexed bare integer.
- Handbook surface: resolved as in-scope for plan because the operator
  explicitly directed the rule into `memory/handbook/inbox-lifecycle.md`.
- `work/<task-id>/` subdirectory naming: resolved from context by treating the
  existing task slug as the semantic suffix inside the new basename shape.
