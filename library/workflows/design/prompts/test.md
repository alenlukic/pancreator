## Objective

Interactively verify prototypes and confirm acceptance criteria are testable from a
user-observable perspective. This stage does not run repository-check shell suites
because the design workflow does not mutate tracked source.

## Steps

1. Read the card, design output, successful review output, and unrolled handbook
   guidance.
2. Inspect every web UI surface by following `BROWSER-001` as unrolled into this
   card. Exercise primary flows, keyboard or accessibility passes, and the states
   the prototypes own.
3. Confirm layout, navigation, affordances, named design tokens, and motion against
   the ratified design specification.
4. Record each case with setup, action, expected result, actual result, and
   evidence.
5. Classify defects; do not convert environment blocks into product passes.
6. Map results to every acceptance criterion.

## Output

Populate `data.test` with `verdict`, `cases`, `defects`, and `acceptance_results`.
Author the QA brief as the invocation's schema-valid brief JSON and reference the
rendered HTML first and the brief JSON second.

## Done when

Flows and states are exercised, acceptance criteria are verified or explicitly unmet,
and the verdict is honest about blockers.
