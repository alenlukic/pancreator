# Scope control

Use when implementing or planning, to keep a change minimal and bounded.

## Principle

The smallest coherent change that satisfies the approved acceptance criteria is
the target. New structure is a cost paid against the current requirement, not a
future one.

## Checklist

- Each material change maps to an acceptance criterion or a documented enabling
  change. If it maps to neither, drop it or surface it for approval.
- Existing abstractions are preferred over new ones; existing boundaries are
  preserved unless the plan changes them explicitly.
- Refactoring is in scope only when the criteria require it or it is the
  smallest safe path to them; otherwise record it as a follow-up.
- Behavior outside the requested change is preserved and covered by existing
  tests.

## When tempted to expand

Stop and ask whether the expansion is required by a criterion. If not, write it
down as a risk or follow-up and leave it. Report a wrong or insufficient plan
rather than compensating with scope creep.
