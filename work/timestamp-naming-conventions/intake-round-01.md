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
