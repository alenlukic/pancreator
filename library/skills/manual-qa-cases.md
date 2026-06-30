# Manual QA cases

Use when verifying observable behavior in the QA stage.

## Principle

A QA case is a reproducible experiment. Its value is that another operator could
rerun it and reach the same conclusion.

## Case shape

For each case, record:

- Setup: the starting state and any preconditions.
- Action: the exact steps a user takes.
- Expected: what should happen, tied to an acceptance criterion.
- Actual: what happened, verbatim, with evidence (output, screenshot path, file).
- Result: pass or fail.

## Steps

1. Derive at least one case per acceptance criterion, or justify non-
   applicability.
2. Execute each case from a clean, known state.
3. Classify any defect: product (route to implement), environment (route to the
   owning surface), or harness/test (route to its owner).

## Boundaries

Do not modify source to make a case pass. Fail on any unresolved blocking defect
or any uncovered hard acceptance criterion.
