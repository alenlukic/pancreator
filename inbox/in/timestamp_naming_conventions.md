# Problem
There is currently no:

- naming convention for temporal artifacts
- directory structure/content organization philosophy

This deteriorates operator navigability and readability of the repo.

# Solution

## Goals
1. Define and implement a consistent naming convention for temporal artifacts that improves operator navigability and readability.
2. Define and implement a high-level content organization philosophy.
3. Migrate the repo.

## Scope
The scope of this document covers Goal 1 above + Goal 3 as it pertains to Goal 1. Goal 2 is deferred to a future run.

## Operator User Stories

### In Scope
- As an operator, I should be able to navigate archival structures (such as run ledgers in `work`) in reverse chronological order.

### Partially In Scope
-  As an operator, I should not have to expand my navigation pane to read long directory/file names.
- As an operator, I should not have to parse cumbersome artifact names containing low-signal metadata.
- As an operator, the subdirectory structure should feel like a reasonable balance between depth/nestedness and organizational value (i.e. not so deep that it overflows my navigation pane, but deep enough to prevent visual signal loss.)
- As an operator, I should be able to easily understand the nature and content of artifacts via consistent and high-signal naming symbols.

### Out Of Scope
- As an operator, I should be able to focus on the parts of Tesseract which actually require my attention, and avoid content that's purely for agents.

## Naming Conventions

### Temporal (time-based) content
- The UTC timezone shall always be used when working with date-times in this repo.
- We define a future date sentinel value `FDS` as January 1, 2500.
- We define a seconds-in-day sentinel value `SID` as 86400.

### `work` repository
The repository will be organized by day. Records for all work that is started on a particular day will live in that day's directory. All directories and subdirectories will be organized so the user sees them in reverse chron. We'll achieve this by using the sentinel values.

Day-specific directories will be prefixed with a value computed as days to `FDS`. This value will decrease as time advances. The current value (as of Apr 27 2026) is 173010. On 1/1/2500, the value will be 000000. If this project and convention are still active, then-current operators/agents are welcome to pick a new one.

Day-specific directories will be suffixed with the date of creation in MM-DD-YY format. So, the directory created for Apr 27 2026 would be named 173010_04-27-26.

Any work started on a day will live in a subdirectory within the day-specific directory. These subdirs will follow a similar naming convention, based on the time in seconds remaining until the end of the day at time of directory creation. This will be the prefix. So, a directory created at midnight would be prefixed with the `SID` value, and a directory created at 23:59:59 would be prefixed with 00001. The second part of the name will be time of creation as HHMM, military time. The last part of the name will be high-signal feature symbols.

Let's say the compliance tests directory was created at 23:00 UTC. The directory name would be 03600_2300_compliance_tests.

### `inbox`
System produced-items in `out` and `threads` shall follow a similar naming scheme as day-specific directories, i.e. {SID_BASED_PREFIX}_{HHMM_MILITARY_TIME}_{HIGH_SIGNAL_SEMANTIC_SUFFIX}.

It shall be the responsibility of the Intake Analyst - or other agent processing inbox items - to append the two time prefixes to any non-conforming human-generated items in `in` or `threads`.

# Implementation
- The conventions defined above shall be encoded as policy and enforced any time relevant `work` or `inbox` items are created/processed.
- Existing `work` and `inbox` items shall be migrated once encoding is complete.
- Any relevant references and documentation shall be updated.





