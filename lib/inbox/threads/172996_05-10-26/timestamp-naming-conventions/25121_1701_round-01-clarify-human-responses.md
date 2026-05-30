# Round 01 Clarification

This round preserves semantic immutability by appending questions instead of
rewriting prior inbox artifacts. The operator is the next actor at the
`human_approval` gate.

> "There is currently no:
> - naming convention for temporal artifacts"

1. Which artifact classes count as "temporal artifacts" for naming-policy
   enforcement and migration: only `work/`, `lib/inbox/out/`, and
   `lib/inbox/threads/`, or also paths such as `archive/inbox/in/` and
   `work/*/run.log.jsonl`?
   **Answer**: For  `archive/inbox/in/`, yes. For  `work/*/run.log.jsonl` - I'm not sure I understand the question. This is an individual file within each work record. Going with "no."

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
   **Answer**: Defer. Realistically, this isn't going to come up.

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
   **Answer**: This seems unlikely, but to be safe, if a name conflict arises, insert a numerical component in front of the newest one's suffix, e.g. `{SID-prefix}_{HHMM}_0_{semantic-suffix}`. In the even less likely case of multiple conflicts: keep incrementing the number by 1 each time.

> "The second part of the name will be time of creation as HHMM, military
> time."
>
> "This will be the prefix."

4. Which tie-break rule SHALL govern two artifacts that share the same `HHMM`
   minute but not the same second: does the seconds-remaining prefix fully
   resolve that case, or does the policy need an additional deterministic token?

   **Answer**: The seconds-remaining prefix resolves this case.

> "System produced-items in `out` and `threads` shall follow a similar naming
> scheme as day-specific directories."
>
> "Existing `work` and `inbox` items shall be migrated once encoding is
> complete."

5. Which existing `lib/inbox/` artifacts fall inside migration scope, and does that
   scope include already-existing round files under `lib/inbox/threads/`?

   **Answer**: All inbox artifacts - `archive/in`, `in`, `out`, `threads/*` - and yes, includes already-existing round files.

> "The repository will be organized by day. Records for all work that is
> started on a particular day will live in that day's directory."
>
> "Any work started on a day will live in a subdirectory within the day-specific
> directory."

6. Which parent-day directory SHALL govern a work item that starts on one UTC
   day and later emits new artifacts on a later UTC day: the start-day
   directory or a new later-day directory?

   **Answer**: Always the start-day directory. Only start time matters for directory naming. 

> "It shall be the responsibility of the Intake Analyst - or other agent
> processing inbox items - to append the two time prefixes to any
> non-conforming human-generated items in `in` or `threads`."

7. Which actor SHALL own prefix application for non-conforming
   human-generated artifacts under `lib/inbox/in/` and `lib/inbox/threads/` during
   intake and during later migration runs?
   
   **Answer**: In general, whichever agent is doing the work. This is a rule that should be encoded in the `inbox-lifecycle` handbook. There's no need to couple it to specific agents (especially since agents and exact responsibilities may change over time).