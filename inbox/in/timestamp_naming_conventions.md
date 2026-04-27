# Problem
There is currently no naming convention for temporal artifacts. This deteriorates operator navigability and readability of both ongoing and past work.

# Solution

## Goals
1. Implement a consistent convention that improves operator navigability and readability.
2. Migrate/backfill existing artifacts to use the new convention.

## Operator User Stories
- As an operator, I should be able to navigate archival structures (such as run ledgers in `work`) in reverse chronological order.
- As an operator, I should not have to expand my navigation pane to read long directory/file names.
- As an operator, I should not have to parse cumbersome artifact names containing low-signal metadata.
- As an operator, the subdirectory structure should feel like a reasonable balance between depth/nestedness and organizational value (i.e. not so deep that it overflows my navigation pane, but deep enough to prevent visual signal loss.)
- As an operator, I should be able to easily understand the nature and content of artifacts via consistent and high-signal naming symbols.

# Implementation Details

## Reverse-chron strategy





