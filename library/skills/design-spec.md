# Design specification

Use when authoring a UI/UX design specification during a design stage.

## Principle

A design spec is an implementation-facing contract: problem, users, flows,
structure, states, tokens, and observable acceptance criteria. It is not a mood
board.

## Steps

1. State the problem and primary users in one short paragraph each.
2. Map the critical flows as ordered steps with entry and success conditions.
3. Define information architecture: screens, navigation, and hierarchy.
4. Enumerate states for each key screen: empty, loading, partial, error, success.
5. Declare design tokens (color, type, space) before detailing layouts.
6. Draft acceptance criteria as observable outcomes a later `dev` run can verify.
7. Use IxDF quality lenses (useful, usable, findable, credible, desirable,
   accessible, valuable) as a coverage check, not as decorative labels.

## Boundaries

Do not invent unresolved product scope. Record open questions instead of guessing
brand or business rules.
