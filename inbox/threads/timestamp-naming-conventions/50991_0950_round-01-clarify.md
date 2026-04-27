---
feature_id: timestamp-naming-conventions
round: 1
stage: intake
owner: intake-analyst
status: awaiting-human-response
created_at: 2026-04-27T09:46:03Z
references:
  - kind: lines
    path: inbox/in/timestamp_naming_conventions.md
    range: [33, 59]
    contentHash: TBD-on-commit
    note: Directive naming and implementation paragraphs supply the source text for the round-1 clarifying questions.
  - kind: lines
    path: memory/features/timestamp-naming-conventions/spec.md
    range: [1, 166]
    contentHash: TBD-on-commit
    note: Partial spec skeleton records the unresolved questions that block intake closure at round 1.
---

# Round 01 Clarification

This round preserves semantic immutability by appending questions instead of
rewriting prior inbox artifacts. The operator is the next actor at the
`human_approval` gate.

> "There is currently no:
> - naming convention for temporal artifacts"

1. Which artifact classes count as "temporal artifacts" for naming-policy
   enforcement and migration: only `work/`, `inbox/out/`, and
   `inbox/threads/`, or also paths such as `inbox/archive/in/` and
   `work/*/run.log.jsonl`?

> "We define a future date sentinel value `FDS` as January 1, 2500."
>
> "Day-specific directories will be prefixed with a value computed as days to
> `FDS`."
>
> "On 1/1/2500, the value will be 000000. If this project and convention are
> still active, then-current operators/agents are welcome to pick a new one."

2. Which rollover rule SHALL govern names when the days-to-`FDS` prefix reaches
   `000000` on or after `2500-01-01T00:00:00Z`: freeze the sentinel, adopt a
   successor sentinel by policy, or use another ratified fallback?

> "Any work started on a day will live in a subdirectory within the day-specific
> directory."
>
> "These subdirs will follow a similar naming convention, based on the time in
> seconds remaining until the end of the day at time of directory creation."
>
> "The second part of the name will be time of creation as HHMM, military
> time."
>
> "The last part of the name will be high-signal feature symbols."

3. Which basename rule SHALL govern collisions when two in-scope artifacts
   would otherwise produce the same `{SID-prefix}_{HHMM}_{semantic-suffix}`
   value?

> "The second part of the name will be time of creation as HHMM, military
> time."
>
> "This will be the prefix."

4. Which tie-break rule SHALL govern two artifacts that share the same `HHMM`
   minute but not the same second: does the seconds-remaining prefix fully
   resolve that case, or does the policy need an additional deterministic token?

> "System produced-items in `out` and `threads` shall follow a similar naming
> scheme as day-specific directories."
>
> "Existing `work` and `inbox` items shall be migrated once encoding is
> complete."

5. Which existing `inbox/` artifacts fall inside migration scope, and does that
   scope include already-existing round files under `inbox/threads/`?

> "The repository will be organized by day. Records for all work that is
> started on a particular day will live in that day's directory."
>
> "Any work started on a day will live in a subdirectory within the day-specific
> directory."

6. Which parent-day directory SHALL govern a work item that starts on one UTC
   day and later emits new artifacts on a later UTC day: the start-day
   directory or a new later-day directory?

> "It shall be the responsibility of the Intake Analyst - or other agent
> processing inbox items - to append the two time prefixes to any
> non-conforming human-generated items in `in` or `threads`."

7. Which actor SHALL own prefix application for non-conforming
   human-generated artifacts under `inbox/in/` and `inbox/threads/` during
   intake and during later migration runs?
